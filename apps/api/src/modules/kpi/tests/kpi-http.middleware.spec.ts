// NUT-85 T3 — Middleware HTTP KPI sobre la app Nest real (listen(0) + http/fetch), escritor falso (B1–B6, B8; D4–D8).
// Contrato fijado:
// - KpiModule (@Global) registra el middleware para todas las rutas (incluidas las no matcheadas) y HealthController.
// - Tokens en kpi.tokens.ts: KPI_CONFIG (KpiConfig), KPI_EVENT_WRITER (escritor), DB_HEALTH_PROBE ({ ping(): Promise<void> }).
// - Por request: insertHttpPending({id, environment, operation:'UNRESOLVED', startedAt}) ANTES del handler,
//   closeHttp({id, operation, outcome, httpStatus, finishedAt, durationMs}) una sola vez, ANTES de completar la respuesta.
// - getKpiRequestContext() expone { operationId, attempts } dentro del handler.
// - Espera acotada por paso (≤ 250 ms) aunque el escritor tarde o falle; logs con código técnico.
// - Al cerrar la app (onApplicationShutdown) drena el escritor.
import { Controller, Get, HttpCode, Logger, NotFoundException, Param, Post } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client, Pool } from 'pg';
import type { HttpCloseEvent, HttpPendingEvent } from '../events/kpi-event-writer';
import { getKpiRequestContext } from '../http/kpi-request-context';
import { KpiModule } from '../kpi.module';
import { DB_HEALTH_PROBE, KPI_CONFIG, KPI_EVENT_WRITER } from '../kpi.tokens';

jest.setTimeout(30_000);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENABLED_DEV = { enabled: true, environment: 'dev', disabledReason: null };
const WAIT_BOUND_MS = 250;

type WriterMode = 'ok' | 'hang' | 'reject';
type WriterCall = { kind: 'insert'; event: HttpPendingEvent } | { kind: 'close'; event: HttpCloseEvent };

class FakeWriter {
  calls: WriterCall[] = [];
  active = 0;
  mode: WriterMode = 'ok';
  drain = jest.fn(async (_timeoutMs?: number) => undefined);
  inFlightCount = jest.fn(() => this.active);

  inserts(): HttpPendingEvent[] {
    return this.calls.flatMap(call => (call.kind === 'insert' ? [call.event] : []));
  }

  closes(): HttpCloseEvent[] {
    return this.calls.flatMap(call => (call.kind === 'close' ? [call.event] : []));
  }

  insertHttpPending(event: HttpPendingEvent): Promise<void> {
    this.calls.push({ kind: 'insert', event });
    return this.run();
  }

  closeHttp(event: HttpCloseEvent): Promise<void> {
    this.calls.push({ kind: 'close', event });
    return this.run();
  }

  reset(): void {
    this.calls = [];
    this.active = 0;
    this.mode = 'ok';
    this.drain.mockClear();
  }

  private run(): Promise<void> {
    if (this.mode === 'hang') return new Promise<void>(() => undefined);
    if (this.mode === 'reject') {
      return Promise.reject(Object.assign(new Error('write failed password=hunter2'), { code: '08006' }));
    }
    this.active += 1;
    return new Promise<void>(resolve =>
      setTimeout(() => {
        this.active -= 1;
        resolve();
      }, 15),
    );
  }
}

class FakeProbe {
  pings = 0;
  ping = jest.fn(async () => {
    this.pings += 1;
  });
}

// --- Estado compartido con los handlers de prueba ---------------------------------------------
let writerRef: FakeWriter | undefined;
let insertsSeenByHandler = -1;
let insertSettledBeforeHandler = false;
let contextSeen: { operationId?: string; hasAttempts?: boolean } | undefined;
const hangers: Array<() => void> = [];

function releaseHangers(): void {
  while (hangers.length > 0) hangers.shift()?.();
}

@Controller('meal-plans')
class MealPlansTestController {
  @Get(':planId')
  get(@Param('planId') planId: string) {
    return { planId };
  }

  @Post(':planId/regenerate')
  @HttpCode(200)
  regenerate() {
    return { ok: true };
  }
}

@Controller('probe')
class ProbeTestController {
  @Get('ok')
  ok() {
    insertsSeenByHandler = writerRef?.inserts().length ?? -1;
    insertSettledBeforeHandler = (writerRef?.active ?? 1) === 0;
    const context = getKpiRequestContext();
    contextSeen = { operationId: context?.operationId, hasAttempts: context?.attempts instanceof Map };
    return { ok: true };
  }

  @Get('not-found')
  notFound() {
    throw new NotFoundException();
  }

