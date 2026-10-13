// NUT-85 corrección post-review (MAJOR) — GET /health no abre una conexión por request concurrente.
// Contrato fijado:
// - Pings simultáneos comparten la misma promesa de la sonda (single-flight).
// - Un resultado (ok o error/timeout) se reutiliza durante HEALTH_RESULT_TTL_MS = 5000 ms (exportado por
//   health/db-health-probe.ts); pasada la ventana se vuelve a sondear. Un fallo nunca se cachea más que esa ventana.
// - Bodies 200/503, Cache-Control no-store y el límite de 2 s (HEALTH_DB_TIMEOUT_MS) no cambian.
// Controller directo con fake timers (Date.now/performance.now/setTimeout falsos), sin HTTP real.
import { Logger } from '@nestjs/common';
import type { Response } from 'express';
import * as probeModule from '../health/db-health-probe';
import { HEALTH_DB_TIMEOUT_MS } from '../health/db-health-probe';
import type { DbHealthProbe } from '../health/db-health-probe';
import { HealthController } from '../health/health.controller';

const TTL_MS = 5000;
const OK_BODY = { status: 'ok', database: 'ok' };
const ERROR_BODY = { status: 'error', database: 'error' };

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeResponse() {
  const res = { statusCode: 200, status: jest.fn() };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  return res;
}

async function check(controller: HealthController) {
  const res = fakeResponse();
  const body = await controller.check(res as unknown as Response);
  return { status: res.statusCode, body };
}

describe('GET /health — single-flight y ventana corta de reutilización', () => {
  let spies: jest.SpyInstance[] = [];

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-12T15:00:00.000Z'));
    spies = (['log', 'error', 'warn', 'debug', 'verbose'] as const).map(method =>
      jest.spyOn(Logger.prototype, method).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    spies.forEach(spy => spy.mockRestore());
    jest.useRealTimers();
  });

  it('constante de la ventana: HEALTH_RESULT_TTL_MS = 5000 ms; el límite de la sonda sigue en 2 s', () => {
    expect((probeModule as Record<string, unknown>).HEALTH_RESULT_TTL_MS).toBe(TTL_MS);
    expect(HEALTH_DB_TIMEOUT_MS).toBe(2000);
  });

  it('requests simultáneos comparten una sola sonda (una conexión) y todos reciben 200', async () => {
    const pending = deferred();
    const probe: DbHealthProbe = { ping: jest.fn(() => pending.promise) };
    const controller = new HealthController(probe);

    const calls = [check(controller), check(controller), check(controller), check(controller)];
    await jest.advanceTimersByTimeAsync(10);
    expect(probe.ping).toHaveBeenCalledTimes(1);

    pending.resolve();
    const results = await Promise.all(calls);

    expect(probe.ping).toHaveBeenCalledTimes(1);
    for (const result of results) expect(result).toEqual({ status: 200, body: OK_BODY });
  });

  it('un ok se reutiliza dentro de la ventana y se vuelve a sondear al vencer', async () => {
    const probe: DbHealthProbe = { ping: jest.fn(async () => undefined) };
    const controller = new HealthController(probe);

    expect(await check(controller)).toEqual({ status: 200, body: OK_BODY });
    expect(probe.ping).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(TTL_MS - 100);
    expect(await check(controller)).toEqual({ status: 200, body: OK_BODY });
    expect(probe.ping).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(200);
    expect(await check(controller)).toEqual({ status: 200, body: OK_BODY });
    expect(probe.ping).toHaveBeenCalledTimes(2);
  });

  it('un fallo se reutiliza como 503 sólo dentro de la ventana; después se reintenta y puede volver a 200', async () => {
    const ping = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }))
      .mockResolvedValue(undefined);
    const controller = new HealthController({ ping });

    expect(await check(controller)).toEqual({ status: 503, body: ERROR_BODY });
    await jest.advanceTimersByTimeAsync(1000);
    expect(await check(controller)).toEqual({ status: 503, body: ERROR_BODY });
    expect(ping).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(TTL_MS);
    expect(await check(controller)).toEqual({ status: 200, body: OK_BODY });
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it('sonda colgada: requests concurrentes comparten el 503 a los 2 s y, vencida la ventana, se sondea de nuevo', async () => {
    const ping = jest
      .fn<Promise<void>, []>()
      .mockImplementationOnce(() => new Promise<void>(() => undefined))
      .mockResolvedValue(undefined);
    const controller = new HealthController({ ping });

    const first = check(controller);
    await jest.advanceTimersByTimeAsync(500);
    const second = check(controller);
    expect(ping).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(HEALTH_DB_TIMEOUT_MS);
    expect(await first).toEqual({ status: 503, body: ERROR_BODY });
    expect(await second).toEqual({ status: 503, body: ERROR_BODY });
    expect(ping).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(TTL_MS + 100);
    expect(await check(controller)).toEqual({ status: 200, body: OK_BODY });
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it('cada request responde dentro de los 2 s desde que llegó, aunque se una a una sonda en curso', async () => {
    const ping = jest.fn<Promise<void>, []>(() => new Promise<void>(() => undefined));
    const controller = new HealthController({ ping });

    void check(controller);
    await jest.advanceTimersByTimeAsync(1500);
    let settled = false;
    const late = check(controller).then(result => {
      settled = true;
      return result;
    });

    await jest.advanceTimersByTimeAsync(HEALTH_DB_TIMEOUT_MS);
    expect(settled).toBe(true);
    expect(await late).toEqual({ status: 503, body: ERROR_BODY });
  });
});
