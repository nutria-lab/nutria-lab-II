// NUT-85 T4 — Regeneración con 2 llamadas a Gemini (C1, C2; design D9). Sin red ni DB.
// Cadena real: MealPlanRegenerationService.regenerate → firstDifferentProposal (máx. 2) →
// GeminiWeeklyProposalComposer → GeminiService.generateText (SDK mockeado) → instrumentación.
// Contrato fijado: las 2 llamadas reales son attempts 1 y 2 de 'gemini' con el mismo operation_id (el de la
// request); ni la regeneración ni el composer ni la validación agregan filas propias (sólo el punto de ejecución).
import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DayOfWeek, MealType } from '../../../generated/prisma/client';
import { GeminiService } from '../../plans/gemini/gemini.service';
import { MealPlanRegenerationService } from '../../plans/meal-plan-regeneration.service';
import { RecipeValidationService } from '../../plans/recipe-validation.service';
import { GeminiWeeklyProposalComposer } from '../../plans/weekly-proposal.composer';
import type { KpiConfig } from '../config/kpi-config';
import { KpiDependencyInstrumentation } from '../dependencies/dependency-instrumentation';
import type { DependencyCloseEvent, DependencyPendingEvent, KpiEventWriter } from '../events/kpi-event-writer';
import { runWithKpiRequestContext } from '../http/kpi-request-context';

const USER = 'user-1';
const PLAN = 'plan-1';
const WEEK = new Date('2026-09-14T00:00:00.000Z');
const ENABLED_DEV: KpiConfig = { enabled: true, environment: 'dev', disabledReason: null };
const DAYS = [
  DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY, DayOfWeek.SATURDAY, DayOfWeek.SUNDAY,
];
const profile: any = { goal: 'MAINTAIN', diet: 'ALL', excludedIngredients: [], cookTimePreference: 'QUICK' };

// La misma semana válida que devuelve Gemini en ambas llamadas.
const RAW_WEEK = JSON.stringify({
  days: DAYS.map((day, index) => ({
    day,
    date: `2026-09-${14 + index}`,
    meals: [{
      mealType: MealType.LUNCH,
      title: 'Ensalada de quinoa',
      nutritionalValues: { Protein: 20, Fiber: 8, Calories: 350, Description: 'Almuerzo' },
      recipe: {
        title: 'Ensalada de quinoa', description: 'Receta', prepMinutes: 10, cookMinutes: 15,
        ingredients: [{ name: 'Quinoa', quantity: 150, unit: 'g' }], instructions: ['Cocinar'],
      },
    }],
  })),
});

function fakeWriter() {
  const pending: DependencyPendingEvent[] = [];
  const closed: DependencyCloseEvent[] = [];
  const writer: KpiEventWriter = {
    insertHttpPending: jest.fn(async () => undefined),
    closeHttp: jest.fn(async () => undefined),
    insertDependencyPending: jest.fn(async (event: DependencyPendingEvent) => { pending.push(event); }),
    closeDependency: jest.fn(async (event: DependencyCloseEvent) => { closed.push(event); }),
    drain: jest.fn(async () => undefined),
    inFlightCount: () => 0,
  };
  const rows = () => pending.map(p => ({ ...p, outcome: 'pending', ...closed.find(c => c.id === p.id) }));
  return { writer, rows };
}

