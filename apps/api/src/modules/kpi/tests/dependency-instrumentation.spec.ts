import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import type { KpiConfig } from '../config/kpi-config';
import {
  KpiDependencyInstrumentation,
  NOOP_DEPENDENCY_INSTRUMENTATION,
} from '../dependencies/dependency-instrumentation';
import type { DependencyCallResult, DependencyTerminalOutcome } from '../dependencies/dependency-instrumentation';
import { NoopKpiEventWriter } from '../events/kpi-event-writer';
import type { DependencyCloseEvent, DependencyPendingEvent, KpiEventWriter } from '../events/kpi-event-writer';
import { runWithKpiRequestContext } from '../http/kpi-request-context';
import { DEPENDENCY_INSTRUMENTATION } from '../kpi.tokens';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENABLED_DEV: KpiConfig = { enabled: true, environment: 'dev', disabledReason: null };
const DISABLED: KpiConfig = { enabled: false, environment: null, disabledReason: 'KPI_ENV_MISSING' };

type Mode = 'ok' | 'reject' | 'throw' | 'hang';

function fakeWriter(mode: Mode = 'ok') {
  const pending: DependencyPendingEvent[] = [];
  const closed: DependencyCloseEvent[] = [];
  const act = <E>(list: E[]) => (event: E): Promise<void> => {
    list.push(event);
    if (mode === 'reject') return Promise.reject(new Error('db down postgresql://user:secret@host/db'));
    if (mode === 'throw') throw new Error('sync failure');
    if (mode === 'hang') return new Promise<void>(() => undefined);
    return Promise.resolve();
  };
  const writer: KpiEventWriter = {
    insertHttpPending: jest.fn(async () => undefined),
    closeHttp: jest.fn(async () => undefined),
    insertDependencyPending: jest.fn(act(pending)),
    closeDependency: jest.fn(act(closed)),
    drain: jest.fn(async () => undefined),
    inFlightCount: () => 0,
  };
  type Row = DependencyPendingEvent & { outcome: string; finishedAt?: Date; durationMs?: number };
  const rows = (): Row[] =>
    pending.map(p => ({ ...p, outcome: 'pending', ...closed.find(c => c.id === p.id) }));
  return { writer, pending, closed, rows };
}

function inRequest<T>(fn: () => Promise<T>, operationId: string = randomUUID()): Promise<T> {
  return runWithKpiRequestContext({ operationId, attempts: new Map() }, fn);
}

const success = (r: DependencyCallResult<unknown>): DependencyTerminalOutcome => (r.ok ? 'success' : 'error');

