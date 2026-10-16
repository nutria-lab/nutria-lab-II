import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runKpiPublishCli, runKpiRetryCli } from './kpi-publisher-cli';
import { KpiPublisher } from '../kpi-publisher';
import { PrismaPublicationRepository } from '../prisma-publication.repository';
import { SupabaseKpiRemoteClient } from '../supabase-kpi-remote-client';
import type { PublicationRecord } from '../publication-repository.port';

const SECRET_DATABASE_URL = 'postgresql://fixture-user:db-secret@localhost:5432/nutria';
const SECRET_PROJECT_KEY = 'project-key-fixture-secret';
const SECRET_PUBLISHABLE_KEY = 'publishable-key-fixture-secret';

async function withArtifacts(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'nutria-kpi-cli-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function outcome(directory: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(directory, 'outcome.json'), 'utf8')) as Record<string, unknown>;
}

function cliEnvironment(directory: string, extras: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    KPI_ARTIFACT_DIR: directory,
    KPI_ENV: 'prod',
    DATABASE_URL: SECRET_DATABASE_URL,
    SUPABASE_URL: 'https://rzlalzowistpiphmdqpp.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: SECRET_PUBLISHABLE_KEY,
    PROJECT_KEY: SECRET_PROJECT_KEY,
    SOURCE_COMMIT: 'a'.repeat(40),
    ...extras,
  };
}

const publicationFixture = {
  runId: 'f66cd499-0171-41dc-858f-bef11373f1f5',
  environment: 'prod' as const,
  date: '2026-10-09',
  sourceCommit: 'a'.repeat(40),
  retryChainId: 'f049dc13-8d9f-4c23-9f55-0f1a4d676fe4',
  status: 'preparing' as const,
  frozenBatch: null,
  frozenPayload: null,
  payloadSha256: null,
  acceptedAt: null,
  deliveredAt: null,
  failureCode: null,
  attemptCount: 0,
};

function expectSanitizedConfigurationFailure(value: Record<string, unknown>): void {
  const serialized = JSON.stringify(value);
  expect(value).toMatchObject({
    status: 'failed',
    post_accepted: false,
    retryable: false,
    retry_after_ms: null,
    retry_chain_id: null,
    run_id: null,
    failure_code: 'KPI_PUBLISH_CONFIGURATION_INVALID',
  });
  expect(serialized).not.toContain(SECRET_DATABASE_URL);
  expect(serialized).not.toContain(SECRET_PROJECT_KEY);
  expect(serialized).not.toContain(SECRET_PUBLISHABLE_KEY);
}

