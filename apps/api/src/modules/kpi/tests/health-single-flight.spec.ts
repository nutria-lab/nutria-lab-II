import { Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { KpiConfig } from '../config/kpi-config';
import * as probeModule from '../health/db-health-probe';
import { HEALTH_DB_TIMEOUT_MS } from '../health/db-health-probe';
import type { DbHealthProbe } from '../health/db-health-probe';
import { HealthController } from '../health/health.controller';

const OK_BODY = { status: 'ok', database: 'ok' };
const ERROR_BODY = { status: 'error', database: 'error' };
const ENABLED: KpiConfig = { enabled: true, environment: 'dev', disabledReason: null };
const DISABLED: KpiConfig = { enabled: false, environment: 'dev', disabledReason: 'KPI_SWITCH_OFF' };

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

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  status: jest.Mock;
  setHeader: jest.Mock;
  header: jest.Mock;
  set: jest.Mock;
}

function fakeResponse(): FakeResponse {
  const headers: Record<string, string> = {};
  const res: FakeResponse = {
    statusCode: 200,
    headers,
    status: jest.fn(),
    setHeader: jest.fn(),
    header: jest.fn(),
    set: jest.fn(),
  };
  const record = (name: string, value: unknown): FakeResponse => {
    headers[name.toLowerCase()] = String(value);
    return res;
  };
  res.setHeader.mockImplementation(record);
  res.header.mockImplementation(record);
  res.set.mockImplementation(record);
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

async function checkWithHeaders(controller: HealthController) {
  const res = fakeResponse();
  const body = await controller.check(res as unknown as Response);
  return { status: res.statusCode, body, instrumentation: res.headers['x-kpi-instrumentation'] };
}

describe('GET /health — single-flight sin cachear resultados terminados', () => {
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

  it('no exporta una ventana de cache; el límite de la sonda sigue en 2 s', () => {
    expect(probeModule).not.toHaveProperty('HEALTH_RESULT_TTL_MS');
    expect(HEALTH_DB_TIMEOUT_MS).toBe(2000);
  });

  it('requests simultáneos comparten una sola sonda (una conexión) y todos reciben 200', async () => {
    const pending = deferred();
    const probe: DbHealthProbe = { ping: jest.fn(() => pending.promise) };
    const controller = new HealthController(probe, ENABLED);

    const calls = [check(controller), check(controller), check(controller), check(controller)];
    await jest.advanceTimersByTimeAsync(10);
    expect(probe.ping).toHaveBeenCalledTimes(1);

    pending.resolve();
    const results = await Promise.all(calls);

    expect(probe.ping).toHaveBeenCalledTimes(1);
    for (const result of results) expect(result).toEqual({ status: 200, body: OK_BODY });
  });

  it('vuelve a consultar la DB en cada petición no concurrente', async () => {
    const probe: DbHealthProbe = { ping: jest.fn(async () => undefined) };
    const controller = new HealthController(probe, ENABLED);

    expect(await check(controller)).toEqual({ status: 200, body: OK_BODY });
    expect(probe.ping).toHaveBeenCalledTimes(1);

    expect(await check(controller)).toEqual({ status: 200, body: OK_BODY });
    expect(probe.ping).toHaveBeenCalledTimes(2);
  });

  it('una falla no se cachea: la petición siguiente observa la recuperación', async () => {
    const ping = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }))
      .mockResolvedValue(undefined);
    const controller = new HealthController({ ping }, ENABLED);

    expect(await check(controller)).toEqual({ status: 503, body: ERROR_BODY });
    expect(await check(controller)).toEqual({ status: 200, body: OK_BODY });
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it('sonda colgada: requests concurrentes comparten el 503; una petición posterior vuelve a sondear', async () => {
    const ping = jest
      .fn<Promise<void>, []>()
      .mockImplementationOnce(() => new Promise<void>(() => undefined))
      .mockResolvedValue(undefined);
    const controller = new HealthController({ ping }, ENABLED);

    const first = check(controller);
    await jest.advanceTimersByTimeAsync(500);
    const second = check(controller);
    expect(ping).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(HEALTH_DB_TIMEOUT_MS);
    expect(await first).toEqual({ status: 503, body: ERROR_BODY });
    expect(await second).toEqual({ status: 503, body: ERROR_BODY });
    expect(ping).toHaveBeenCalledTimes(1);

    expect(await check(controller)).toEqual({ status: 200, body: OK_BODY });
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it('cada request responde dentro de los 2 s desde que llegó, aunque se una a una sonda en curso', async () => {
    const ping = jest.fn<Promise<void>, []>(() => new Promise<void>(() => undefined));
    const controller = new HealthController({ ping }, ENABLED);

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

  it('instrumentación apagada mantiene X-KPI-Instrumentation: disabled en cada sonda', async () => {
    const probe: DbHealthProbe = { ping: jest.fn(async () => undefined) };
    const controller = new HealthController(probe, DISABLED);

    expect(await checkWithHeaders(controller)).toEqual({ status: 200, body: OK_BODY, instrumentation: 'disabled' });
    await jest.advanceTimersByTimeAsync(100);
    expect(await checkWithHeaders(controller)).toEqual({ status: 200, body: OK_BODY, instrumentation: 'disabled' });
    expect(probe.ping).toHaveBeenCalledTimes(2);
  });

  it('instrumentación habilitada mantiene X-KPI-Instrumentation: enabled en cada sonda', async () => {
    const ping = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue(undefined);
    const controller = new HealthController({ ping }, ENABLED);

    expect(await checkWithHeaders(controller)).toEqual({ status: 503, body: ERROR_BODY, instrumentation: 'enabled' });
    expect(await checkWithHeaders(controller)).toEqual({ status: 200, body: OK_BODY, instrumentation: 'enabled' });
    expect(ping).toHaveBeenCalledTimes(2);
  });
});
