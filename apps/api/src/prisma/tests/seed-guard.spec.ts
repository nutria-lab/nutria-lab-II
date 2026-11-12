/**
 * NUT-114 — Seed target guard (Block 1, TDD red first).
 *
 * Expected API of `apps/api/prisma/synthetic/guard.ts` (pure: no pg / Prisma imports, never reads process.env):
 *
 *   export type SeedEnv = Record<string, string | undefined>;
 *
 *   export type SeedGuardErrorCode =
 *     | 'missing_database_url'     // DATABASE_URL undefined or empty
 *     | 'invalid_database_url'     // any evaluated URL cannot be parsed
 *     | 'production_env'           // NODE_ENV | KPI_ENV | VERCEL_ENV === 'production' (checked even for localhost)
 *     | 'target_not_allowed'       // any defined URL (DATABASE_URL, DATABASE_URL_UNPOOLED, DIRECT_URL) outside allowlist
 *     | 'confirm_target_mismatch'  // SEED_SYNTHETIC=true and SEED_CONFIRM_TARGET missing or != allowed target
 *     | 'missing_demo_password';   // SEED_SYNTHETIC=true and SEED_DEMO_PASSWORD missing or empty
 *
 *   export class SeedGuardError extends Error { readonly code: SeedGuardErrorCode }
 *
 *   export interface SeedTarget {
 *     target: string;      // normalized "host/database" of DATABASE_URL: lowercase host, Neon "-pooler" removed, no port, no credentials
 *     maskedHost: string;  // e.g. "ep-***-123456…neon.tech" — never the full remote host, never credentials
 *     database: string;    // database name, e.g. "neondb"
 *     synthetic: boolean;  // true only when SEED_SYNTHETIC === 'true' and every synthetic check passed
 *   }
 *
 *   // "postgresql://u:p@ep-x-123-pooler.region.aws.neon.tech:5432/neondb?sslmode=require" -> "ep-x-123.region.aws.neon.tech/neondb"
 *   export function normalizeSeedTarget(url: string): string;
 *
 *   // Throws SeedGuardError. localhost / 127.0.0.1 / ::1 always allowed (any database);
 *   // remote targets only when listed exactly (after the same normalization) in SEED_ALLOWED_TARGETS (comma separated "host/db").
 *   export function assertSeedTarget(env: SeedEnv): SeedTarget;
 *
 *   // Runs assertSeedTarget(env) BEFORE calling createClient(). If the guard throws, the returned promise rejects with the
 *   // SeedGuardError and createClient is never called (so no Pool / PrismaClient is created). Otherwise calls
 *   // createClient() exactly once and resolves with run(client, target).
 *   export function withSeedGuard<C, R>(
 *     env: SeedEnv,
 *     createClient: () => C,
 *     run: (client: C, target: SeedTarget) => Promise<R>,
 *   ): Promise<R>;
 *
 * Every test passes an explicit env object; process.env is never used.
 */
import {
  SeedGuardError,
  assertSeedTarget,
  normalizeSeedTarget,
  withSeedGuard,
} from '../../../prisma/synthetic/guard';

const USER = 'u_sentinel';
const PASSWORD = 'p_sentinel';
const NEON = 'ep-cool-darkness-123456.us-east-2.aws.neon.tech';
const NEON_POOLER = 'ep-cool-darkness-123456-pooler.us-east-2.aws.neon.tech';
const OTHER_NEON = 'ep-prod-forest-999999-pooler.us-east-2.aws.neon.tech';
const ALLOWED_TARGET = `${NEON}/neondb`;

const url = (host: string, db = 'neondb') =>
  `postgresql://${USER}:${PASSWORD}@${host}/${db}?sslmode=require`;

/** Allowed remote baseline with the synthetic part enabled. Each case changes exactly one variable. */
const remoteBaseline = (): Record<string, string | undefined> => ({
  NODE_ENV: 'development',
  DATABASE_URL: url(NEON_POOLER),
  SEED_ALLOWED_TARGETS: ALLOWED_TARGET,
  SEED_SYNTHETIC: 'true',
  SEED_CONFIRM_TARGET: ALLOWED_TARGET,
  SEED_DEMO_PASSWORD: 'demo_pw_sentinel',
});

/** Allowed localhost baseline, base seed only, no allowlist. */
const localBaseline = (): Record<string, string | undefined> => ({
  NODE_ENV: 'development',
  DATABASE_URL: `postgresql://${USER}:${PASSWORD}@localhost:5432/nutria`,
});

function captureGuardError(env: Record<string, string | undefined>): SeedGuardError {
  try {
    assertSeedTarget(env);
  } catch (error) {
    expect(error).toBeInstanceOf(SeedGuardError);
    return error as SeedGuardError;
  }
  throw new Error('expected assertSeedTarget to throw');
}