  @Get('boom')
  boom() {
    throw new Error('boom');
  }

  @Get('status-408')
  @HttpCode(408)
  requestTimeout() {
    return {};
  }

  @Get('status-504')
  @HttpCode(504)
  gatewayTimeout() {
    return {};
  }

  @Get('hang')
  hang() {
    return new Promise(resolve => hangers.push(() => resolve({ late: true })));
  }
}

@Controller('kpi')
class KpiReportingTestController {
  @Get('report')
  report() {
    return { ok: true };
  }
}

const TEST_CONTROLLERS = [MealPlansTestController, ProbeTestController, KpiReportingTestController];

// --- Utilidades -------------------------------------------------------------------------------
function baseUrl(app: INestApplication): string {
  const address = app.getHttpServer().address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: condición no cumplida a tiempo');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

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
  return {
    text: () => lines.join('\n'),
    count: (needle: string) => lines.filter(line => line.includes(needle)).length,
    clear: () => {
      lines.length = 0;
    },
    restore: () => spies.forEach(spy => spy.mockRestore()),
  };
}

/** Abre una request y corta el socket del cliente a los `afterMs`. */
function requestAndDisconnect(app: INestApplication, path: string, afterMs: number): Promise<void> {
  return new Promise(resolve => {
    const req = httpRequest(`${baseUrl(app)}${path}`, { method: 'GET' });
    req.on('error', () => resolve());
    req.on('close', () => resolve());
    req.end();
    setTimeout(() => req.destroy(), afterMs);
  });
}

async function createApp(options: {
  writer: unknown;
  config?: unknown;
  probe?: unknown;
}): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [KpiModule], controllers: TEST_CONTROLLERS })
    .overrideProvider(KPI_EVENT_WRITER)
    .useValue(options.writer)
    .overrideProvider(DB_HEALTH_PROBE)
    .useValue(options.probe ?? new FakeProbe());
  if (options.config !== undefined) {
    builder = builder.overrideProvider(KPI_CONFIG).useValue(options.config);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  await app.listen(0, '127.0.0.1');
  return app;
}

