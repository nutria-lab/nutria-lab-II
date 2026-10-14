import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { GoogleGenerativeAIAbortError } from '@google/generative-ai';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AiProviderUnavailableError, GeminiService } from '../../plans/gemini/gemini.service';
import { GEMINI_REQUEST_TIMEOUT_MS } from '../../plans/gemini/gemini.constants';
import type { KpiConfig } from '../config/kpi-config';
import { KpiDependencyInstrumentation, NOOP_DEPENDENCY_INSTRUMENTATION } from '../dependencies/dependency-instrumentation';
import type { DependencyInstrumentation } from '../dependencies/dependency-instrumentation';
import type { DependencyCloseEvent, DependencyPendingEvent, KpiEventWriter } from '../events/kpi-event-writer';
import { runWithKpiRequestContext } from '../http/kpi-request-context';
import { KpiModule } from '../kpi.module';
import { DB_HEALTH_PROBE, DEPENDENCY_INSTRUMENTATION, KPI_CONFIG, KPI_EVENT_WRITER } from '../kpi.tokens';

const GEMINI_KEY = 'fake-gemini-key-SECRET';
const ENABLED_DEV: KpiConfig = { enabled: true, environment: 'dev', disabledReason: null };
const profile = { diet: 'VEGAN', goal: 'MAINTAIN', excludedIngredients: ['NUTS'], cookTimePreference: 'QUICK' } as any;
const startDate = new Date('2026-09-14T00:00:00Z');
const criteria = { topic: 'cena liviana', categories: ['VEGETARIAN'], properties: [], maxPrepMinutes: 30 };
const config = { get: () => GEMINI_KEY } as unknown as ConfigService;

function fakeWriter(mode: 'ok' | 'reject' = 'ok') {
  const pending: DependencyPendingEvent[] = [];
  const closed: DependencyCloseEvent[] = [];
  const act = <E>(list: E[]) => async (event: E) => {
    list.push(event);
    if (mode === 'reject') throw new Error('kpi db down');
  };
  const writer: KpiEventWriter = {
    insertHttpPending: jest.fn(async () => undefined),
    closeHttp: jest.fn(async () => undefined),
    insertDependencyPending: jest.fn(act(pending)),
    closeDependency: jest.fn(act(closed)),
    drain: jest.fn(async () => undefined),
    inFlightCount: () => 0,
  };
  const rows = () => pending.map(p => ({ ...p, outcome: 'pending', ...closed.find(c => c.id === p.id) }));
  return { writer, rows };
}

function withSdk(service: GeminiService, generateContent: jest.Mock) {
  (service as any).genAI = { getGenerativeModel: jest.fn(() => ({ generateContent })) };
  return service;
}

function instrumented(generateContent: jest.Mock, mode: 'ok' | 'reject' = 'ok') {
  const fake = fakeWriter(mode);
  const instrumentation = new KpiDependencyInstrumentation(ENABLED_DEV, fake.writer);
  const runSpy = jest.spyOn(instrumentation, 'run');
  const service = withSdk(new GeminiService(config, instrumentation), generateContent);
  return { ...fake, service, runSpy };
}

const okSdk = (text = '{"days":[]}') => jest.fn().mockResolvedValue({ response: { text: () => text } });
const inRequest = <T>(fn: () => Promise<T>, operationId = randomUUID()) =>
  runWithKpiRequestContext({ operationId, attempts: new Map() }, fn);

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

