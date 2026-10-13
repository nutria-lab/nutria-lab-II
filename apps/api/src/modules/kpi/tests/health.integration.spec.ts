import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { HEALTH_DB_TIMEOUT_MS, PgDbHealthProbe } from '../health/db-health-probe';
import { KpiModule } from '../kpi.module';
import { describeIfKpiDb, kpiTestDatabaseUrl } from './kpi-test-db.fixture';

jest.setTimeout(30_000);

const CLOSED_PORT_URL = 'postgresql://kpi:kpi@127.0.0.1:1/kpi';
const ENV_KEYS = ['DATABASE_URL', 'KPI_ENV', 'KPI_INSTRUMENTATION_ENABLED'] as const;

describeIfKpiDb('health (integración Postgres)', () => {
  let saved: Record<string, string | undefined>;
  let spies: jest.SpyInstance[] = [];

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    // Instrumentación apagada: estas pruebas sólo ejercitan la sonda.
    process.env.KPI_ENV = 'dev';
    process.env.KPI_INSTRUMENTATION_ENABLED = 'false';
    spies = (['log', 'error', 'warn', 'debug', 'verbose'] as const).map(method =>
      jest.spyOn(Logger.prototype, method).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    spies.forEach(spy => spy.mockRestore());
  });

  async function healthWith(databaseUrl: string) {
    process.env.DATABASE_URL = databaseUrl;
    const moduleRef = await Test.createTestingModule({ imports: [KpiModule] }).compile();
    const app: INestApplication = moduleRef.createNestApplication({ logger: false });
    await app.init();
    await app.listen(0, '127.0.0.1');
    try {
      const { port } = app.getHttpServer().address() as AddressInfo;
      const began = Date.now();
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      const body = await response.json();
      return { status: response.status, body, elapsed: Date.now() - began };
    } finally {
      await app.close();
    }
  }

  it('PgDbHealthProbe: SELECT 1 real resuelve', async () => {
    const probe = new PgDbHealthProbe(kpiTestDatabaseUrl() as string);
    await expect(probe.ping()).resolves.toBeUndefined();
  });

  it('PgDbHealthProbe: puerto cerrado rechaza dentro del límite', async () => {
    const probe = new PgDbHealthProbe(CLOSED_PORT_URL);
    const began = Date.now();
    await expect(probe.ping()).rejects.toBeDefined();
    expect(Date.now() - began).toBeLessThan(HEALTH_DB_TIMEOUT_MS + 500);
  });

  it('GET /health con la DB de test ⇒ 200 {"status":"ok","database":"ok"}', async () => {
    const result = await healthWith(kpiTestDatabaseUrl() as string);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: 'ok', database: 'ok' });
  });

  it('GET /health con URL a puerto cerrado ⇒ 503 exacto en ≤ 2 s + margen', async () => {
    const result = await healthWith(CLOSED_PORT_URL);
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ status: 'error', database: 'error' });
    expect(result.elapsed).toBeLessThan(HEALTH_DB_TIMEOUT_MS + 700);
  });
});
