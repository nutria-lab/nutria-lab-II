import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { CompositeKpiLogger } from '../composite-kpi.logger';
import { DataKpiLogger } from '../data-kpi.logger';
import { createKpiPrismaClient, disposeKpiPrismaClient } from '../db/kpi-prisma';
import { createReportingStore } from '../db/kpi-reporting-store';
import { FileKpiArtifactWriter } from '../file-kpi-artifact-writer';
import { parsePublishCliArgs, parseRetryCliArgs } from '../kpi-cli';
import type { PublishCliArgs, RetryCliArgs } from '../kpi-cli';
import type { KpiEnvironment } from '../kpi-contract';
import { classifyPublicationError, KpiPublisher } from '../kpi-publisher';
import { PrismaPublicationRepository } from '../prisma-publication.repository';
import { TelemetryLogger } from '../telemetry-logger';
import { SupabaseKpiIdentityError, SupabaseKpiRemoteClient } from '../supabase-kpi-remote-client';
import { resolveApprovedSupabaseOrigin, resolveKpiConfig } from '../config/kpi-config';
import { TelemetrySnapshotService } from '../snapshots/telemetry-snapshot.service';

const OUTCOME_FILE = 'outcome.json';

export interface KpiPublisherCliOutcome {
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
  let acceptedInMemory = false;
  let prismaHandle: ReturnType<typeof createKpiPrismaClient> | null = null;
  let reportingStore: ReturnType<typeof createReportingStore> | null = null;
  let requestRunId: string | null = null;
  let requestRetryChainId: string | null = null;
  try {
    const parsed: PublishCliArgs | RetryCliArgs = mode === 'publish' ? parsePublishCliArgs(argv) : parseRetryCliArgs(argv);
    requestRunId = parsed.runId ?? null;
    requestRetryChainId = parsed.retryChainId ?? (mode === 'retry' ? (parsed as RetryCliArgs).retryChainId : null);
    outcome = {
      ...emptyOutcome(),
      retry_chain_id: mode === 'retry' ? (parsed as RetryCliArgs).retryChainId : null,
    };
    if (parsed.phase === 'post-frozen' && environment.KPI_ARTIFACT_UPLOAD_CONFIRMED !== 'true') {
      throw new Error('KPI_ARTIFACT_UPLOAD_NOT_CONFIRMED');
    }
    const config = requireConfiguration(environment, parsed.environment);
    const publishArgs = mode === 'publish' ? parsed as PublishCliArgs : null;
    const retryArgs = mode === 'retry' ? parsed as RetryCliArgs : null;
    const initialRetryChainId = mode === 'publish'
      ? publishArgs!.retryChainId ?? randomUUID()
      : retryArgs!.retryChainId;
    requestRetryChainId = initialRetryChainId;
    if (mode === 'publish') outcome = { ...outcome, retry_chain_id: initialRetryChainId };
    prismaHandle = createKpiPrismaClient(config.databaseUrl);
    reportingStore = createReportingStore(config.databaseUrl);

    const telemetry = new TelemetryLogger(
      new TelemetrySnapshotService(reportingStore, () => new Date()),
      { environment: parsed.environment },
    );
    const remoteClient = new SupabaseKpiRemoteClient({ ...config, environment: parsed.environment });
    if (!(await remoteClient.validateIdentity(parsed.environment))) throw new Error('KPI_REMOTE_IDENTITY_INVALID');
    const repository = new PrismaPublicationRepository(prismaHandle.prisma as never);
    if (retryArgs?.manualRecovery && parsed.phase !== 'post-frozen') {
      const existing = await repository.getPublication(parsed.environment, parsed.date);
      if (existing.runId !== retryArgs.runId || existing.sourceCommit !== retryArgs.sourceCommit) {
        throw new Error('KPI_MANUAL_RECOVERY_NOT_ELIGIBLE');
      }
      await repository.recoverManually(retryArgs.runId!, retryArgs.retryChainId);
    }
    const publisher = new KpiPublisher({
      repository,
      logger: new CompositeKpiLogger(telemetry, new DataKpiLogger(prismaHandle.prisma)),
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
          retryChainId: initialRetryChainId,
          attempt: 0 as const,
          runId: publishArgs!.runId,
          phase: parsed.phase ?? 'prepare-only',
        }
      : {
          environment: parsed.environment,
          date: parsed.date,
          sourceCommit: (parsed as RetryCliArgs).sourceCommit,
          retryChainId: (parsed as RetryCliArgs).retryChainId,
          attempt: (parsed as RetryCliArgs).attempt,
          runId: (parsed as RetryCliArgs).runId,
          phase: parsed.phase ?? 'prepare-only',
          manualRecovery: false,
        };
    const result = await publisher.publish(request);
    acceptedInMemory = result.postAccepted;
    outcome = {
      status: result.status,
      post_accepted: result.postAccepted,
      retryable: result.retryable ?? false,
      retry_after_ms: result.retryAfterMs ?? null,
      retry_chain_id: result.retryChainId ?? outcome.retry_chain_id,
      run_id: result.runId ?? null,
      failure_code: result.failureCode ?? null,
    };

    // Best-effort read enriches old adapter outcomes but must not overwrite a
    // 2xx accepted result if the database read fails immediately afterward.
    try {
      const publication = await repository.getPublication(parsed.environment, parsed.date);
      outcome = {
        ...outcome,
        run_id: outcome.run_id ?? publication.runId,
        retry_chain_id: outcome.retry_chain_id ?? publication.retryChainId,
      };
    } catch {
      // Preserve the execution evidence already available in memory. In
      // particular, a post-2xx read failure must not erase post_accepted.
    }
  } catch (error) {
    const classification = classifyPublicationError(error);
    const failureCode = error instanceof Error && [
      'KPI_PUBLISH_CONFIGURATION_INVALID', 'KPI_REMOTE_IDENTITY_INVALID',
      'KPI_REMOTE_IDENTITY_UNAVAILABLE',
      'KPI_ARTIFACT_UPLOAD_NOT_CONFIRMED', 'KPI_MANUAL_RECOVERY_NOT_ELIGIBLE',
    ].includes(error.message) ? error.message : 'KPI_PUBLISHER_EXECUTION_ERROR';
    outcome = {
      ...outcome,
      status: 'failed',
      post_accepted: acceptedInMemory || outcome.post_accepted,
      retryable: acceptedInMemory ? false : classification.retryable,
      retry_after_ms: acceptedInMemory ? null : getRetryAfterMs(error),
      retry_chain_id: requestRetryChainId ?? outcome.retry_chain_id,
      run_id: requestRunId ?? outcome.run_id,
      failure_code: failureCode,
    };
  } finally {
    try {
      await writeOutcome(artifactDirectory, outcome);
    } catch {
      // The workflow's pre-POST Action artifact is already durable, or this
      // diagnostic path is itself unavailable. Do not fabricate output data.
    }
    await reportingStore?.close().catch(() => undefined);
    if (prismaHandle) await disposeKpiPrismaClient(prismaHandle);
  }
  return shouldExitSuccessfully(outcome) ? 0 : 1;
}

function requireConfiguration(environment: NodeJS.ProcessEnv, expectedEnvironment: Extract<KpiEnvironment, 'dev' | 'prod'>) {
  const config = resolveKpiConfig(environment);
  if (config.environment !== expectedEnvironment) throw new Error('KPI_PUBLISH_CONFIGURATION_INVALID');
  const databaseUrl = environment.DATABASE_URL;
  const baseUrl = environment.SUPABASE_URL;
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY;
  const projectKey = environment.PROJECT_KEY;
  const sourceCommit = environment.SOURCE_COMMIT ?? environment.GITHUB_SHA;
  if (!databaseUrl || !baseUrl || !publishableKey || !projectKey || !sourceCommit ||
    !/^[0-9a-f]{40}$/i.test(sourceCommit)) {
    throw new Error('KPI_PUBLISH_CONFIGURATION_INVALID');
  }
  const approvedOrigin = resolveApprovedSupabaseOrigin(expectedEnvironment, baseUrl);
  // KPI_API_BASE_URL is intentionally not compared or reused: NUT-85 owns it
  // as the NutrIA health endpoint, while Supabase has its own service URL.
  return { databaseUrl, baseUrl: approvedOrigin, approvedOrigin, publishableKey, projectKey, sourceCommit };
}

function shouldExitSuccessfully(outcome: KpiPublisherCliOutcome): boolean {
  return outcome.status === 'delivered' || outcome.status === 'prepared' || outcome.status === 'skipped_duplicate' ||
    (outcome.status === 'verify_pending' && outcome.post_accepted);
}

function emptyOutcome(): KpiPublisherCliOutcome {
  return {
    status: 'failed', post_accepted: false, retryable: false, retry_after_ms: null,
    retry_chain_id: null, run_id: null, failure_code: null,
  };
}

async function writeOutcome(directory: string, outcome: KpiPublisherCliOutcome): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, OUTCOME_FILE), JSON.stringify(outcome), { mode: 0o600 });
}

function getRetryAfterMs(error: unknown): number | null {
  return error instanceof SupabaseKpiIdentityError ? error.retryAfterMs : null;
}