// ==============================================================================================
describe('KpiHttpMiddleware (app Nest real, escritor falso)', () => {
  let app: INestApplication;
  let writer: FakeWriter;
  let logs: ReturnType<typeof captureLogs>;

  beforeAll(async () => {
    logs = captureLogs();
    writer = new FakeWriter();
    writerRef = writer;
    app = await createApp({ writer, config: ENABLED_DEV });
  });

  afterAll(async () => {
    releaseHangers();
    await app?.close();
    logs.restore();
    writerRef = undefined;
  });

  beforeEach(() => {
    writer.reset();
    logs.clear();
    insertsSeenByHandler = -1;
    insertSettledBeforeHandler = false;
    contextSeen = undefined;
  });

  afterEach(async () => {
    releaseHangers();
    // Deja terminar cierres diferidos de la prueba anterior antes de resetear.
    await new Promise(resolve => setTimeout(resolve, 150));
  });

  describe('B1 — una fila por request: pending antes del handler y cierre del mismo id', () => {
    it('inserta pending (UNRESOLVED, UUID) antes del handler y cierra el mismo id con duration ≥ 0', async () => {
      const response = await fetch(`${baseUrl(app)}/probe/ok`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });

      expect(insertsSeenByHandler).toBe(1);
      expect(insertSettledBeforeHandler).toBe(true);

      expect(writer.calls.map(call => call.kind)).toEqual(['insert', 'close']);
      const [pending] = writer.inserts();
      const [close] = writer.closes();

      expect(pending.id).toMatch(UUID_RE);
      expect(pending.environment).toBe('dev');
      expect(pending.operation).toBe('UNRESOLVED');
      expect(pending.startedAt).toBeInstanceOf(Date);

      expect(close.id).toBe(pending.id);
      expect(close.durationMs).toBeGreaterThanOrEqual(0);
      expect(close.finishedAt.getTime()).toBeGreaterThanOrEqual(pending.startedAt.getTime());
      expect(close.outcome).toBe('success');
      expect(close.httpStatus).toBe(200);
    });

    it('el handler ve el contexto de request con operationId = id del evento', async () => {
      await fetch(`${baseUrl(app)}/probe/ok`);

      expect(contextSeen?.operationId).toBe(writer.inserts()[0].id);
      expect(contextSeen?.hasAttempts).toBe(true);
    });

    it('requests distintas ⇒ ids distintos, una fila (insert+close) por request', async () => {
      await Promise.all([1, 2, 3].map(() => fetch(`${baseUrl(app)}/probe/ok`).then(r => r.text())));

      const ids = writer.inserts().map(event => event.id);
      expect(new Set(ids).size).toBe(3);
      expect(writer.closes().map(event => event.id).sort()).toEqual([...ids].sort());
    });

    it('tras la respuesta el cierre ya terminó: no queda escritura en vuelo', async () => {
      await (await fetch(`${baseUrl(app)}/probe/ok`)).text();

      expect(writer.closes()).toHaveLength(1);
      expect(writer.active).toBe(0);
    });
  });

  describe('B2 — clasificación del cierre', () => {
    it.each([
      ['/probe/ok', 200, 'success', 'GET /probe/ok'],
      ['/probe/not-found', 404, 'client_error', 'GET /probe/not-found'],
      ['/no/existe/esta/ruta', 404, 'client_error', 'UNMATCHED'],
      ['/probe/boom', 500, 'server_error', 'GET /probe/boom'],
      ['/probe/status-408', 408, 'timeout', 'GET /probe/status-408'],
      ['/probe/status-504', 504, 'timeout', 'GET /probe/status-504'],
    ])('%s ⇒ %p %s (%s)', async (path, status, outcome, operation) => {
      const response = await fetch(`${baseUrl(app)}${path}`);
      await response.text();

      expect(response.status).toBe(status);
      expect(writer.inserts()).toHaveLength(1);
      expect(writer.inserts()[0].operation).toBe('UNRESOLVED');
      expect(writer.closes()).toHaveLength(1);
      expect(writer.closes()[0]).toMatchObject({ outcome, httpStatus: status, operation });
    });

    it('el 500 no expone el error del handler al cliente ni lo registra como operation', async () => {
      const response = await fetch(`${baseUrl(app)}/probe/boom`);
      const body = await response.text();

      expect(body).not.toContain('boom');
      expect(writer.closes()[0].operation).toBe('GET /probe/boom');
    });

    it('cliente que corta el socket ⇒ network_error con http_status null, un solo cierre', async () => {
      await requestAndDisconnect(app, '/probe/hang', 100);
      await waitFor(() => writer.closes().length === 1);

      expect(writer.closes()[0]).toMatchObject({
        id: writer.inserts()[0].id,
        outcome: 'network_error',
        httpStatus: null,
        operation: 'GET /probe/hang',
      });

      // El handler termina después: no hay segundo cierre (B3) ni fila nueva.
      releaseHangers();
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(writer.closes()).toHaveLength(1);
      expect(writer.inserts()).toHaveLength(1);
    });

    it('handler que nunca termina ⇒ sólo existe el insert pending (nunca un timeout inferido)', async () => {
      const req = httpRequest(`${baseUrl(app)}/probe/hang`, { method: 'GET' });
      req.on('error', () => undefined);
      req.end();
      try {
        await waitFor(() => writer.inserts().length === 1);
        await new Promise(resolve => setTimeout(resolve, 800));

        expect(writer.inserts()).toHaveLength(1);
        expect(writer.closes()).toHaveLength(0);
      } finally {
        req.destroy();
      }
    });
  });

  describe('B4 — operation es la plantilla de ruta', () => {
    it('GET con UUID, token y userId en la URL ⇒ GET /meal-plans/:planId', async () => {
      const planId = '0b2f6c1e-4c3d-4e5f-9a8b-7c6d5e4f3a2b';
      await (await fetch(`${baseUrl(app)}/meal-plans/${planId}?token=eyJhbGciOi.secret&userId=u-123`)).text();

      const close = writer.closes()[0];
      expect(close.operation).toBe('GET /meal-plans/:planId');
      expect(JSON.stringify(writer.calls)).not.toMatch(/0b2f6c1e|eyJhbGciOi|u-123|token|userId/);
    });

    it('POST anidado ⇒ POST /meal-plans/:planId/regenerate', async () => {
      await (await fetch(`${baseUrl(app)}/meal-plans/abc/regenerate/`, { method: 'POST' })).text();

      expect(writer.closes()[0].operation).toBe('POST /meal-plans/:planId/regenerate');
    });
  });

  describe('B5 — exclusiones', () => {
    it('/health no llama al escritor y responde', async () => {
      const response = await fetch(`${baseUrl(app)}/health`);
      expect(response.status).toBe(200);
      expect(writer.calls).toHaveLength(0);
    });

    it('/kpi/* (reporting) no llama al escritor, aunque la ruta exista o no', async () => {
      expect((await fetch(`${baseUrl(app)}/kpi/report`)).status).toBe(200);
      expect((await fetch(`${baseUrl(app)}/kpi/otra`)).status).toBe(404);
      expect(writer.calls).toHaveLength(0);
    });

    it('OPTIONS no llama al escritor', async () => {
      await (await fetch(`${baseUrl(app)}/meal-plans/abc`, { method: 'OPTIONS' })).text();
      expect(writer.calls).toHaveLength(0);
    });
  });

  describe('B6 — escritor lento o con fallas', () => {
    it('escritor colgado: la respuesta llega con el status de negocio dentro del límite acotado', async () => {
      writer.mode = 'hang';
      const began = Date.now();
      const response = await fetch(`${baseUrl(app)}/probe/ok`);
      const body = await response.json();
      const elapsed = Date.now() - began;

      expect(response.status).toBe(200);
      expect(body).toEqual({ ok: true });
      expect(elapsed).toBeLessThan(2 * WAIT_BOUND_MS + 400);
      expect(logs.text()).toMatch(/KPI_WRITE_[A-Z_]+/);
    });

    it('escritor colgado en un 500 también respeta el status y el límite', async () => {
      writer.mode = 'hang';
      const began = Date.now();
      const response = await fetch(`${baseUrl(app)}/probe/boom`);
      await response.text();

      expect(response.status).toBe(500);
      expect(Date.now() - began).toBeLessThan(2 * WAIT_BOUND_MS + 400);
    });

    it('escritor que rechaza: status de negocio intacto y log con código técnico sin el mensaje', async () => {
      writer.mode = 'reject';
      const ok = await fetch(`${baseUrl(app)}/probe/ok`);
      const notFound = await fetch(`${baseUrl(app)}/no/existe`);
      await ok.text();
      await notFound.text();

      expect(ok.status).toBe(200);
      expect(notFound.status).toBe(404);
      expect(logs.text()).toMatch(/KPI_WRITE_[A-Z_]+/);
      expect(logs.text()).not.toContain('hunter2');
    });
  });
});

