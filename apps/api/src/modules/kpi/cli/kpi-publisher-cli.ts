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
import { KpiPublisher } from '../kpi-publisher';
import { PrismaPublicationRepository } from '../prisma-publication.repository';
import { TelemetryLogger } from '../telemetry-logger';
import { SupabaseKpiRemoteClient } from '../supabase-kpi-remote-client';
import { resolveKpiConfig } from '../config/kpi-config';
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
  let prismaHandle: ReturnType<typeof createKpiPrismaClient> | null = null;
  let reportingStore: ReturnType<typeof createReportingStore> | null = null;
  try {
    const parsed: PublishCliArgs | RetryCliArgs = mode === 'publish' ? parsePublishCliArgs(argv) : parseRetryCliArgs(argv);
    const config = requireConfiguration(environment, parsed.environment);
    prismaHandle = createKpiPrismaClient(config.databaseUrl);
    reportingStore = createReportingStore(config.databaseUrl);

    const telemetry = new TelemetryLogger(
      new TelemetrySnapshotService(reportingStore, () => new Date()),
      { environment: parsed.environment },
    );
    const remoteClient = new SupabaseKpiRemoteClient(config);
    if (!(await remoteClient.validateIdentity())) throw new Error('KPI_REMOTE_IDENTITY_INVALID');
    const publisher = new KpiPublisher({
      repository: new PrismaPublicationRepository(prismaHandle.prisma as never),
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
          retryChainId: randomUUID(),
          attempt: 0,
        }
      : {
          environment: parsed.environment,
          date: parsed.date,
          sourceCommit: (parsed as RetryCliArgs).sourceCommit,
          retryChainId: (parsed as RetryCliArgs).retryChainId,
          attempt: (parsed as RetryCliArgs).attempt,
        };
    const result = await publisher.publish(request);
    const publication = await new PrismaPublicationRepository(prismaHandle.prisma as never).getPublication(parsed.environment, parsed.date);
    outcome = {
      status: result.status,
      post_accepted: result.postAccepted,
      retryable: result.retryable ?? false,
      retry_after_ms: result.retryAfterMs ?? null,
      retry_chain_id: publication.retryChainId,
      run_id: publication.runId,
      failure_code: result.failureCode ?? null,
    };
  } catch (error) {
    // Intentionally do not serialize exception text: it can contain URLs or credentials.
    outcome = {
      ...emptyOutcome(),
      status: 'failed',
      failure_code: error instanceof Error && error.message === 'KPI_PUBLISH_CONFIGURATION_INVALID'
        ? 'KPI_PUBLISH_CONFIGURATION_INVALID'
        : 'KPI_PUBLISHER_EXECUTION_ERROR',
    };
  } finally {
    await writeOutcome(artifactDirectory, outcome);
    await reportingStore?.close().catch(() => undefined);
    if (prismaHandle) await disposeKpiPrismaClient(prismaHandle);
  }
  return outcome.status === 'delivered' || outcome.status === 'skipped_duplicate' ? 0 : 1;
}

function requireConfiguration(environment: NodeJS.ProcessEnv, expectedEnvironment: KpiEnvironment) {
  const config = resolveKpiConfig(environment);
  if (config.environment !== expectedEnvironment) throw new Error('KPI_ENV_MISMATCH');
  const databaseUrl = environment.DATABASE_URL;
  const baseUrl = environment.KPI_API_BASE_URL;
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY;
  const projectKey = environment.PROJECT_KEY;
  const sourceCommit = environment.SOURCE_COMMIT ?? environment.GITHUB_SHA;
  if (!databaseUrl || !baseUrl || !publishableKey || !projectKey || !sourceCommit || !/^[0-9a-f]{40}$/i.test(sourceCommit)) {
    throw new Error('KPI_PUBLISH_CONFIGURATION_INVALID');
  }
  return { databaseUrl, baseUrl, publishableKey, projectKey, sourceCommit };
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