describe('GeminiService + instrumentación de dependencias (C1, C2)', () => {
  it("generateMealPlan y generateReplacementMeal llaman al wrapper con 'gemini' una vez por llamada", async () => {
    const generateContent = okSdk();
    const { service, runSpy, rows } = instrumented(generateContent);
    const operationId = randomUUID();

    await inRequest(async () => {
      await service.generateMealPlan(profile, startDate);
      await service.generateReplacementMeal(profile, 'DINNER' as any, criteria);
    }, operationId);

    expect(runSpy).toHaveBeenCalledTimes(2);
    expect(runSpy.mock.calls.map(([dependency]) => dependency)).toEqual(['gemini', 'gemini']);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(rows().map(r => [r.operationId, r.dependency, r.attempt, r.outcome])).toEqual([
      [operationId, 'gemini', 1, 'success'],
      [operationId, 'gemini', 2, 'success'],
    ]);
  });

  it('la fila pending se escribe en el punto de ejecución: antes de generateContent, no antes de armar el modelo', async () => {
    const generateContent = okSdk();
    const { service, writer } = instrumented(generateContent);

    await inRequest(() => service.generateMealPlan(profile, startDate));

    const getGenerativeModel = (service as any).genAI.getGenerativeModel as jest.Mock;
    const insert = (writer.insertDependencyPending as jest.Mock).mock.invocationCallOrder[0];
    expect(getGenerativeModel.mock.invocationCallOrder[0]).toBeLessThan(insert);
    expect(insert).toBeLessThan(generateContent.mock.invocationCallOrder[0]);
  });

  it('devuelve el mismo texto crudo que sin instrumentación', async () => {
    const raw = '```json\n{"days":[]}\n```';
    const { service } = instrumented(okSdk(raw));

    await expect(inRequest(() => service.generateMealPlan(profile, startDate))).resolves.toBe(raw);
  });

  it("timeout del AbortController ⇒ outcome 'timeout' y sigue lanzando AiProviderUnavailableError('AI_TIMEOUT')", async () => {
    jest.useFakeTimers();
    const generateContent = jest.fn((_request: unknown, options: any) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new GoogleGenerativeAIAbortError('Request aborted')));
    }));
    const { service, rows } = instrumented(generateContent);

    const pending = inRequest(() => service.generateMealPlan(profile, startDate));
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AiProviderUnavailableError', reason: 'AI_TIMEOUT' });
    await jest.advanceTimersByTimeAsync(GEMINI_REQUEST_TIMEOUT_MS);
    await assertion;
    await jest.advanceTimersByTimeAsync(1000);

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ dependency: 'gemini', attempt: 1, outcome: 'timeout' });
  });

  it("error del SDK ⇒ outcome 'error' y AiProviderUnavailableError('AI_PROVIDER_ERROR')", async () => {
    const { service, rows } = instrumented(jest.fn().mockRejectedValue(new Error('500 from provider')));

    await expect(inRequest(() => service.generateReplacementMeal(profile, 'DINNER' as any, criteria))).rejects.toMatchObject({
      name: 'AiProviderUnavailableError',
      reason: 'AI_PROVIDER_ERROR',
    });

    expect(rows()).toEqual([expect.objectContaining({ dependency: 'gemini', attempt: 1, outcome: 'error' })]);
  });

  it('un escritor que falla no cambia el resultado ni el error de negocio', async () => {
    const ok = instrumented(okSdk('{"ok":true}'), 'reject');
    await expect(inRequest(() => ok.service.generateMealPlan(profile, startDate))).resolves.toBe('{"ok":true}');

    const failing = instrumented(jest.fn().mockRejectedValue(new Error('x')), 'reject');
    const pending = inRequest(() => failing.service.generateMealPlan(profile, startDate));
    await expect(pending).rejects.toBeInstanceOf(AiProviderUnavailableError);
    await expect(pending).rejects.toMatchObject({ reason: 'AI_PROVIDER_ERROR' });
  });

  it('las filas no contienen la API key, el prompt ni el modelo', async () => {
    const { service, writer } = instrumented(okSdk());

    await inRequest(() => service.generateReplacementMeal(profile, 'DINNER' as any, criteria));

    const serialized = JSON.stringify([
      ...(writer.insertDependencyPending as jest.Mock).mock.calls,
      ...(writer.closeDependency as jest.Mock).mock.calls,
    ]);
    expect(serialized).not.toMatch(/SECRET|fake-gemini|cena liviana|NUTS|DINNER|gemini-3|https?:/);
  });

  it('construido sin instrumentación (new GeminiService(config)) funciona igual', async () => {
    const service = withSdk(new GeminiService(config), okSdk('{"plain":1}'));
    await expect(inRequest(() => service.generateMealPlan(profile, startDate))).resolves.toBe('{"plain":1}');
  });
});

describe('GeminiService — inyección opcional de DEPENDENCY_INSTRUMENTATION (D9)', () => {
  it('sin KpiModule, Nest construye GeminiService igual (dependencia @Optional, no-op)', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [GeminiService, { provide: ConfigService, useValue: config }],
    }).compile();

    const service = withSdk(moduleRef.get(GeminiService), okSdk('{"nest":1}'));
    await expect(service.generateMealPlan(profile, startDate)).resolves.toBe('{"nest":1}');
    await moduleRef.close();
  });

  it('con KpiModule (global), GeminiService recibe la instrumentación real y escribe la fila', async () => {
    const { writer, rows } = fakeWriter();
    const moduleRef = await Test.createTestingModule({
      imports: [KpiModule],
      providers: [GeminiService, { provide: ConfigService, useValue: config }],
    })
      .overrideProvider(KPI_CONFIG).useValue(ENABLED_DEV)
      .overrideProvider(KPI_EVENT_WRITER).useValue(writer)
      .overrideProvider(DB_HEALTH_PROBE).useValue({ ping: async () => undefined })
      .compile();

    const exported = moduleRef.get<DependencyInstrumentation>(DEPENDENCY_INSTRUMENTATION);
    expect(exported).toBeInstanceOf(KpiDependencyInstrumentation);
    expect(exported).not.toBe(NOOP_DEPENDENCY_INSTRUMENTATION);

    const service = withSdk(moduleRef.get(GeminiService), okSdk());
    await inRequest(() => service.generateMealPlan(profile, startDate));

    expect(rows()).toEqual([expect.objectContaining({ dependency: 'gemini', attempt: 1, outcome: 'success', environment: 'dev' })]);
    await moduleRef.close();
  });
});
