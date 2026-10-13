// NUT-85 corrección post-review (CRITICAL) — la sonda de /health no manda statement_timeout como parámetro de
// arranque (el pooler PgBouncer de Neon puede rechazar parámetros de startup). Sigue con query_timeout y
// connectionTimeoutMillis = HEALTH_DB_TIMEOUT_MS (2 s), SELECT 1 y liberación siempre. Unit con `pg` simulado.
const clientOptions: Array<Record<string, unknown>> = [];
const clientInstances: Array<{ query: jest.Mock; end: jest.Mock; connect: jest.Mock }> = [];

jest.mock('pg', () => {
  const actual = jest.requireActual('pg');
  return {
    ...actual,
    Client: jest.fn().mockImplementation((options: Record<string, unknown>) => {
      clientOptions.push(options);
      const instance = {
        on: jest.fn(),
        connect: jest.fn(async () => undefined),
        query: jest.fn(async () => ({ rows: [{ '?column?': 1 }] })),
        end: jest.fn(async () => undefined),
      };
      clientInstances.push(instance);
      return instance;
    }),
  };
});

import { HEALTH_DB_TIMEOUT_MS, PgDbHealthProbe } from '../health/db-health-probe';

describe('PgDbHealthProbe — sin parámetros de arranque', () => {
  beforeEach(() => {
    clientOptions.length = 0;
    clientInstances.length = 0;
  });

  it('el Client no recibe statement_timeout de startup; conserva query_timeout y connect timeout de 2 s', async () => {
    const probe = new PgDbHealthProbe('postgresql://kpi:kpi@127.0.0.1:5432/kpi');

    await probe.ping();

    expect(clientOptions).toHaveLength(1);
    const options = clientOptions[0];
    expect(options.statement_timeout).toBeUndefined();
    expect(options.idle_in_transaction_session_timeout).toBeUndefined();
    expect(String(options.options ?? '')).not.toMatch(/statement_timeout/i);
    expect(String(options.connectionString ?? '')).not.toMatch(/statement_timeout/i);
    expect(options.query_timeout).toBe(HEALTH_DB_TIMEOUT_MS);
    expect(options.connectionTimeoutMillis).toBe(HEALTH_DB_TIMEOUT_MS);
  });

  it('hace SELECT 1 y libera la conexión', async () => {
    await new PgDbHealthProbe('postgresql://kpi:kpi@127.0.0.1:5432/kpi').ping();

    const [client] = clientInstances;
    expect(client.query).toHaveBeenCalledWith('SELECT 1');
    expect(client.end).toHaveBeenCalledTimes(1);
  });
});