beforeEach(() => {
  for (const method of ['log', 'error', 'warn', 'debug', 'verbose'] as const) {
    jest.spyOn(Logger.prototype, method).mockImplementation(() => undefined);
    jest.spyOn(Logger, method).mockImplementation(() => undefined);
  }
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('DependencyInstrumentation — contrato', () => {
  it('kpi.tokens exporta DEPENDENCY_INSTRUMENTATION', () => {
    expect(DEPENDENCY_INSTRUMENTATION).toBeDefined();
  });

  it('noop ejecuta la llamada sin escribir y devuelve/relanza lo mismo', async () => {
    const value = { raw: 'x' };
    await expect(NOOP_DEPENDENCY_INSTRUMENTATION.run('gemini', async () => value, success)).resolves.toBe(value);
    const error = new Error('boom');
    await expect(
      NOOP_DEPENDENCY_INSTRUMENTATION.run('gemini', async () => Promise.reject(error), success),
    ).rejects.toBe(error);
  });

  it('NoopKpiEventWriter implementa las escrituras de dependencia sin hacer nada', async () => {
    const writer = new NoopKpiEventWriter();
    await expect(
      writer.insertDependencyPending({
        id: randomUUID(), environment: 'dev', operationId: randomUUID(), dependency: 'gemini', attempt: 1, startedAt: new Date(),
      }),
    ).resolves.toBeUndefined();
    await expect(
      writer.closeDependency({ id: randomUUID(), outcome: 'success', finishedAt: new Date(), durationMs: 1 }),
    ).resolves.toBeUndefined();
  });

  it('deshabilitada ⇒ ejecuta la llamada y hace 0 llamadas al escritor', async () => {
    const { writer } = fakeWriter();
    const instrumentation = new KpiDependencyInstrumentation(DISABLED, writer);
    const call = jest.fn(async () => 42);

    await expect(inRequest(() => instrumentation.run('gemini', call, success))).resolves.toBe(42);

    expect(call).toHaveBeenCalledTimes(1);
    expect(writer.insertDependencyPending).not.toHaveBeenCalled();
    expect(writer.closeDependency).not.toHaveBeenCalled();
  });
});

describe('KpiDependencyInstrumentation — filas por intento (C2)', () => {
  it('pending ANTES de la llamada y cierre DESPUÉS, con el mismo id, environment y duración ≥ 0', async () => {
    const { writer, rows } = fakeWriter();
    const instrumentation = new KpiDependencyInstrumentation(ENABLED_DEV, writer);
    const operationId = randomUUID();
    const call = jest.fn(async () => 'ok');

    await inRequest(() => instrumentation.run('gemini', call, success), operationId);

    const insertOrder = (writer.insertDependencyPending as jest.Mock).mock.invocationCallOrder[0];
    const callOrder = call.mock.invocationCallOrder[0];
    const closeOrder = (writer.closeDependency as jest.Mock).mock.invocationCallOrder[0];
    expect(insertOrder).toBeLessThan(callOrder);
    expect(callOrder).toBeLessThan(closeOrder);

    const [row] = rows();
    expect(rows()).toHaveLength(1);
    expect(row).toEqual({
      id: expect.stringMatching(UUID_RE),
      environment: 'dev',
      operationId,
      dependency: 'gemini',
      attempt: 1,
      startedAt: expect.any(Date),
      outcome: 'success',
      finishedAt: expect.any(Date),
      durationMs: expect.any(Number),
    });
    expect(Number.isFinite(row.durationMs)).toBe(true);
    expect(row.durationMs as number).toBeGreaterThanOrEqual(0);
    expect((row.finishedAt as Date).getTime()).toBeGreaterThanOrEqual(row.startedAt.getTime());
  });

  it('attempts 1,2,3 por (operation_id, dependency) dentro de una request; cada dependencia cuenta aparte', async () => {
    const { writer, rows } = fakeWriter();
    const instrumentation = new KpiDependencyInstrumentation(ENABLED_DEV, writer);
    const operationId = randomUUID();

    await inRequest(async () => {
      await instrumentation.run('gemini', async () => 1, success);
      await instrumentation.run('unsplash_search', async () => 1, success);
      await instrumentation.run('gemini', async () => 2, success);
      await instrumentation.run('gemini', async () => 3, success);
      await instrumentation.run('unsplash_download', async () => 1, success);
    }, operationId);

    const summary = rows().map(r => [r.operationId, r.dependency, r.attempt]);
    expect(summary).toEqual([
      [operationId, 'gemini', 1],
      [operationId, 'unsplash_search', 1],
      [operationId, 'gemini', 2],
      [operationId, 'gemini', 3],
      [operationId, 'unsplash_download', 1],
    ]);
    expect(new Set(rows().map(r => r.id)).size).toBe(5);
  });

  it('concurrencia 3 produce attempts únicos 1..3 (incremento sincrónico al iniciar)', async () => {
    const { writer, rows } = fakeWriter();
    const instrumentation = new KpiDependencyInstrumentation(ENABLED_DEV, writer);

    await inRequest(() =>
      Promise.all([1, 2, 3].map(n => instrumentation.run('unsplash_search', async () => n, success))),
    );

    expect(rows().map(r => r.attempt).sort()).toEqual([1, 2, 3]);
    expect(new Set(rows().map(r => r.operationId)).size).toBe(1);
  });

  it('dos requests distintas no comparten contador', async () => {
    const { writer, rows } = fakeWriter();
    const instrumentation = new KpiDependencyInstrumentation(ENABLED_DEV, writer);
    const a = randomUUID();
    const b = randomUUID();

    await inRequest(() => instrumentation.run('gemini', async () => 1, success), a);
    await inRequest(() => instrumentation.run('gemini', async () => 1, success), b);

    expect(rows().map(r => [r.operationId, r.attempt])).toEqual([[a, 1], [b, 1]]);
  });

  it('fuera de request genera un operation_id (UUID) nuevo por invocación, siempre attempt 1', async () => {
    const { writer, rows } = fakeWriter();
    const instrumentation = new KpiDependencyInstrumentation(ENABLED_DEV, writer);

    await instrumentation.run('unsplash_download', async () => 1, success);
    await instrumentation.run('unsplash_download', async () => 2, success);

    const [first, second] = rows();
    expect(rows()).toHaveLength(2);
    expect(first.operationId).toMatch(UUID_RE);
    expect(second.operationId).toMatch(UUID_RE);
    expect(first.operationId).not.toBe(second.operationId);
    expect([first.attempt, second.attempt]).toEqual([1, 1]);
  });

  it.each([
    ['success', { ok: true }],
    ['error', { ok: false }],
    ['timeout', { ok: false }],
  ] as const)('el outcome de la fila es el que devuelve classify: %s', async (outcome, shape) => {
    const { writer, rows } = fakeWriter();
    const instrumentation = new KpiDependencyInstrumentation(ENABLED_DEV, writer);
    const error = new Error('x');
    const call = shape.ok ? async () => 'v' : async () => Promise.reject(error);
    const classify = jest.fn(() => outcome);

    await inRequest(() => instrumentation.run('gemini', call, classify)).catch(() => undefined);

    expect(classify).toHaveBeenCalledWith(shape.ok ? { ok: true, value: 'v' } : { ok: false, error });
    expect(rows()[0].outcome).toBe(outcome);
  });

  it('devuelve el mismo valor y relanza el mismo error (identidad)', async () => {
    const { writer } = fakeWriter();
    const instrumentation = new KpiDependencyInstrumentation(ENABLED_DEV, writer);
    const value = { body: 'same' };
    const error = new TypeError('fetch failed');

    await expect(inRequest(() => instrumentation.run('gemini', async () => value, success))).resolves.toBe(value);
    await expect(
      inRequest(() => instrumentation.run('gemini', async () => Promise.reject(error), success)),
    ).rejects.toBe(error);
  });

  it('las filas no contienen URL, query ni claves: sólo nombres fijos de dependencia', async () => {
    const { writer } = fakeWriter();
    const instrumentation = new KpiDependencyInstrumentation(ENABLED_DEV, writer);
    const secret = 'Client-ID super-secret-access-key';

    await inRequest(async () => {
      await instrumentation.run('unsplash_search', async () => ({ url: `https://api.unsplash.com/search/photos?query=quinoa`, secret }), success);
      await instrumentation.run('unsplash_download', async () => Promise.reject(new Error(`GET https://api.unsplash.com/photos/x/download ${secret}`)), () => 'error').catch(() => undefined);
      await instrumentation.run('gemini', async () => 'raw', success);
    });

    const calls = [
      ...(writer.insertDependencyPending as jest.Mock).mock.calls,
      ...(writer.closeDependency as jest.Mock).mock.calls,
    ];
    const serialized = JSON.stringify(calls);
    expect(serialized).not.toMatch(/https?:|unsplash\.com|query|quinoa|secret|Client-ID|access[_-]?key/i);
    const pendings = (writer.insertDependencyPending as jest.Mock).mock.calls.map(([e]) => e as DependencyPendingEvent);
    expect(pendings.map(e => e.dependency)).toEqual(['unsplash_search', 'unsplash_download', 'gemini']);
    for (const event of pendings) {
      expect(Object.keys(event).sort()).toEqual(['attempt', 'dependency', 'environment', 'id', 'operationId', 'startedAt']);
    }
    for (const [event] of (writer.closeDependency as jest.Mock).mock.calls) {
      expect(Object.keys(event).sort()).toEqual(['durationMs', 'finishedAt', 'id', 'outcome']);
    }
  });
});

describe('KpiDependencyInstrumentation — fallos del escritor no cambian el negocio', () => {
  it.each(['reject', 'throw'] as const)('escritor que %s ⇒ mismo valor y mismo error', async mode => {
    const { writer } = fakeWriter(mode);
    const instrumentation = new KpiDependencyInstrumentation(ENABLED_DEV, writer);
    const value = { ok: 1 };
    const error = new Error('provider');
    const call = jest.fn(async () => value);

    await expect(inRequest(() => instrumentation.run('gemini', call, success))).resolves.toBe(value);
    expect(call).toHaveBeenCalledTimes(1);
    await expect(
      inRequest(() => instrumentation.run('gemini', async () => Promise.reject(error), success)),
    ).rejects.toBe(error);
  });

  it('escritor colgado ⇒ cada paso espera acotado (≤ 250 ms) y devuelve el mismo valor', async () => {
    const { writer } = fakeWriter('hang');
    const instrumentation = new KpiDependencyInstrumentation(ENABLED_DEV, writer);
    const started = Date.now();

    await expect(inRequest(() => instrumentation.run('gemini', async () => 'v', success))).resolves.toBe('v');

    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('el fallo del escritor no se loguea con el mensaje del error (puede traer la URL de conexión)', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    const staticWarn = jest.spyOn(Logger, 'warn');
    const { writer } = fakeWriter('reject');
    const instrumentation = new KpiDependencyInstrumentation(ENABLED_DEV, writer);

    await inRequest(() => instrumentation.run('gemini', async () => 'v', success));
    await new Promise(resolve => setImmediate(resolve));

    const logged = JSON.stringify([...warn.mock.calls, ...staticWarn.mock.calls]);
    expect(logged).not.toMatch(/postgresql:|secret/);
  });
});