// ==============================================================================================
describe('KpiModule — cierre de la app drena el escritor (B6)', () => {
  it('app.close() llama a drain del escritor', async () => {
    const logs = captureLogs();
    const writer = new FakeWriter();
    try {
      const app = await createApp({ writer, config: ENABLED_DEV });
      await (await fetch(`${baseUrl(app)}/probe/ok`)).text();
      await app.close();

      expect(writer.drain).toHaveBeenCalled();
    } finally {
      logs.restore();
    }
  });
});

describe('KpiModule — timeout confirmado por el servidor (B2)', () => {
  it('timeout del socket del servidor ⇒ cierre timeout (no network_error), una sola vez', async () => {
    const logs = captureLogs();
    const writer = new FakeWriter();
    const app = await createApp({ writer, config: ENABLED_DEV });
    try {
      app.getHttpServer().setTimeout(200);
      await new Promise<void>(resolve => {
        const req = httpRequest(`${baseUrl(app)}/probe/hang`, { method: 'GET' });
        req.on('error', () => resolve());
        req.on('response', res => {
          res.resume();
          res.on('end', () => resolve());
        });
        req.on('close', () => resolve());
        req.end();
      });
      await waitFor(() => writer.closes().length >= 1);
      releaseHangers();
      await new Promise(resolve => setTimeout(resolve, 300));

      expect(writer.closes()).toHaveLength(1);
      expect(writer.closes()[0].outcome).toBe('timeout');
      expect(writer.closes()[0].id).toBe(writer.inserts()[0].id);
    } finally {
      releaseHangers();
      await app.close();
      logs.restore();
    }
  });
});

describe('KpiModule — instrumentación deshabilitada (B8)', () => {
  it.each([
    { enabled: false, environment: null, disabledReason: 'KPI_ENV_MISSING' },
    { enabled: false, environment: 'dev', disabledReason: 'KPI_SWITCH_OFF' },
  ])('config %p ⇒ 0 llamadas al escritor y las rutas responden igual', async config => {
    const logs = captureLogs();
    const writer = new FakeWriter();
    const app = await createApp({ writer, config });
    try {
      const ok = await fetch(`${baseUrl(app)}/probe/ok`);
      const missing = await fetch(`${baseUrl(app)}/no/existe`);
      const health = await fetch(`${baseUrl(app)}/health`);

      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ ok: true });
      expect(missing.status).toBe(404);
      expect(health.status).toBe(200);
      expect(writer.calls).toHaveLength(0);
    } finally {
      await app.close();
      logs.restore();
    }
  });
});

