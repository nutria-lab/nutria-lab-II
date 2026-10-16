import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { CompositeKpiLogger } from '../composite-kpi.logger';
import { DataKpiLogger } from '../data-kpi.logger';
import { createKpiPrismaClient, disposeKpiPrismaClient } from '../db/kpi-prisma';
import { createReportingStore } from '../db/kpi-reporting-store';
import { FileKpiArtifactWriter } from '../file-kpi-artifact-writer';
import { parsePublishCliArgs, parseRetryCliArgs } from '../kpi-cli';
import type { PublishCliArgs, RetryCliArgs } from '../kpi-cli';
import type { KpiEnvironment } from '../kpi-contract';
import { KpiPublisher } from '../kpi-publisher';
import { PrismaPublicationRepository } from '../prisma-publication.repository';
import { TelemetryLogger } from '../telemetry-logger';
import { SupabaseKpiRemoteClient } from '../supabase-kpi-remote-client';
import { resolveKpiConfig } from '../config/kpi-config';
import { ApiFirstKpiLogger, ApiFirstPublicationRepository, KpiApiClient } from '../kpi-api-client';
import { KpiResponseError, KpiTransportError } from '../kpi-api-client';
import { KpiRemoteApiError } from '../supabase-kpi-remote-client';
import { windowForDate } from '../window/kpi-window';

const OUTCOME_FILE = 'outcome.json';

export interface KpiPublisherCliOutcome {
  date: string | null;
  environment: KpiEnvironment | null;
  status: string;
  post_accepted: boolean;
  retryable: boolean;
  retry_after_ms: number | null;
  retry_chain_id: string | null;
  run_id: string | null;
  failure_code: string | null;
}

export async function runKpiPublishCli(argv: readonly string[], environment: NodeJS.ProcessEnv = process.env): Promise<number> {
  return run(argv, environment, 'publish');
}

export async function runKpiRetryCli(argv: readonly string[], environment: NodeJS.ProcessEnv = process.env): Promise<number> {
  return run(argv, environment, 'retry');
}

async function run(argv: readonly string[], environment: NodeJS.ProcessEnv, mode: 'publish' | 'retry'): Promise<number> {
  const artifactDirectory = resolve(environment.KPI_ARTIFACT_DIR ?? 'kpi-artifacts');
  let outcome: KpiPublisherCliOutcome = emptyOutcome();
  let prismaHandle: ReturnType<typeof createKpiPrismaClient> | null = null;
  let reportingStore: ReturnType<typeof createReportingStore> | null = null;
  let fallbackDatabaseUrl: string | null = null;
  let reportContext: { date: string; environment: KpiEnvironment } | null = null;
  let retryChainId: string | null = null;
  const openPrisma = () => {
    if (fallbackDatabaseUrl === null) throw new Error('KPI_PUBLISH_CONFIGURATION_INVALID');
    prismaHandle ??= createKpiPrismaClient(fallbackDatabaseUrl);
    return prismaHandle;
  };
  try {
    const parsed: PublishCliArgs | RetryCliArgs = mode === 'publish' ? parsePublishCliArgs(argv) : parseRetryCliArgs(argv);
    reportContext = { date: parsed.date, environment: parsed.environment };
    retryChainId = mode === 'publish' ? randomUUID() : (parsed as RetryCliArgs).retryChainId;
    const config = requireConfiguration(environment, parsed.environment);
    fallbackDatabaseUrl = config.databaseUrl;
    const remoteClient = new SupabaseKpiRemoteClient(config);
    if (!(await remoteClient.validateIdentity())) throw new Error('KPI_REMOTE_IDENTITY_INVALID');
    const api = new KpiApiClient(config.apiBaseUrl, config.internalToken);
    const localPublicationRepository = () => new PrismaPublicationRepository(openPrisma().prisma as never);
    const publicationRepository = new ApiFirstPublicationRepository(api, localPublicationRepository);
    const localLogger = {
      collect: async (context: Parameters<CompositeKpiLogger['collect']>[0]) => {
        const prisma = openPrisma();
        reportingStore ??= createReportingStore(config.databaseUrl);
        const telemetry = new TelemetryLogger(
          reportingStore,
          { environment: parsed.environment },
        );
        return new CompositeKpiLogger(telemetry, new DataKpiLogger(prisma.prisma as never)).collect(context);
      },
    };
    const publisher = new KpiPublisher({
      repository: publicationRepository,
      logger: new ApiFirstKpiLogger(
        api,
        localLogger,
      ),
      remoteClient,
      artifactWriter: new FileKpiArtifactWriter(artifactDirectory),
      clock: { now: () => new Date() },
      idGenerator: { next: randomUUID },
    });
    const request = mode === 'publish'
      ? {
          environment: parsed.environment,
          date: parsed.date,
          sourceCommit: config.sourceCommit,
          retryChainId: retryChainId!,
          attempt: 0,
        }
      : {
          environment: parsed.environment,
          date: parsed.date,
          sourceCommit: (parsed as RetryCliArgs).sourceCommit,
          retryChainId: (parsed as RetryCliArgs).retryChainId,
          attempt: (parsed as RetryCliArgs).attempt,
          runId: (parsed as RetryCliArgs).runId,
          manualRecovery: (parsed as RetryCliArgs).manualRecovery,
        };
    const result = await publisher.publish(request);
    const publication = await publicationRepository.getPublication(parsed.environment, parsed.date);
    outcome = {
      status: result.status,
      date: parsed.date,
      environment: parsed.environment,
      post_accepted: result.postAccepted,
      retryable: result.retryable ?? false,
      retry_after_ms: result.retryAfterMs ?? null,
      retry_chain_id: publication.retryChainId,
      run_id: publication.runId,
      failure_code: result.failureCode ?? null,
    };
  } catch (error) {
    // Intentionally do not serialize exception text: it can contain URLs or credentials.
    const failure = classifyFailure(error);
    outcome = {
      ...emptyOutcome(),
      ...(reportContext ?? {}),
      status: 'failed',
      retry_chain_id: retryChainId,
      retryable: failure.retryable,
      retry_after_ms: failure.retryAfterMs,
      failure_code: failure.code,
    };
    await writeFailureDiagnostics(artifactDirectory, reportContext, failure.code);
  } finally {
    await writeOutcome(artifactDirectory, outcome);
    await closeReportingStore(reportingStore as ReturnType<typeof createReportingStore> | null);
    if (prismaHandle) await disposeKpiPrismaClient(prismaHandle);
  }
  return outcome.status === 'accepted' || outcome.status === 'delivered' || outcome.status === 'skipped_duplicate' ? 0 : 1;
}

