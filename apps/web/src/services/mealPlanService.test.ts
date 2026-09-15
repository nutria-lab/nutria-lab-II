import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mealPlanService } from './mealPlanService';
import { apiClient } from './apiClient';

// NUT-10 (sexta iteración) — Observación 1 del revisor externo (Request changes): se
// elimina el bypass de auth local. `MealPlanRequestError`, `skipAuthErrorHandling: true` y el
// manejo especial de 401 salen de `mealPlanService.ts`: el `apiClient`/`AuthProvider` global
// ya maneja 401/403 de forma consistente para toda la app (ver `apiClient.ts`), y duplicarlo
// acá creaba un segundo flujo de auth. Se borran los tests que cubrían esa clase/kind
// 'unauthorized' (estaban antes en este archivo); un 401 ahora se comporta como cualquier
// otro error genérico, sin manejo especial de este módulo.

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

  it('returns the real backend shape without transforming or dropping fields, including recipe: null (except day.date, which gets normalized — see the dedicated normalization test below)', async () => {
    const backendResponse = buildRealMealPlanResponse();
    vi.mocked(apiClient.get).mockResolvedValue({ data: backendResponse });

    const result = await mealPlanService.getCurrentMealPlan('2026-08-24');

    // NUT-10 (sexta iteración) — Observación 2: `day.date` es el único campo que
    // `mealPlanService` transforma (de ISO completo a 'YYYY-MM-DD'); todo lo demás debe
    // llegar intacto. Se compara contra `backendResponse` con esa única normalización
    // aplicada, en vez de esperar una igualdad total con la respuesta cruda del backend.
    expect(result).toEqual({
      ...backendResponse,
      days: backendResponse.days.map((day) => ({ ...day, date: day.date.slice(0, 10) })),
    });
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

  // NUT-10 (sexta iteración) — Observación 1: se borra el test que exigía un
  // `MealPlanRequestError` con `kind: 'unauthorized'` en un 401 (esa clase y ese manejo
  // especial se eliminan de `mealPlanService.ts`). Un 401 ahora debe propagarse como
  // cualquier otro error del backend, sin distinción — lo confirma el test de
  // `useMealPlan.test.ts` a nivel de hook.
  it('propagates a 401 like any other rejected request, without a special error type', async () => {
    const unauthorizedError = Object.assign(new Error('Unauthorized'), {
      isAxiosError: true,
      response: { status: 401 },
    });
    vi.mocked(apiClient.get).mockRejectedValueOnce(unauthorizedError);

    await expect(mealPlanService.getCurrentMealPlan('2026-08-24')).rejects.toBe(unauthorizedError);
  });

  it('sends a timeout and an AbortSignal, without any auth-bypass flag (the global apiClient interceptor handles 401/403 for this call too)', async () => {
    const backendResponse = buildRealMealPlanResponse();
    vi.mocked(apiClient.get).mockResolvedValue({ data: backendResponse });

    await mealPlanService.getCurrentMealPlan('2026-08-24');

    expect(apiClient.get).toHaveBeenCalledWith(
      '/meal-plans/current',
      expect.objectContaining({
        params: { weekStart: '2026-08-24' },
        timeout: expect.any(Number),
        signal: expect.any(AbortSignal),
      }),
    );
    const config = vi.mocked(apiClient.get).mock.calls[0]?.[1] as { skipAuthErrorHandling?: boolean } | undefined;
    expect(config?.skipAuthErrorHandling).toBeUndefined();
  });

  // NUT-10 (sexta iteración) — Observación 3: se deja asentado con un valor explícito que
  // `getCurrentMealPlan` sigue usando su timeout corto de 10s (consultar el plan actual es
  // una operación rápida); `generateMealPlan` usa uno distinto y mayor (ver más abajo), ya
  // que dispara una llamada a Gemini del lado del backend que puede tardar hasta 15s.
  it('uses a 10s timeout for getCurrentMealPlan', async () => {
    const backendResponse = buildRealMealPlanResponse();
    vi.mocked(apiClient.get).mockResolvedValue({ data: backendResponse });

    await mealPlanService.getCurrentMealPlan('2026-08-24');

    const config = vi.mocked(apiClient.get).mock.calls[0]?.[1] as { timeout?: number } | undefined;
    expect(config?.timeout).toBe(10_000);
  });

  // NUT-10 (sexta iteración) — Observación 2: el backend devuelve `MealPlanDay.date` como
  // datetime ISO completo (`'2026-08-24T00:00:00.000Z'`); si no se normaliza acá, ni
  // `MealPlanPage` (comparación contra `formatLocalDateKey(new Date())` / `?day=`) ni
  // `WeekSelector` (escritura del query param) matchean nunca. Se espera ROJO hoy.
  it('normalizes MealPlanDay.date from a full ISO datetime to a plain YYYY-MM-DD string', async () => {
    const backendResponse = buildRealMealPlanResponse();
    vi.mocked(apiClient.get).mockResolvedValue({ data: backendResponse });
    expect(backendResponse.days[0].date).toBe('2026-08-24T00:00:00.000Z');

    const result = await mealPlanService.getCurrentMealPlan('2026-08-24');

    expect(result?.days[0].date).toBe('2026-08-24');
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
    // NUT-10 (sexta iteración) — Observación 2: mismo criterio que `getCurrentMealPlan`,
    // `day.date` es el único campo normalizado (ISO completo -> 'YYYY-MM-DD').
    expect(result).toEqual({
      ...backendResponse,
      days: backendResponse.days.map((day) => ({ ...day, date: day.date.slice(0, 10) })),
    });
  });

  it('sends a timeout and an AbortSignal, without any auth-bypass flag, on generation requests too', async () => {
    const backendResponse = buildRealMealPlanResponse();
    vi.mocked(apiClient.post).mockResolvedValue({ data: backendResponse });

    await mealPlanService.generateMealPlan('2026-08-24');

    const call = vi.mocked(apiClient.post).mock.calls[0];
    const config = call?.[call.length - 1] as
      | { skipAuthErrorHandling?: boolean; timeout?: number; signal?: AbortSignal }
      | undefined;
    expect(config).toEqual(
      expect.objectContaining({
        timeout: expect.any(Number),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(config?.skipAuthErrorHandling).toBeUndefined();
  });

  // NUT-10 (sexta iteración) — Observación 3, hallazgo del revisor externo: el backend puede
  // tardar hasta 15s en generar el plan (llamada a Gemini) y sigue corriendo del lado del
  // servidor aunque el cliente ya haya abortado a los 10s. `generateMealPlan` necesita su
  // propio timeout, mayor a 15s, distinto de la constante de 10s que usa `getCurrentMealPlan`.
  // Se espera ROJO hoy (ambas llamadas comparten hoy `MEAL_PLAN_REQUEST_TIMEOUT_MS = 10_000`).
  it('uses a timeout greater than 15s for generateMealPlan (the backend generation call can take up to 15s)', async () => {
    const backendResponse = buildRealMealPlanResponse();
    vi.mocked(apiClient.post).mockResolvedValue({ data: backendResponse });

    await mealPlanService.generateMealPlan('2026-08-24');

    const call = vi.mocked(apiClient.post).mock.calls[0];
    const config = call?.[call.length - 1] as { timeout?: number } | undefined;
    expect(config?.timeout).toBeGreaterThan(15_000);
  });

  // NUT-10 (sexta iteración) — Observación 2, réplica del test de `getCurrentMealPlan` para
  // `generateMealPlan`: la generación también debe normalizar `day.date`.
  it('normalizes MealPlanDay.date from a full ISO datetime to a plain YYYY-MM-DD string on generation too', async () => {
    const backendResponse = buildRealMealPlanResponse();
    vi.mocked(apiClient.post).mockResolvedValue({ data: backendResponse });

    const result = await mealPlanService.generateMealPlan('2026-08-24');

    expect(result?.days[0].date).toBe('2026-08-24');
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

  // NUT-10 (sexta iteración) — Observación 1: mismo criterio que en `getCurrentMealPlan`, se
  // borra el test que exigía `MealPlanRequestError`/`kind: 'unauthorized'` en generación.
  it('propagates a 401 like any other rejected request during generation, without a special error type', async () => {
    const unauthorizedError = Object.assign(new Error('Unauthorized'), {
      isAxiosError: true,
      response: { status: 401 },
    });
    vi.mocked(apiClient.post).mockRejectedValueOnce(unauthorizedError);

    await expect(mealPlanService.generateMealPlan('2026-08-24')).rejects.toBe(unauthorizedError);
  });
});