async function setup(generateContent: jest.Mock) {
  const { writer, rows } = fakeWriter();
  const instrumentation = new KpiDependencyInstrumentation(ENABLED_DEV, writer);
  const runSpy = jest.spyOn(instrumentation, 'run');
  const config = { get: (key: string) => (key === 'GEMINI_API_KEY' ? 'fake-gemini-key' : undefined) } as unknown as ConfigService;

  const gemini = new GeminiService(config, instrumentation);
  (gemini as any).genAI = { getGenerativeModel: jest.fn(() => ({ generateContent })) };

  const repository: any = {
    transitionGenerationRun: jest.fn().mockResolvedValue(1),
    getUserWithProfile: jest.fn().mockResolvedValue({ id: USER, nutritionProfile: profile }),
    createOrRecoverGenerationRun: jest.fn().mockResolvedValue({ run: { id: 'run-1', userId: USER, status: 'PENDING' }, wasCreated: true }),
  };
  const recipes = { findByNormalizedTitles: jest.fn().mockResolvedValue([]) };
  const validation = new RecipeValidationService(recipes as any, repository);
  const composer = new GeminiWeeklyProposalComposer(repository, gemini, validation);

  // El plan actual tiene exactamente las comidas que va a proponer Gemini (se calculan con un composer sin
  // instrumentación), así ninguna propuesta es "materialmente nueva" y la regeneración agota sus 2 intentos.
  const plainGemini = new GeminiService(config);
  (plainGemini as any).genAI = { getGenerativeModel: () => ({ generateContent: async () => ({ response: { text: () => RAW_WEEK } }) }) };
  const reference = await new GeminiWeeklyProposalComposer(repository, plainGemini, validation).composeWeeklyProposal({
    userId: USER, runId: 'run-ref', profile, weekStart: WEEK, weekStartStr: '2026-09-14',
  });
  repository.findPlanWithMeals = jest.fn().mockResolvedValue({
    id: PLAN, userId: USER, isCurrent: true, startDate: WEEK, days: reference.comparableDays,
  });

  const composeSpy = jest.spyOn(composer, 'composeWeeklyProposal');
  const images: any = { resolveImagesOrDegrade: jest.fn(async (days: unknown) => days), trackDownloads: jest.fn() };
  const regeneration = new MealPlanRegenerationService(repository, config, composer, images, validation);
  const regenerate = () => regeneration.regenerate(USER, PLAN, randomUUID(), { reason: 'USER_REQUESTED' } as any);
  return { regenerate, rows, runSpy, composeSpy, writer };
}

const sameWeek = () => jest.fn().mockResolvedValue({ response: { text: () => RAW_WEEK } });

beforeEach(() => {
  for (const method of ['log', 'error', 'warn', 'debug', 'verbose'] as const) {
    jest.spyOn(Logger.prototype, method).mockImplementation(() => undefined);
    jest.spyOn(Logger, method).mockImplementation(() => undefined);
  }
});

afterEach(() => jest.restoreAllMocks());

describe('Regeneración: cada llamada real a Gemini es un attempt (C2)', () => {
  it('una regeneración que genera 2 propuestas produce attempts 1 y 2 de gemini con el mismo operation_id', async () => {
    const generateContent = sameWeek();
    const { regenerate, rows, composeSpy } = await setup(generateContent);
    const operationId = randomUUID();

    await expect(
      runWithKpiRequestContext({ operationId, attempts: new Map() }, regenerate),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(composeSpy).toHaveBeenCalledTimes(2);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(rows().map(r => [r.operationId, r.dependency, r.attempt, r.outcome])).toEqual([
      [operationId, 'gemini', 1, 'success'],
      [operationId, 'gemini', 2, 'success'],
    ]);
  });

  it('el 2º intento fallido del proveedor queda como attempt 2 con outcome error (mismo operation_id)', async () => {
    const generateContent = jest.fn()
      .mockResolvedValueOnce({ response: { text: () => RAW_WEEK } })
      .mockRejectedValueOnce(new Error('503 from provider'));
    const { regenerate, rows } = await setup(generateContent);
    const operationId = randomUUID();

    await expect(
      runWithKpiRequestContext({ operationId, attempts: new Map() }, regenerate),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(rows().map(r => [r.operationId, r.attempt, r.outcome])).toEqual([
      [operationId, 1, 'success'],
      [operationId, 2, 'error'],
    ]);
  });
});

describe('Regeneración: sólo el punto de ejecución instrumenta (C1)', () => {
  it('el composer y los servicios de plan no llaman al wrapper: una llamada a run por cada generateContent', async () => {
    const generateContent = sameWeek();
    const { regenerate, runSpy, writer } = await setup(generateContent);

    await runWithKpiRequestContext({ operationId: randomUUID(), attempts: new Map() }, regenerate).catch(() => undefined);

    expect(runSpy).toHaveBeenCalledTimes(generateContent.mock.calls.length);
    expect(runSpy.mock.calls.every(([dependency]) => dependency === 'gemini')).toBe(true);
    expect(writer.insertDependencyPending).toHaveBeenCalledTimes(2);
    expect(writer.closeDependency).toHaveBeenCalledTimes(2);
    // Cada fila se abre justo antes de su llamada real al SDK (no antes de componer/validar).
    const inserts = (writer.insertDependencyPending as jest.Mock).mock.invocationCallOrder;
    const sdkCalls = generateContent.mock.invocationCallOrder;
    expect(inserts[0]).toBeLessThan(sdkCalls[0]);
    expect(sdkCalls[0]).toBeLessThan(inserts[1]);
    expect(inserts[1]).toBeLessThan(sdkCalls[1]);
  });
});
