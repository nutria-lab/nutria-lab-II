import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import type { AddressInfo } from 'node:net';
import * as path from 'path';
import { HEALTH_DB_TIMEOUT_MS } from '../health/db-health-probe';
import { KpiModule } from '../kpi.module';
import { DB_HEALTH_PROBE, KPI_CONFIG, KPI_EVENT_WRITER } from '../kpi.tokens';

jest.setTimeout(30_000);

const OK_BODY = { status: 'ok', database: 'ok' };
const ERROR_BODY = { status: 'error', database: 'error' };

type ProbeBehavior = () => Promise<void>;

function captureLogs() {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  };
  const spies: jest.SpyInstance[] = [];
  for (const method of ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const) {
    spies.push(jest.spyOn(Logger.prototype, method).mockImplementation(record));
    spies.push(jest.spyOn(Logger, method).mockImplementation(record));
  }
  for (const method of ['log', 'error', 'warn', 'info', 'debug'] as const) {
    spies.push(jest.spyOn(console, method).mockImplementation(record));
  }
  return { text: () => lines.join('\n'), restore: () => spies.forEach(spy => spy.mockRestore()) };
}

const writer = {
  insertHttpPending: jest.fn(async () => undefined),
  closeHttp: jest.fn(async () => undefined),
  drain: jest.fn(async () => undefined),
  inFlightCount: jest.fn(() => 0),
};

async function createApp(behavior: ProbeBehavior, config: unknown): Promise<INestApplication> {
  const probe = { ping: jest.fn(behavior) };
  const moduleRef = await Test.createTestingModule({ imports: [KpiModule] })
    .overrideProvider(DB_HEALTH_PROBE)
    .useValue(probe)
    .overrideProvider(KPI_EVENT_WRITER)
    .useValue(writer)
    .overrideProvider(KPI_CONFIG)
    .useValue(config)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  await app.listen(0, '127.0.0.1');
  return app;
}

async function getHealth(app: INestApplication) {
  const { port } = app.getHttpServer().address() as AddressInfo;
  const began = Date.now();
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  const text = await response.text();
  return { response, text, elapsed: Date.now() - began };
}

describe('GET /health (D1)', () => {
  let logs: ReturnType<typeof captureLogs>;
  let app: INestApplication | undefined;

  beforeEach(() => {
    logs = captureLogs();
    writer.insertHttpPending.mockClear();
    writer.closeHttp.mockClear();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    logs.restore();
  });

  it('el límite de la sonda es 2 s', () => {
    expect(HEALTH_DB_TIMEOUT_MS).toBe(2000);
  });

  it('sonda ok ⇒ 200 {"status":"ok","database":"ok"} con Cache-Control no-store', async () => {
    app = await createApp(async () => undefined, { enabled: true, environment: 'dev', disabledReason: null });
    const { response, text } = await getHealth(app);

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual(OK_BODY);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(writer.insertHttpPending).not.toHaveBeenCalled();
    expect(writer.closeHttp).not.toHaveBeenCalled();
  });

  it('sonda que falla ⇒ 503 con body exacto, sin mensaje de error ni credenciales', async () => {
    app = await createApp(
      () =>
        Promise.reject(
          Object.assign(new Error('connect ECONNREFUSED postgresql://admin:hunter2@db.internal:5432/nutria'), {
            code: 'ECONNREFUSED',
          }),
        ),
      { enabled: true, environment: 'dev', disabledReason: null },
    );
    const { response, text } = await getHealth(app);

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual(ERROR_BODY);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(text).not.toMatch(/ECONNREFUSED|hunter2|postgresql|stack|message/i);
    expect(logs.text()).toContain('HEALTH_DB_ERROR');
    expect(logs.text()).not.toMatch(/hunter2|postgresql:\/\//);
  });

  it('sonda que tarda más de 2 s ⇒ 503 al cumplirse el límite', async () => {
    app = await createApp(() => new Promise<void>(() => undefined), {
      enabled: true,
      environment: 'dev',
      disabledReason: null,
    });
    const { response, text, elapsed } = await getHealth(app);

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual(ERROR_BODY);
    expect(elapsed).toBeGreaterThanOrEqual(HEALTH_DB_TIMEOUT_MS - 100);
    expect(elapsed).toBeLessThan(HEALTH_DB_TIMEOUT_MS + 700);
    expect(logs.text()).toContain('HEALTH_DB_TIMEOUT');
  });

  it('funciona con KPI_ENV ausente e instrumentación apagada', async () => {
    app = await createApp(async () => undefined, {
      enabled: false,
      environment: null,
      disabledReason: 'KPI_ENV_MISSING',
    });
    const { response, text } = await getHealth(app);

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual(OK_BODY);
  });

  // Header X-KPI-Instrumentation según la config KPI efectiva; body y status sin cambios.
  it.each([
    ['habilitada', { enabled: true, environment: 'dev', disabledReason: null }, 'enabled'],
    ['apagada por switch false', { enabled: false, environment: 'dev', disabledReason: 'KPI_SWITCH_OFF' }, 'disabled'],
    ['switch inválido', { enabled: false, environment: 'qa', disabledReason: 'KPI_SWITCH_INVALID' }, 'disabled'],
    ['sin KPI_ENV', { enabled: false, environment: null, disabledReason: 'KPI_ENV_MISSING' }, 'disabled'],
    ['KPI_ENV inválido', { enabled: false, environment: null, disabledReason: 'KPI_ENV_INVALID' }, 'disabled'],
  ])('instrumentación %s ⇒ 200, body exacto y X-KPI-Instrumentation: %s', async (_name, config, expected) => {
    app = await createApp(async () => undefined, config);
    const { response, text } = await getHealth(app);

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual(OK_BODY);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-kpi-instrumentation')).toBe(expected);
  });

  it.each([
    ['habilitada', { enabled: true, environment: 'prod', disabledReason: null }, 'enabled'],
    ['apagada', { enabled: false, environment: 'prod', disabledReason: 'KPI_SWITCH_OFF' }, 'disabled'],
  ])('DB caída con instrumentación %s ⇒ 503, body exacto y X-KPI-Instrumentation: %s', async (_name, config, expected) => {
    app = await createApp(() => Promise.reject(new Error('down')), config);
    const { response, text } = await getHealth(app);

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual(ERROR_BODY);
    expect(response.headers.get('x-kpi-instrumentation')).toBe(expected);
  });

  it('el código de health no depende de IA ni de módulos de negocio', () => {
    const dir = path.resolve(__dirname, '../health');
    const sources = fs
      .readdirSync(dir)
      .filter(name => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
      .map(name => fs.readFileSync(path.join(dir, name), 'utf-8'))
      .join('\n');

    expect(sources).toMatch(/SELECT 1/);
    expect(sources).not.toMatch(/gemini|unsplash|generative|openai|modules\/plans|modules\/recipe|dotenv/i);
  });
});