function expectNoSecrets(text: string, env: Record<string, string | undefined>) {
  expect(text).not.toContain(USER);
  expect(text).not.toContain(PASSWORD);
  expect(text).not.toContain('demo_pw_sentinel');
  for (const key of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'DIRECT_URL']) {
    const value = env[key];
    if (value) expect(text).not.toContain(value);
  }
}

describe('seed guard — baselines', () => {
  it('allows the remote baseline (allowlisted Neon endpoint) with synthetic enabled', () => {
    const result = assertSeedTarget(remoteBaseline());
    expect(result.target).toBe(ALLOWED_TARGET);
    expect(result.database).toBe('neondb');
    expect(result.synthetic).toBe(true);
  });

  it('allows the localhost baseline without allowlist and returns synthetic:false', () => {
    const result = assertSeedTarget(localBaseline());
    expect(result.target).toBe('localhost/nutria');
    expect(result.synthetic).toBe(false);
  });
});

describe('seed guard — blocking cases (one variable differs from an allowed baseline)', () => {
  it('NODE_ENV=development with a remote DATABASE_URL outside the allowlist blocks', () => {
    const env = { ...remoteBaseline(), DATABASE_URL: url(OTHER_NEON) };
    expect(captureGuardError(env).code).toBe('target_not_allowed');
  });

  it('blocked target never calls the client/Pool factory (withSeedGuard)', async () => {
    const env = { ...remoteBaseline(), DATABASE_URL: url(OTHER_NEON) };
    const createClient = jest.fn(() => ({ fake: true }));
    const run = jest.fn(async () => 'ran');

    await expect(withSeedGuard(env, createClient, run)).rejects.toBeInstanceOf(SeedGuardError);
    expect(createClient).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('allowed target creates the client exactly once and runs with it (withSeedGuard control)', async () => {
    const client = { fake: true };
    const createClient = jest.fn(() => client);
    const run = jest.fn(async (c: typeof client, target: { target: string }) => `${c.fake}:${target.target}`);

    await expect(withSeedGuard(remoteBaseline(), createClient, run)).resolves.toBe(`true:${ALLOWED_TARGET}`);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('allowed target with a different SEED_CONFIRM_TARGET blocks', () => {
    const env = { ...remoteBaseline(), SEED_CONFIRM_TARGET: 'ep-other-111111.us-east-2.aws.neon.tech/neondb' };
    expect(captureGuardError(env).code).toBe('confirm_target_mismatch');
  });

  it('SEED_SYNTHETIC=true without SEED_CONFIRM_TARGET blocks', () => {
    const env = { ...remoteBaseline(), SEED_CONFIRM_TARGET: undefined };
    expect(captureGuardError(env).code).toBe('confirm_target_mismatch');
  });

  it('allowed DATABASE_URL with DATABASE_URL_UNPOOLED outside the allowlist blocks', () => {
    const env = { ...remoteBaseline(), DATABASE_URL_UNPOOLED: url(OTHER_NEON) };
    expect(captureGuardError(env).code).toBe('target_not_allowed');
  });

  it('allowed DATABASE_URL with DIRECT_URL outside the allowlist blocks', () => {
    const env = { ...remoteBaseline(), DIRECT_URL: url(OTHER_NEON) };
    expect(captureGuardError(env).code).toBe('target_not_allowed');
  });

  it('empty SEED_ALLOWED_TARGETS with a remote host blocks', () => {
    const env = { ...remoteBaseline(), SEED_ALLOWED_TARGETS: '' };
    expect(captureGuardError(env).code).toBe('target_not_allowed');
  });

  it('undefined SEED_ALLOWED_TARGETS with a remote host blocks', () => {
    const env = { ...remoteBaseline(), SEED_ALLOWED_TARGETS: undefined };
    expect(captureGuardError(env).code).toBe('target_not_allowed');
  });

  it.each(['NODE_ENV', 'KPI_ENV', 'VERCEL_ENV'])('%s=production with localhost blocks', (key) => {
    const env = { ...localBaseline(), [key]: 'production' };
    expect(captureGuardError(env).code).toBe('production_env');
  });

  it('SEED_SYNTHETIC=true without SEED_DEMO_PASSWORD blocks', () => {
    const env = { ...remoteBaseline(), SEED_DEMO_PASSWORD: undefined };
    expect(captureGuardError(env).code).toBe('missing_demo_password');
  });

  it('SEED_SYNTHETIC=true with empty SEED_DEMO_PASSWORD blocks', () => {
    const env = { ...remoteBaseline(), SEED_DEMO_PASSWORD: '' };
    expect(captureGuardError(env).code).toBe('missing_demo_password');
  });

  it('missing DATABASE_URL blocks', () => {
    const env = { ...localBaseline(), DATABASE_URL: undefined };
    expect(captureGuardError(env).code).toBe('missing_database_url');
  });

  it('unparseable DATABASE_URL blocks without echoing it', () => {
    const env = { ...localBaseline(), DATABASE_URL: `not a url ${USER}:${PASSWORD}` };
    const error = captureGuardError(env);
    expect(error.code).toBe('invalid_database_url');
    expectNoSecrets(error.message, env);
  });
});

describe('seed guard — localhost always allowed without allowlist', () => {
  it.each([
    ['localhost', 'localhost:5432'],
    ['127.0.0.1', '127.0.0.1:5432'],
    ['::1', '[::1]:5432'],
  ])('%s is allowed with empty SEED_ALLOWED_TARGETS', (_label, hostPort) => {
    const env = {
      ...localBaseline(),
      DATABASE_URL: `postgresql://${USER}:${PASSWORD}@${hostPort}/any_db`,
      SEED_ALLOWED_TARGETS: '',
    };
    const result = assertSeedTarget(env);
    expect(result.database).toBe('any_db');
    expect(result.synthetic).toBe(false);
  });
});

describe('seed guard — Neon -pooler normalization', () => {
  it('pooler and non-pooler variants of the same endpoint normalize to the same target', () => {
    expect(normalizeSeedTarget(url(NEON_POOLER))).toBe(ALLOWED_TARGET);
    expect(normalizeSeedTarget(url(NEON))).toBe(ALLOWED_TARGET);
    expect(normalizeSeedTarget(`postgresql://${USER}:${PASSWORD}@${NEON_POOLER}:5432/neondb`)).toBe(ALLOWED_TARGET);
  });

  it('pooled DATABASE_URL and unpooled DATABASE_URL_UNPOOLED pass with a single allowlist entry', () => {
    const env = { ...remoteBaseline(), DATABASE_URL_UNPOOLED: url(NEON) };
    expect(assertSeedTarget(env).target).toBe(ALLOWED_TARGET);
  });

  it('allowlist entry written in -pooler form also matches', () => {
    const env = { ...remoteBaseline(), SEED_ALLOWED_TARGETS: `${NEON_POOLER}/neondb` };
    expect(assertSeedTarget(env).target).toBe(ALLOWED_TARGET);
  });

  it('a different database on the same endpoint is a different target', () => {
    const env = { ...remoteBaseline(), DATABASE_URL: url(NEON_POOLER, 'otherdb') };
    expect(captureGuardError(env).code).toBe('target_not_allowed');
  });
});

describe('seed guard — base seed without SEED_SYNTHETIC', () => {
  it('allowed remote target without SEED_SYNTHETIC returns synthetic:false (base seed proceeds)', () => {
    const env = { ...remoteBaseline(), SEED_SYNTHETIC: undefined };
    const result = assertSeedTarget(env);
    expect(result.synthetic).toBe(false);
    expect(result.target).toBe(ALLOWED_TARGET);
  });

  it('SEED_SYNTHETIC other than "true" is treated as disabled', () => {
    const env = { ...remoteBaseline(), SEED_SYNTHETIC: 'false' };
    expect(assertSeedTarget(env).synthetic).toBe(false);
  });

  it('base seed does not require SEED_CONFIRM_TARGET nor SEED_DEMO_PASSWORD', () => {
    const env = { ...localBaseline() };
    expect(() => assertSeedTarget(env)).not.toThrow();
  });
});

describe('seed guard — messages never leak credentials or full URLs', () => {
  const blockingEnvs: Array<[string, Record<string, string | undefined>]> = [
    ['remote outside allowlist', { ...remoteBaseline(), DATABASE_URL: url(OTHER_NEON) }],
    ['confirm mismatch', { ...remoteBaseline(), SEED_CONFIRM_TARGET: 'ep-other-111111.us-east-2.aws.neon.tech/neondb' }],
    ['unpooled outside', { ...remoteBaseline(), DATABASE_URL_UNPOOLED: url(OTHER_NEON) }],
    ['direct outside', { ...remoteBaseline(), DIRECT_URL: url(OTHER_NEON) }],
    ['empty allowlist', { ...remoteBaseline(), SEED_ALLOWED_TARGETS: '' }],
    ['production', { ...localBaseline(), NODE_ENV: 'production' }],
    ['missing demo password', { ...remoteBaseline(), SEED_DEMO_PASSWORD: undefined }],
  ];

  it.each(blockingEnvs)('%s: error message and stack contain no user, password or URL', (_label, env) => {
    const error = captureGuardError(env);
    expectNoSecrets(error.message, env);
    expectNoSecrets(String(error.stack ?? ''), env);
    expectNoSecrets(JSON.stringify({ ...error, message: error.message }), env);
  });

  it('the returned SeedTarget (what gets logged) contains no credentials and masks the remote host', () => {
    const env = remoteBaseline();
    const result = assertSeedTarget(env);
    const serialized = JSON.stringify({ maskedHost: result.maskedHost, database: result.database });
    expectNoSecrets(JSON.stringify(result), env);
    expect(serialized).not.toContain('cool-darkness');
    expect(result.maskedHost).not.toBe(NEON);
  });
});
