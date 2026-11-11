/**
 * NUT-114 — Block 2 (TDD red first): integration of the synthetic loader into `apps/api/prisma/seed.ts`.
 *
 * Expected API of `apps/api/prisma/seed.ts` (module still runs dotenv on import and keeps the
 * `if (process.env.NODE_ENV !== 'test') ...` auto-run gate, which now calls runSeed with the real deps):
 *
 *   export async function runSeed(deps: {
 *     env: Record<string, string | undefined>;              // the ONLY source of configuration (never process.env)
 *     createClient: () => { prisma: any; close(): Promise<void> };
 *     now: () => Date;                                       // instant for the synthetic part
 *     log: (line: string) => void;
 *     hashPassword: (plain: string) => Promise<string>;      // used ONLY for SEED_DEMO_PASSWORD, exactly once
 *   }): Promise<{ exitCode: 0 | 1; summary: string }>;     // never throws; every error -> exitCode 1
 *
 * Order and behavior:
 *   1. Guard (assertSeedTarget / withSeedGuard from ./synthetic/guard) BEFORE createClient. Blocked -> createClient is
 *      never called, exitCode 1, summary carries the (masked) guard message.
 *   2. Base seed exactly as before (seedBaseData + usuario.prueba1-3 upserts, their plan deleteMany/create; base
 *      password hashing stays as it was and does NOT use deps.hashPassword).
 *   3. Only if target.synthetic: hash = await deps.hashPassword(env.SEED_DEMO_PASSWORD) (once);
 *      dataset = generateSyntheticDataset({ users: Number(SEED_SYNTHETIC_USERS ?? 5000) (max 5000), demoPasswordHash: hash,
 *      now: deps.now() }); report = await loadSynthetic(prisma, { dataset, now, batchSize: Number(SEED_BATCH_SIZE ?? 1000),
 *      log }) imported from './synthetic/load'.
 *   4. close() is always called once after createClient (finally).
 * Summary contract:
 *   - total success: exitCode 0 and summary contains "Seeding completado con exito" (synthetic: also "carga masiva OK"
 *     and "current-week OK").
 *   - current-week failure (report.currentWeek.ok === false): exitCode 1, summary contains
 *     "carga masiva OK, current-week FALLÓ" and the error message; never "Seeding completado con exito" nor "current-week OK".
 *   - bulk failure (loadSynthetic rejects with SeedPhaseError): exitCode 1, summary contains the phase and "lote <batch>";
 *     never "carga masiva OK" nor the total-success line.
 *   - logs (deps.log and console) and summary never contain DB user, DB password, demo password, demo hash or a URL.
 */
import { syntheticEmail } from '../seed-data';
import { runSeed } from '../../../prisma/seed';
import { SeedPhaseError, loadSynthetic } from '../../../prisma/synthetic/load';

jest.mock('../../../prisma/synthetic/load', () => {
  const actual = jest.requireActual('../../../prisma/synthetic/load');
  return { ...actual, loadSynthetic: jest.fn() };
});

jest.setTimeout(60_000);

// ---------- expected API shapes (declared locally so this spec type-checks on its own) ----------

interface SpecRunResult { exitCode: 0 | 1; summary: string }
interface SpecDeps {
  env: Record<string, string | undefined>;
  createClient: jest.Mock;
  now: () => Date;
  log: (line: string) => void;
  hashPassword: jest.Mock;
}
type SpecSeedPhaseErrorCtor = new (
  phase: string,
  code: string,
  opts?: { batch?: number; sample?: string[]; message?: string },
) => Error;

// ---------- fixtures ----------

const DB_USER = 'u_sentinel';
const DB_PASSWORD = 'p_sentinel';
const DEMO_PASSWORD = 'demo_pw_sentinel';
const DEMO_HASH = '$2b$04$QL597mIXc6JauPDhUTUPR.uUjvBlSb9NxRWu5xn4egJ78KrMILTNK';
const REMOTE_HOST = 'ep-cool-darkness-123456-pooler.us-east-2.aws.neon.tech';
const NOW = new Date('2026-11-11T15:00:00.000Z');
const SUCCESS = 'Seeding completado con exito';
const ACTIONABLE =
  'current-week: demo.seed.00001 ya tiene un plan actual creado fuera del seed para la semana 2026-11-09. ' +
  'La carga masiva quedó completa y verificada. Para el recorrido, usá ese plan o corré el seed en otra base. ' +
  'No se borró ni modificó ningún dato.';

const loadMock = loadSynthetic as unknown as jest.Mock;
const PhaseError = SeedPhaseError as unknown as SpecSeedPhaseErrorCtor;