// ==============================================================================================
// Factories reales del módulo (sin override de config ni escritor): leen process.env, nunca NODE_ENV.
describe('KpiModule — factories reales (B6, B7, B8)', () => {
  const SAVED_KEYS = ['KPI_ENV', 'KPI_INSTRUMENTATION_ENABLED', 'NODE_ENV', 'DATABASE_URL'] as const;
  let saved: Record<string, string | undefined>;
  let poolConnect: jest.SpyInstance;
  let clientConnect: jest.SpyInstance;
  let logs: ReturnType<typeof captureLogs>;

  // Puerto cerrado: no hay base real detrás (ni la de apps/api/.env).
  const CLOSED_DB_URL = 'postgresql://kpi:kpi@127.0.0.1:1/kpi';

  beforeEach(() => {
    saved = Object.fromEntries(SAVED_KEYS.map(key => [key, process.env[key]]));
    for (const key of SAVED_KEYS) delete process.env[key];
    process.env.DATABASE_URL = CLOSED_DB_URL;
    poolConnect = jest.spyOn(Pool.prototype, 'connect');
    clientConnect = jest.spyOn(Client.prototype, 'connect');
    logs = captureLogs();
  });

  afterEach(() => {
    for (const key of SAVED_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    poolConnect.mockRestore();
    clientConnect.mockRestore();
    logs.restore();
  });

  async function createRealApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [KpiModule], controllers: TEST_CONTROLLERS })
      .overrideProvider(DB_HEALTH_PROBE)
      .useValue(new FakeProbe())
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0, '127.0.0.1');
    return app;
  }

  it('NODE_ENV=production sin KPI_ENV ⇒ arranca, responde, loguea KPI_ENV_MISSING una vez y no abre conexiones KPI', async () => {
    process.env.NODE_ENV = 'production';
    const app = await createRealApp();
    try {
      expect((await fetch(`${baseUrl(app)}/probe/ok`)).status).toBe(200);
      expect((await fetch(`${baseUrl(app)}/meal-plans/x`)).status).toBe(200);

      expect(logs.count('KPI_ENV_MISSING')).toBe(1);
      expect(poolConnect).not.toHaveBeenCalled();
      expect(clientConnect).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('KPI_ENV inválido ⇒ arranca, loguea KPI_ENV_INVALID sin el valor y no abre conexiones KPI', async () => {
    process.env.KPI_ENV = 'production';
    const app = await createRealApp();
    try {
      expect((await fetch(`${baseUrl(app)}/probe/ok`)).status).toBe(200);
      expect(logs.count('KPI_ENV_INVALID')).toBe(1);
      expect(logs.text()).not.toContain('production');
      expect(poolConnect).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('KPI_INSTRUMENTATION_ENABLED=false con KPI_ENV=dev ⇒ la app funciona sin tocar tablas KPI', async () => {
    process.env.KPI_ENV = 'dev';
    process.env.KPI_INSTRUMENTATION_ENABLED = 'false';
    const app = await createRealApp();
    try {
      expect((await fetch(`${baseUrl(app)}/probe/ok`)).status).toBe(200);
      expect((await fetch(`${baseUrl(app)}/health`)).status).toBe(200);
      expect(poolConnect).not.toHaveBeenCalled();
      expect(clientConnect).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('interruptor inválido ⇒ deshabilitado con KPI_SWITCH_INVALID, sin conexiones', async () => {
    process.env.KPI_ENV = 'dev';
    process.env.KPI_INSTRUMENTATION_ENABLED = 'yes';
    const app = await createRealApp();
    try {
      expect((await fetch(`${baseUrl(app)}/probe/ok`)).status).toBe(200);
      expect(logs.count('KPI_SWITCH_INVALID')).toBe(1);
      expect(poolConnect).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('habilitado con DB KPI caída ⇒ el negocio responde igual en tiempo acotado y se loguea código técnico', async () => {
    process.env.KPI_ENV = 'dev';
    const app = await createRealApp();
    try {
      const began = Date.now();
      const response = await fetch(`${baseUrl(app)}/probe/ok`);
      const body = await response.json();
      const elapsed = Date.now() - began;

      expect(response.status).toBe(200);
      expect(body).toEqual({ ok: true });
      expect(elapsed).toBeLessThan(2 * WAIT_BOUND_MS + 600);
      expect(logs.text()).toMatch(/KPI_WRITE_(FAILED|TIMEOUT|WAIT_EXCEEDED)/);
      expect(logs.text()).not.toContain(CLOSED_DB_URL);
      expect(logs.text()).not.toMatch(/kpi:kpi@/);
    } finally {
      const closing = Date.now();
      await app.close();
      // drain acotado (1 s) + margen
      expect(Date.now() - closing).toBeLessThan(2500);
    }
  });
});
