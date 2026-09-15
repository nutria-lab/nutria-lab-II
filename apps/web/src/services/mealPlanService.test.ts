import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mealPlanService, MealPlanRequestError } from './mealPlanService';
import { apiClient } from './apiClient';

// NUT-10 (tercera iteración) — hallazgo ALTO de los reviewers: `mealPlanService` no pasa
// `skipAuthErrorHandling` en ninguna de sus dos llamadas, así que el interceptor global de
// `apiClient.ts` sigue disparando un redirect a `/login` en paralelo al estado `unauthorized`
// del hook (contradice la Decisión 5 del design.md). El patrón de referencia ya establecido
// en el proyecto es `registerService.ts`/`registerService.test.ts` (clase de error propia con
// `kind`, `{ skipAuthErrorHandling: true, timeout, signal }` como config). `MealPlanRequestError`
// no existe todavía: la crea el implementer en la próxima iteración.

// NUT-10: el contrato real de `GET /meal-plans/current` / `POST /meal-plans/generate`
// (confirmado contra Prisma + apps/api/src/modules/plans/tests/plans.integration.spec.ts,
// ver .plans/nut-10-integrar-plan-de-comidas/plan.md sección 3) es:
//
// MealPlan: { id, userId, startDate, endDate, createdAt, updatedAt, days: MealPlanDay[] }
// MealPlanDay: { id, mealPlanId, day (DayOfWeek), date, meals: PlannedMeal[] }
// PlannedMeal: { id, dayId, mealType, title, nutritionalValues, recipeId, recipe }
// Recipe: { id, title, description, prepMinutes, cookMinutes, ingredients, instructions }
//
// No usar `apps/web/src/modules/meal-plan/mealPlanFixture.ts`: tiene la forma VIEJA
// (`weekStart`, `Meal.servings`, sin `day`/`nutritionalValues`) y no representa el contrato real.