async function closeReportingStore(store: ReturnType<typeof createReportingStore> | null): Promise<void> {
  await store?.close().catch(() => undefined);
}

function requireConfiguration(environment: NodeJS.ProcessEnv, expectedEnvironment: KpiEnvironment) {
  const config = resolveKpiConfig(environment);
  if (config.environment !== expectedEnvironment) throw new Error('KPI_ENV_MISMATCH');
  const databaseUrl = environment.DATABASE_URL;
  const baseUrl = environment.SUPABASE_URL;
  const apiBaseUrl = environment.KPI_API_BASE_URL;
  const internalToken = environment.KPI_INTERNAL_TOKEN;
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY;
  const projectKey = environment.PROJECT_KEY;
  const sourceCommit = environment.SOURCE_COMMIT ?? environment.GITHUB_SHA;
  if (!databaseUrl || !baseUrl || !apiBaseUrl || !internalToken || !publishableKey || !projectKey || !sourceCommit || !/^[0-9a-f]{40}$/i.test(sourceCommit)) {
    throw new Error('KPI_PUBLISH_CONFIGURATION_INVALID');
  }
  return { databaseUrl, baseUrl, apiBaseUrl, internalToken, publishableKey, projectKey, sourceCommit };
}

function emptyOutcome(): KpiPublisherCliOutcome {
  return {
    date: null, environment: null,
    status: 'failed', post_accepted: false, retryable: false, retry_after_ms: null,
    retry_chain_id: null, run_id: null, failure_code: null,
  };
}

function classifyFailure(error: unknown): { code: string; retryable: boolean; retryAfterMs: number | null } {
  if (error instanceof KpiRemoteApiError) {
    return { code: error.code, retryable: error.retryable, retryAfterMs: error.retryAfterMs };
  }
  if (error instanceof KpiTransportError) {
    return { code: error.code, retryable: true, retryAfterMs: null };
  }
  if (error instanceof KpiResponseError) {
    const retryable = error.status === 408 || error.status === 429 || error.status >= 500;
    return { code: error.code, retryable, retryAfterMs: null };
  }
  const message = error instanceof Error ? error.message : '';
  const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(message) ? message : 'KPI_PUBLISHER_EXECUTION_ERROR';
  return { code, retryable: false, retryAfterMs: null };
}

async function writeFailureDiagnostics(
  directory: string,
  context: { date: string; environment: KpiEnvironment } | null,
  errorCode: string,
): Promise<void> {
  const path = resolve(directory, 'diagnostics.json');
  try {
    const existing = JSON.parse(await readFile(path, 'utf8')) as { status?: unknown };
    if (existing.status !== 'pending') return;
  } catch {
    // Write the minimal diagnostic when absent or still the workflow placeholder.
  }
  const window = context ? windowForDate(context.date) : null;
  const diagnostics = {
    tool: 'nutria-kpi-publisher',
    status: 'failed',
    date: context?.date ?? null,
    environment: context?.environment ?? null,
    window_start: window?.start.toISOString() ?? null,
    window_end: window?.end.toISOString() ?? null,
    sample_count: 0,
    quality_counts: {},
    error_code: errorCode,
  };
  await mkdir(directory, { recursive: true });
  await writeFile(path, JSON.stringify(diagnostics), { mode: 0o600 }).catch(() => undefined);
}

async function writeOutcome(directory: string, outcome: KpiPublisherCliOutcome): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, OUTCOME_FILE), JSON.stringify(outcome), { mode: 0o600 });
}