describe('KPI publisher CLI configuration boundary', () => {
  it('returns nonzero for an unaccepted nonretryable verify-pending outcome, but zero after a known 2xx acceptance', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([{ env: 'prod' }]), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const publishSpy = jest.spyOn(KpiPublisher.prototype, 'publish')
      .mockResolvedValueOnce({ status: 'verify_pending', postAccepted: false, retryable: false })
      .mockResolvedValueOnce({ status: 'verify_pending', postAccepted: true, retryable: false });
    const readSpy = jest.spyOn(PrismaPublicationRepository.prototype, 'getPublication').mockResolvedValue(publicationFixture);
    try {
      await withArtifacts(async directory => {
        await expect(runKpiPublishCli(['--date', publicationFixture.date, '--environment', 'prod'], cliEnvironment(directory))).resolves.toBe(1);
        await expect(runKpiPublishCli(['--date', publicationFixture.date, '--environment', 'prod'], cliEnvironment(directory))).resolves.toBe(0);
      });
    } finally {
      fetchSpy.mockRestore();
      publishSpy.mockRestore();
      readSpy.mockRestore();
    }
  });

  it('keeps a post-2xx remote value conflict failed without making it retryable', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([{ env: 'prod' }]), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const publishSpy = jest.spyOn(KpiPublisher.prototype, 'publish').mockResolvedValue({
      status: 'failed', postAccepted: true, retryable: false, failureCode: 'REMOTE_VALUE_CONFLICT',
    });
    const readSpy = jest.spyOn(PrismaPublicationRepository.prototype, 'getPublication').mockResolvedValue(publicationFixture);
    try {
      await withArtifacts(async directory => {
        const exitCode = await runKpiPublishCli(
          ['--date', publicationFixture.date, '--environment', 'prod'],
          cliEnvironment(directory),
        );

        expect(exitCode).toBe(1);
        await expect(outcome(directory)).resolves.toMatchObject({
          status: 'failed', post_accepted: true, retryable: false, failure_code: 'REMOTE_VALUE_CONFLICT',
        });
      });
      expect(publishSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
      publishSpy.mockRestore();
      readSpy.mockRestore();
    }
  });

  it('keeps post_accepted and exits successfully when the post-2xx follow-up publication read fails', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([{ env: 'prod' }]), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const publishSpy = jest.spyOn(KpiPublisher.prototype, 'publish').mockResolvedValue({
      status: 'verify_pending', postAccepted: true,
    });
    const readSpy = jest.spyOn(PrismaPublicationRepository.prototype, 'getPublication')
      .mockRejectedValue(new Error('post-accepted row read failed'));

    try {
      await withArtifacts(async (directory) => {
        const exitCode = await runKpiPublishCli(
          ['--date', publicationFixture.date, '--environment', 'prod'],
          cliEnvironment(directory),
        );

        expect(exitCode).toBe(0);
        await expect(outcome(directory)).resolves.toMatchObject({
          status: 'verify_pending', post_accepted: true, retryable: false,
        });
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(publishSpy).toHaveBeenCalledTimes(1);
      expect(readSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
      publishSpy.mockRestore();
      readSpy.mockRestore();
    }
  });

  it('uses SUPABASE_URL for publication when the existing KPI_API_BASE_URL points at NutrIA health', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([{ env: 'prod' }]), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const publishSpy = jest.spyOn(KpiPublisher.prototype, 'publish').mockResolvedValue({
      status: 'skipped_duplicate', postAccepted: false,
    });
    const readSpy = jest.spyOn(PrismaPublicationRepository.prototype, 'getPublication')
      .mockResolvedValue(publicationFixture);

    try {
      await withArtifacts(async (directory) => {
        const exitCode = await runKpiPublishCli(
          ['--date', publicationFixture.date, '--environment', 'prod'],
          cliEnvironment(directory, { KPI_API_BASE_URL: 'https://nutria-health.example.test' }),
        );

        expect(exitCode).toBe(0);
        await expect(outcome(directory)).resolves.toMatchObject({ status: 'skipped_duplicate' });
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String(fetchSpy.mock.calls[0][0])).toBe('https://rzlalzowistpiphmdqpp.supabase.co/rest/v1/rpc/current_project');
      expect(publishSpy).toHaveBeenCalledTimes(1);
      expect(readSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
      publishSpy.mockRestore();
      readSpy.mockRestore();
    }
  });

  it('exposes manual recovery as a retry CLI operation and runs attempt zero on the preserved frozen identity', async () => {
    const newChainId = '68302990-bb52-4c9a-afc9-31ff4baa6300';
    const recoveredPublication = {
      ...publicationFixture,
      status: 'frozen' as const,
      retryChainId: newChainId,
      attemptCount: 0,
      frozenBatch: { payload_sha256: 'b'.repeat(64) },
      frozenPayload: Buffer.from('frozen-payload'),
      payloadSha256: 'b'.repeat(64),
    } as unknown as PublicationRecord;
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([{ env: 'prod' }]), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const publishSpy = jest.spyOn(KpiPublisher.prototype, 'publish').mockResolvedValue({
      status: 'delivered', postAccepted: true,
    });
    const recoverSpy = jest.spyOn(PrismaPublicationRepository.prototype, 'recoverManually')
      .mockResolvedValue(recoveredPublication);
    const readSpy = jest.spyOn(PrismaPublicationRepository.prototype, 'getPublication')
      .mockResolvedValue(recoveredPublication);

    try {
      await withArtifacts(async (directory) => {
        const exitCode = await runKpiRetryCli([
          '--manual-recovery', '--date', publicationFixture.date, '--environment', 'prod',
          '--run-id', publicationFixture.runId, '--retry-chain-id', newChainId,
          '--source-commit', publicationFixture.sourceCommit,
        ], cliEnvironment(directory));

        expect(exitCode).toBe(0);
        await expect(outcome(directory)).resolves.toMatchObject({
          status: 'delivered', post_accepted: true, retry_chain_id: newChainId, run_id: publicationFixture.runId,
        });
      });
      expect(recoverSpy).toHaveBeenCalledWith(publicationFixture.runId, newChainId);
      expect(publishSpy).toHaveBeenCalledWith(expect.objectContaining({
        environment: 'prod', date: publicationFixture.date, runId: publicationFixture.runId,
        retryChainId: newChainId, attempt: 0, sourceCommit: publicationFixture.sourceCommit,
      }));
      expect(readSpy).toHaveBeenCalledWith('prod', publicationFixture.date);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
      publishSpy.mockRestore();
      recoverSpy.mockRestore();
      readSpy.mockRestore();
    }
  });

  it('returns exit 1 and writes a sanitized, classified outcome when publish configuration is incomplete before database or HTTP work', async () => {
    await withArtifacts(async (directory) => {
      const exitCode = await runKpiPublishCli(
        ['--date', '2026-10-09', '--environment', 'prod'],
        {
          KPI_ARTIFACT_DIR: directory,
          KPI_ENV: 'prod',
          DATABASE_URL: SECRET_DATABASE_URL,
          PROJECT_KEY: SECRET_PROJECT_KEY,
          SUPABASE_PUBLISHABLE_KEY: SECRET_PUBLISHABLE_KEY,
          // KPI_API_BASE_URL and source SHA deliberately omitted.
        },
      );

      expect(exitCode).toBe(1);
      expectSanitizedConfigurationFailure(await outcome(directory));
    });
  });

  it('keeps malformed retry input out of database/HTTP execution and never serializes ambient secrets', async () => {
    await withArtifacts(async (directory) => {
      const exitCode = await runKpiRetryCli(
        [
          '--date', '2026-10-09', '--environment', 'prod',
          '--retry-chain-id', 'not-a-uuid', '--attempt', '1', '--source-commit', 'a'.repeat(40),
        ],
        {
          KPI_ARTIFACT_DIR: directory,
          KPI_ENV: 'prod',
          DATABASE_URL: SECRET_DATABASE_URL,
          KPI_API_BASE_URL: 'https://example.invalid/rest',
          PROJECT_KEY: SECRET_PROJECT_KEY,
          SUPABASE_PUBLISHABLE_KEY: SECRET_PUBLISHABLE_KEY,
          SOURCE_COMMIT: 'b'.repeat(40),
        },
      );

      expect(exitCode).toBe(1);
      const value = await outcome(directory);
      expect(value).toMatchObject({ status: 'failed', post_accepted: false, retryable: false });
      expect(JSON.stringify(value)).not.toContain(SECRET_DATABASE_URL);
      expect(JSON.stringify(value)).not.toContain(SECRET_PROJECT_KEY);
      expect(JSON.stringify(value)).not.toContain(SECRET_PUBLISHABLE_KEY);
    });
  });
});