vi.mock('./apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));

function buildRealMealPlanResponse() {
  return {
    id: 'plan-1',
    userId: 'user-1',
    startDate: '2026-08-24T00:00:00.000Z',
    endDate: '2026-08-30T00:00:00.000Z',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    days: [
      {
        id: 'day-1',
        mealPlanId: 'plan-1',
        day: 'MONDAY',
        date: '2026-08-24T00:00:00.000Z',
        meals: [
          {
            id: 'meal-1',
            dayId: 'day-1',
            mealType: 'BREAKFAST',
            title: 'Avena con frutos rojos',
            nutritionalValues: { Protein: 12, Fiber: 5, Calories: 320, Description: 'Rica en fibra' },
            recipeId: 'recipe-1',
            recipe: {
              id: 'recipe-1',
              title: 'Avena con frutos rojos',
              description: 'Desayuno rápido',
              prepMinutes: 5,
              cookMinutes: 0,
              ingredients: [{ name: 'Avena', quantity: 1, unit: 'taza' }],
              instructions: ['Mezclar todo'],
            },
          },
          {
            // Comida sin receta asociada: el backend la representa como `recipe: null`
            // (campo presente, no ausente ni arreglo vacío) — Decisión 6 del design.md.
            id: 'meal-2',
            dayId: 'day-1',
            mealType: 'LUNCH',
            title: 'Comida sin receta asignada',
            nutritionalValues: { Protein: 20, Fiber: 3, Calories: 450, Description: 'Balanceada' },
            recipeId: null,
            recipe: null,
          },
        ],
      },
    ],
  };
}

describe('mealPlanService.getCurrentMealPlan', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
  });

  it('returns the real backend shape without transforming or dropping fields, including recipe: null', async () => {
    const backendResponse = buildRealMealPlanResponse();
    vi.mocked(apiClient.get).mockResolvedValue({ data: backendResponse });

    const result = await mealPlanService.getCurrentMealPlan('2026-08-24');

    expect(result).toEqual(backendResponse);
    expect(result?.startDate).toBe('2026-08-24T00:00:00.000Z');
    expect(result?.endDate).toBe('2026-08-30T00:00:00.000Z');
    expect(result?.days[0].day).toBe('MONDAY');
    expect(result?.days[0].meals[0].nutritionalValues).toEqual({
      Protein: 12,
      Fiber: 5,
      Calories: 320,
      Description: 'Rica en fibra',
    });
    expect(result?.days[0].meals[1].recipe).toBeNull();
    expect(result?.days[0].meals[1].recipeId).toBeNull();
    // El contrato viejo del frontend no debe "colarse": no hay `weekStart` en la
    // respuesta real, y `PlannedMeal` no tiene `servings`.
    expect(result).not.toHaveProperty('weekStart');
    expect(result?.days[0].meals[0]).not.toHaveProperty('servings');
  });

  it('normalizes a day with a missing meals array to an empty array (defensive against malformed responses)', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        id: 'plan-1',
        userId: 'user-1',
        startDate: '2026-08-24T00:00:00.000Z',
        endDate: '2026-08-30T00:00:00.000Z',
        createdAt: '2026-08-20T00:00:00.000Z',
        updatedAt: '2026-08-20T00:00:00.000Z',
        days: [{ id: 'day-1', mealPlanId: 'plan-1', day: 'MONDAY', date: '2026-08-24T00:00:00.000Z' }],
      },
    });

    const result = await mealPlanService.getCurrentMealPlan('2026-08-24');

    expect(result?.days[0].meals).toEqual([]);
  });

  it('returns null when the API responds 404 (no plan for the week)', async () => {
    const axiosError = Object.assign(new Error('Not Found'), {
      isAxiosError: true,
      response: { status: 404 },
    });
    vi.mocked(apiClient.get).mockRejectedValue(axiosError);

    const result = await mealPlanService.getCurrentMealPlan('2026-08-24');

    expect(result).toBeNull();
  });

  it('throws when the response does not look like a MealPlan', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: '<html>not json</html>' });

    await expect(mealPlanService.getCurrentMealPlan('2026-08-24')).rejects.toThrow();
  });

  it('rejects with a MealPlanRequestError whose kind is "unauthorized" on a 401, distinguishable from a generic error', async () => {
    const unauthorizedError = Object.assign(new Error('Unauthorized'), {
      isAxiosError: true,
      response: { status: 401 },
    });
    vi.mocked(apiClient.get).mockRejectedValueOnce(unauthorizedError);

    const unauthorizedRejection = await mealPlanService.getCurrentMealPlan('2026-08-24').catch((error) => error);
    expect(unauthorizedRejection).toBeInstanceOf(MealPlanRequestError);
    expect(unauthorizedRejection).toMatchObject({ kind: 'unauthorized' });

    const genericError = Object.assign(new Error('Internal Server Error'), {
      isAxiosError: true,
      response: { status: 500 },
    });
    vi.mocked(apiClient.get).mockRejectedValueOnce(genericError);

    const genericRejection = await mealPlanService.getCurrentMealPlan('2026-08-24').catch((error) => error);
    expect(
      genericRejection instanceof MealPlanRequestError && genericRejection.kind === 'unauthorized',
    ).toBe(false);
  });

  it('sends skipAuthErrorHandling, a timeout and an AbortSignal so this module handles its own 401s instead of the global apiClient interceptor', async () => {
    const backendResponse = buildRealMealPlanResponse();
    vi.mocked(apiClient.get).mockResolvedValue({ data: backendResponse });

    await mealPlanService.getCurrentMealPlan('2026-08-24');

    expect(apiClient.get).toHaveBeenCalledWith(
      '/meal-plans/current',
      expect.objectContaining({
        params: { weekStart: '2026-08-24' },
        skipAuthErrorHandling: true,
        timeout: expect.any(Number),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('forwards a caller-provided AbortSignal (optional last parameter) instead of only creating its own default', async () => {
    const backendResponse = buildRealMealPlanResponse();
    vi.mocked(apiClient.get).mockResolvedValue({ data: backendResponse });
    const controller = new AbortController();

    await mealPlanService.getCurrentMealPlan('2026-08-24', controller.signal);

    const call = vi.mocked(apiClient.get).mock.calls[0];
    const config = call?.[1] as { signal?: AbortSignal } | undefined;
    expect(config?.signal).toBe(controller.signal);
  });
});

describe('mealPlanService.generateMealPlan', () => {
  beforeEach(() => {
    vi.mocked(apiClient.post).mockReset();
  });

  it('calls POST /meal-plans/generate with weekStart in the body and returns the generated plan in the real shape', async () => {
    const backendResponse = buildRealMealPlanResponse();
    vi.mocked(apiClient.post).mockResolvedValue({ data: backendResponse });

    const result = await mealPlanService.generateMealPlan('2026-08-24');

    expect(vi.mocked(apiClient.post).mock.calls[0]?.[0]).toBe('/meal-plans/generate');
    // NUT-10 (cuarta iteración) — hallazgo BLOQUEANTE: el backend exige `weekStart` en el
    // body (`GenerateMealPlanDto.weekStart`, `@IsNotEmpty()`/`@IsDateString()`). Antes se
    // mandaba `undefined`, lo que hace fallar la generación con un error de validación.
    expect(vi.mocked(apiClient.post).mock.calls[0]?.[1]).toEqual({ weekStart: '2026-08-24' });
    expect(result).toEqual(backendResponse);
  });

  it('sends skipAuthErrorHandling, a timeout and an AbortSignal on generation requests too', async () => {
    const backendResponse = buildRealMealPlanResponse();
    vi.mocked(apiClient.post).mockResolvedValue({ data: backendResponse });

    await mealPlanService.generateMealPlan('2026-08-24');

    const call = vi.mocked(apiClient.post).mock.calls[0];
    const config = call?.[call.length - 1] as
      | { skipAuthErrorHandling?: boolean; timeout?: number; signal?: AbortSignal }
      | undefined;
    expect(config).toEqual(
      expect.objectContaining({
        skipAuthErrorHandling: true,
        timeout: expect.any(Number),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('forwards a caller-provided AbortSignal (optional last parameter) for plan generation too', async () => {
    const backendResponse = buildRealMealPlanResponse();
    vi.mocked(apiClient.post).mockResolvedValue({ data: backendResponse });
    const controller = new AbortController();

    await mealPlanService.generateMealPlan('2026-08-24', controller.signal);

    const call = vi.mocked(apiClient.post).mock.calls[0];
    const config = call?.[call.length - 1] as { signal?: AbortSignal } | undefined;
    expect(config?.signal).toBe(controller.signal);
  });

  it('rejects with a MealPlanRequestError whose kind is "unauthorized" on a 401 during generation', async () => {
    const unauthorizedError = Object.assign(new Error('Unauthorized'), {
      isAxiosError: true,
      response: { status: 401 },
    });
    vi.mocked(apiClient.post).mockRejectedValueOnce(unauthorizedError);

    const rejection = await mealPlanService.generateMealPlan('2026-08-24').catch((error) => error);
    expect(rejection).toBeInstanceOf(MealPlanRequestError);
    expect(rejection).toMatchObject({ kind: 'unauthorized' });
  });
});