const localEnv = (extra: Record<string, string | undefined> = {}) => ({
  NODE_ENV: 'development',
  DATABASE_URL: `postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/nutria_seed`,
  ...extra,
});
const syntheticEnv = (extra: Record<string, string | undefined> = {}) => localEnv({
  SEED_SYNTHETIC: 'true',
  SEED_CONFIRM_TARGET: 'localhost/nutria_seed',
  SEED_DEMO_PASSWORD: DEMO_PASSWORD,
  SEED_SYNTHETIC_USERS: '60',
  ...extra,
});

function baseClient() {
  const calls: Array<{ op: string; args: any }> = [];
  let n = 0;
  const op = (name: string, impl: (args: any) => any) => jest.fn(async (args: any) => {
    calls.push({ op: name, args });
    return impl(args);
  });
  const prisma = {
    ingredient: { upsert: op('ingredient.upsert', (a) => ({ id: `ing-${++n}`, ...a.create })) },
    recipe: { upsert: op('recipe.upsert', (a) => ({ ...a.create })) },
    user: { upsert: op('user.upsert', (a) => ({ id: `user-${++n}`, ...a.create })) },
    nutritionProfile: { upsert: op('nutritionProfile.upsert', (a) => ({ id: `profile-${++n}`, ...a.create })) },
    mealPlan: {
      deleteMany: op('mealPlan.deleteMany', () => ({ count: 0 })),
      create: op('mealPlan.create', (a) => ({ id: `plan-${++n}`, ...a.data })),
    },
    mealPlanDay: { create: op('mealPlanDay.create', (a) => ({ id: `day-${++n}`, ...a.data })) },
  };
  const close = jest.fn(async () => undefined);
  return { prisma, close, calls };
}

function makeDeps(env: Record<string, string | undefined>) {
  const client = baseClient();
  const logs: string[] = [];
  const deps: SpecDeps = {
    env,
    createClient: jest.fn(() => ({ prisma: client.prisma, close: client.close })),
    now: () => NOW,
    log: (line: string) => logs.push(line),
    hashPassword: jest.fn(async () => DEMO_HASH),
  };
  return { deps, client, logs };
}

const consoleLines: string[] = [];
let consoleSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  loadMock.mockReset();
  consoleLines.length = 0;
  consoleSpies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
    jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleLines.push(args.map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : String(arg))).join(' '));
    }));
});

afterEach(() => {
  consoleSpies.forEach((spy) => spy.mockRestore());
});

async function runWith(deps: SpecDeps): Promise<SpecRunResult> {
  return (await runSeed(deps as never)) as SpecRunResult;
}

function expectNoSecrets(result: SpecRunResult, logs: string[]): void {
  for (const text of [result.summary, ...logs, ...consoleLines]) {
    for (const secret of [DB_USER, DB_PASSWORD, DEMO_PASSWORD, DEMO_HASH, '://', REMOTE_HOST]) {
      expect(text).not.toContain(secret);
    }
  }
}

const bulkCounts = {
  ingredients: 60, users: 60, profiles: 60, recipes: 60, plans: 60, days: 420, meals: 1680, completions: 60, shoppingChecks: 60,
};

// ---------- tests ----------

describe('runSeed — guard before any client', () => {
  it('blocked target: createClient is never called, nothing is hashed or loaded, exitCode 1 with a masked message', async () => {
    const { deps, logs } = makeDeps({
      NODE_ENV: 'development',
      DATABASE_URL: `postgresql://${DB_USER}:${DB_PASSWORD}@${REMOTE_HOST}/neondb?sslmode=require`,
    });

    const result = await runWith(deps);

    expect(result.exitCode).toBe(1);
    expect(deps.createClient).not.toHaveBeenCalled();
    expect(deps.hashPassword).not.toHaveBeenCalled();
    expect(loadMock).not.toHaveBeenCalled();
    expect(result.summary).toContain('SEED_ALLOWED_TARGETS');
    expect(result.summary).not.toContain(SUCCESS);
    expectNoSecrets(result, logs);
  });

  it('production env with localhost is blocked before createClient', async () => {
    const { deps } = makeDeps(localEnv({ NODE_ENV: 'production' }));

    const result = await runWith(deps);

    expect(result.exitCode).toBe(1);
    expect(deps.createClient).not.toHaveBeenCalled();
  });
});

