import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runKpiPublishCli, runKpiRetryCli } from './kpi-publisher-cli';

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