describe('runSeed — base only (no SEED_SYNTHETIC)', () => {
  it('runs the base seed as always and performs no synthetic work', async () => {
    const { deps, client, logs } = makeDeps(localEnv());

    const result = await runWith(deps);

    expect(result.exitCode).toBe(0);
    expect(result.summary).toContain(SUCCESS);
    expect(deps.createClient).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(loadMock).not.toHaveBeenCalled();
    expect(deps.hashPassword).not.toHaveBeenCalled();
    const ops = client.calls.map((call) => call.op);
    expect(ops.filter((op) => op === 'ingredient.upsert')).toHaveLength(2);
    expect(ops.filter((op) => op === 'recipe.upsert')).toHaveLength(1);
    expect(client.calls.filter((call) => call.op === 'user.upsert').map((call) => call.args.where.email))
      .toEqual(['usuario.prueba1@nutria.com', 'usuario.prueba2@nutria.com', 'usuario.prueba3@nutria.com']);
    expect(ops.filter((op) => op === 'nutritionProfile.upsert')).toHaveLength(3);
    expect(ops.filter((op) => op === 'mealPlan.deleteMany')).toHaveLength(3);
    expect(ops.filter((op) => op === 'mealPlan.create')).toHaveLength(3);
    expect(ops.filter((op) => op === 'mealPlanDay.create')).toHaveLength(21);
    expect(JSON.stringify(client.calls)).not.toContain(syntheticEmail(1));
    expectNoSecrets(result, logs);
  });
});

describe('runSeed — synthetic part', () => {
  it('total success: hashes the demo password once, loads the generated dataset, exitCode 0', async () => {
    const { deps, client, logs } = makeDeps(syntheticEnv());
    loadMock.mockResolvedValue({
      bulk: { ok: true, counts: bulkCounts },
      currentWeek: { ok: true, counts: { plans: 1, days: 7, meals: 28, completions: 6, shoppingChecks: 20 } },
    });

    const result = await runWith(deps);

    expect(result.exitCode).toBe(0);
    expect(result.summary).toContain('carga masiva OK');
    expect(result.summary).toContain('current-week OK');
    expect(result.summary).toContain(SUCCESS);
    expect(deps.hashPassword).toHaveBeenCalledTimes(1);
    expect(deps.hashPassword).toHaveBeenCalledWith(DEMO_PASSWORD);
    expect(loadMock).toHaveBeenCalledTimes(1);
    const [prismaArg, opts] = loadMock.mock.calls[0];
    expect(prismaArg).toBe(client.prisma);
    expect(opts.now).toEqual(NOW);
    expect(opts.batchSize).toBe(1000);
    expect(opts.dataset.users).toHaveLength(60);
    expect(opts.dataset.users[0].email).toBe(syntheticEmail(1));
    expect(opts.dataset.users[0].passwordHash).toBe(DEMO_HASH);
    expect(client.calls.filter((call) => call.op === 'user.upsert')).toHaveLength(3); // base seed still ran
    expect(client.close).toHaveBeenCalledTimes(1);
    expectNoSecrets(result, logs);
  });

  it('current-week conflict: exitCode 1, "carga masiva OK, current-week FALLÓ" plus the actionable message, no total success', async () => {
    const { deps, client, logs } = makeDeps(syntheticEnv({ SEED_BATCH_SIZE: '250' }));
    loadMock.mockResolvedValue({
      bulk: { ok: true, counts: bulkCounts },
      currentWeek: { ok: false, error: new PhaseError('current-week:plan', 'week_current_conflict', { message: ACTIONABLE }) },
    });

    const result = await runWith(deps);

    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain('carga masiva OK, current-week FALLÓ');
    expect(result.summary).toContain(ACTIONABLE);
    for (const text of [result.summary, ...logs, ...consoleLines]) {
      expect(text).not.toContain(SUCCESS);
      expect(text).not.toContain('current-week OK');
    }
    expect(loadMock.mock.calls[0][1].batchSize).toBe(250);
    expect(deps.hashPassword).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
    expectNoSecrets(result, logs);
  });

  it('bulk failure: exitCode 1 with phase and batch, never "carga masiva OK" nor total success', async () => {
    const { deps, client, logs } = makeDeps(syntheticEnv());
    loadMock.mockRejectedValue(new PhaseError('meals', 'batch_failed', { batch: 2 }));

    const result = await runWith(deps);

    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain('meals');
    expect(result.summary).toContain('lote 2');
    for (const text of [result.summary, ...logs, ...consoleLines]) {
      expect(text).not.toContain('carga masiva OK');
      expect(text).not.toContain(SUCCESS);
    }
    expect(client.close).toHaveBeenCalledTimes(1);
    expectNoSecrets(result, logs);
  });

  it('SEED_SYNTHETIC_USERS above 5000 fails with exitCode 1 and never loads', async () => {
    const { deps, client } = makeDeps(syntheticEnv({ SEED_SYNTHETIC_USERS: '5001' }));

    const result = await runWith(deps);

    expect(result.exitCode).toBe(1);
    expect(loadMock).not.toHaveBeenCalled();
    expect(result.summary).not.toContain(SUCCESS);
    // Validating the volume before or after createClient are both fine; an opened client is always closed.
    expect(client.close).toHaveBeenCalledTimes(deps.createClient.mock.calls.length);
  });
});
