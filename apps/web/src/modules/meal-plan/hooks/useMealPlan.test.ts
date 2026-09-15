import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMealPlan } from './useMealPlan';
import { mealPlanService } from '../../../services/mealPlanService';

// NUT-10: fixture inline con la forma REAL del backend (ver
// .plans/nut-10-integrar-plan-de-comidas/plan.md sección 3). No usar
// `apps/web/src/modules/meal-plan/mealPlanFixture.ts` (contrato viejo, `weekStart`/`servings`).

vi.mock('../../../services/mealPlanService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/mealPlanService')>();
  return {
    ...actual,
    mealPlanService: { getCurrentMealPlan: vi.fn(), generateMealPlan: vi.fn() },
  };
});

function buildMeal(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function buildDay(day: string, date: string, meals: unknown[]) {
  return { id: `day-${date}`, mealPlanId: 'plan-1', day, date, meals };
}

// Los 7 días en el orden REAL que entrega el backend (`ORDER BY date ASC`), lunes a domingo.
// El hook no debe reordenarlos.
const REAL_MEAL_PLAN = {
  id: 'plan-1',
  userId: 'user-1',
  startDate: '2026-08-24T00:00:00.000Z',
  endDate: '2026-08-30T00:00:00.000Z',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
  days: [
    buildDay('MONDAY', '2026-08-24', [buildMeal()]),
    buildDay('TUESDAY', '2026-08-25', [
      buildMeal({
        id: 'meal-2',
        dayId: 'day-2026-08-25',
        mealType: 'LUNCH',
        title: 'Comida sin receta asignada',
        recipeId: null,
        recipe: null,
      }),
    ]),
    buildDay('WEDNESDAY', '2026-08-26', []),
    buildDay('THURSDAY', '2026-08-27', []),
    buildDay('FRIDAY', '2026-08-28', []),
    buildDay('SATURDAY', '2026-08-29', []),
    buildDay('SUNDAY', '2026-08-30', []),
  ],
};

describe('useMealPlan', () => {
  beforeEach(() => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockReset();
    vi.mocked(mealPlanService.generateMealPlan).mockReset();
  });

  it('loads the plan and exposes the 7 days in the exact order received from the backend', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(REAL_MEAL_PLAN as never);

    const { result } = renderHook(() => useMealPlan('2026-08-24'));

    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.mealPlan?.days).toHaveLength(7);
    expect(result.current.mealPlan?.days.map((day) => day.date)).toEqual(
      REAL_MEAL_PLAN.days.map((day) => day.date),
    );
    expect(result.current.mealPlan).toEqual(REAL_MEAL_PLAN);
  });

  it('sets status to empty when the service resolves no plan (404)', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(null);

    const { result } = renderHook(() => useMealPlan('2026-08-24'));

    await waitFor(() => expect(result.current.status).toBe('empty'));
    expect(result.current.mealPlan).toBeNull();
  });

  it('sets status to error with an actionable message on a generic server failure', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() => useMealPlan('2026-08-24'));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toBeTruthy();
  });

  it('recovers to success after calling retry from an error state', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockRejectedValueOnce(new Error('network error'));

    const { result } = renderHook(() => useMealPlan('2026-08-24'));
    await waitFor(() => expect(result.current.status).toBe('error'));

    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValueOnce(REAL_MEAL_PLAN as never);
    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.mealPlan).toEqual(REAL_MEAL_PLAN);
  });

  it('keeps the last valid plan when a retry fails', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValueOnce(REAL_MEAL_PLAN as never);

    const { result } = renderHook(() => useMealPlan('2026-08-24'));
    await waitFor(() => expect(result.current.status).toBe('success'));

    vi.mocked(mealPlanService.getCurrentMealPlan).mockRejectedValueOnce(new Error('network error'));
    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.mealPlan).toEqual(REAL_MEAL_PLAN);
  });

  // NUT-10 (sexta iteración) — Observación 1 del revisor externo (Request changes): se
  // elimina el bypass de auth local (`MealPlanRequestError`, `skipAuthErrorHandling`, el
  // estado/pantalla `unauthorized`). El `apiClient`/`AuthProvider` global ya maneja 401/403
  // de forma consistente para toda la app; duplicar ese flujo acá era el hallazgo. Este test
  // reemplaza al que exigía un estado `unauthorized` distinguible: ahora un 401 debe
  // comportarse exactamente como cualquier otro error genérico (`status: 'error'`), sin
  // ningún manejo especial — deja asentado que la simplificación es intencional.
  it('treats a 401 like any other generic error, with no special "unauthorized" handling', async () => {
    const unauthorizedError = Object.assign(new Error('Unauthorized'), {
      isAxiosError: true,
      response: { status: 401 },
    });
    vi.mocked(mealPlanService.getCurrentMealPlan).mockRejectedValue(unauthorizedError);

    const { result } = renderHook(() => useMealPlan('2026-08-24'));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toBeTruthy();
  });

  // NUT-10 (cuarta iteración) — hallazgo BLOQUEANTE: `generateMealPlan` ahora requiere
  // `weekStart` como primer argumento (el backend lo exige en el body). No alcanza con
  // verificar que se llama: hay que verificar que el hook le pasa el MISMO `weekStart`
  // con el que fue invocado, no `undefined` ni una fecha distinta.
  it('calls generateMealPlan with the same weekStart the hook was invoked with', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(null);
    vi.mocked(mealPlanService.generateMealPlan).mockResolvedValue(REAL_MEAL_PLAN as never);

    const { result } = renderHook(() => useMealPlan('2026-08-24'));
    await waitFor(() => expect(result.current.status).toBe('empty'));

    await act(async () => {
      await result.current.generate?.();
    });

    expect(mealPlanService.generateMealPlan).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mealPlanService.generateMealPlan).mock.calls[0]?.[0]).toBe('2026-08-24');
  });

  it('does not fail nor invent data when a meal has no associated recipe (recipe: null)', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(REAL_MEAL_PLAN as never);

    const { result } = renderHook(() => useMealPlan('2026-08-24'));

    await waitFor(() => expect(result.current.status).toBe('success'));
    const mealWithoutRecipe = result.current.mealPlan?.days[1].meals[0];
    expect(mealWithoutRecipe?.recipe).toBeNull();
    expect(mealWithoutRecipe?.recipeId).toBeNull();
  });

  // NUT-10 (tercera iteración) — hallazgo ALTO de los reviewers: `useMealPlan.ts` no cancela
  // ni ignora una petición anterior si se dispara una nueva antes de que resuelva. Con
  // <StrictMode> (main.tsx) el efecto de montaje ya corre dos veces, así que esta condición
  // de carrera ocurre en la práctica. Se orquesta el orden de resolución con promesas
  // controlables manualmente (resolveFirst/resolveSecond) para forzar que la petición MÁS
  // VIEJA resuelva DESPUÉS que la MÁS NUEVA, y verificar que la respuesta obsoleta no pisa
  // el estado ya actualizado por la respuesta más reciente. Se espera ROJO hoy.
  it('ignores a stale response when a newer overlapping request resolves before it', async () => {
    let resolveFirst!: (value: typeof REAL_MEAL_PLAN) => void;
    let resolveSecond!: (value: typeof REAL_MEAL_PLAN) => void;

    const firstPromise = new Promise<typeof REAL_MEAL_PLAN>((resolve) => {
      resolveFirst = resolve;
    });
    const secondPromise = new Promise<typeof REAL_MEAL_PLAN>((resolve) => {
      resolveSecond = resolve;
    });

    vi.mocked(mealPlanService.getCurrentMealPlan)
      .mockReturnValueOnce(firstPromise as never)
      .mockReturnValueOnce(secondPromise as never);

    const { result } = renderHook(() => useMealPlan('2026-08-24'));
    expect(result.current.status).toBe('loading');

    // Dispara una segunda petición (más nueva) antes de que la primera (de montaje) resuelva
    // — equivalente a un doble-render de StrictMode o a un usuario apretando "Reintentar"
    // dos veces seguidas.
    act(() => {
      result.current.retry();
    });

    const OLD_PLAN = { ...REAL_MEAL_PLAN, id: 'plan-old' };
    const NEW_PLAN = { ...REAL_MEAL_PLAN, id: 'plan-new' };

    // La petición MÁS NUEVA resuelve primero...
    act(() => {
      resolveSecond(NEW_PLAN as never);
    });
    await waitFor(() => expect(result.current.mealPlan?.id).toBe('plan-new'));

    // ...y recién después resuelve la MÁS VIEJA (ya obsoleta).
    act(() => {
      resolveFirst(OLD_PLAN as never);
    });
    // Le da lugar al `.then()` de la promesa obsoleta para que corra y al scheduler de React
    // para que aplique cualquier `setState` disparado fuera de `act()` (un `setTimeout(0)` no
    // alcanza: el scheduler de React 18 usa una macrotarea propia vía `MessageChannel` que
    // puede correr después de un timeout de 0ms, dando un falso verde). Si el hook no ignora
    // la respuesta obsoleta, esta espera es justamente lo que deja ver la sobreescritura
    // incorrecta.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // El estado final debe seguir reflejando la respuesta más reciente, no la obsoleta.
    expect(result.current.mealPlan?.id).toBe('plan-new');
    expect(result.current.status).toBe('success');
  });
});

describe('useMealPlan retry action targeting', () => {
  beforeEach(() => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockReset();
    vi.mocked(mealPlanService.generateMealPlan).mockReset();
  });

  // NUT-10 (tercera iteración) — hallazgo ALTO: `retry` siempre es `load` (useMealPlan.ts
  // línea 94), nunca `generate`. Si `generateMealPlan()` falla, apretar "Reintentar" hoy
  // vuelve a consultar el plan (que sigue sin existir) en vez de reintentar la generación.
  // Se espera ROJO hoy.
  it('remembers generate as the last attempted action and retries generation (not load) when generate fails', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(null);
    vi.mocked(mealPlanService.generateMealPlan).mockRejectedValueOnce(new Error('generation failed'));

    const { result } = renderHook(() => useMealPlan('2026-08-24'));
    await waitFor(() => expect(result.current.status).toBe('empty'));

    await act(async () => {
      await result.current.generate?.();
    });
    await waitFor(() => expect(result.current.status).toBe('error'));

    vi.mocked(mealPlanService.generateMealPlan).mockResolvedValueOnce(REAL_MEAL_PLAN as never);
    const getCallsBeforeRetry = vi.mocked(mealPlanService.getCurrentMealPlan).mock.calls.length;

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(mealPlanService.generateMealPlan).toHaveBeenCalledTimes(2);
    expect(vi.mocked(mealPlanService.getCurrentMealPlan).mock.calls.length).toBe(getCallsBeforeRetry);
  });

  // Caso de control / no-regresión: si lo que falla es la carga inicial (`load`), `retry`
  // debe seguir volviendo a llamar a `getCurrentMealPlan`, como ya pasa hoy.
  it('remembers load as the last attempted action and retries load (not generate) when the initial load fails', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockRejectedValueOnce(new Error('network error'));

    const { result } = renderHook(() => useMealPlan('2026-08-24'));
    await waitFor(() => expect(result.current.status).toBe('error'));

    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValueOnce(REAL_MEAL_PLAN as never);

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(mealPlanService.generateMealPlan).not.toHaveBeenCalled();
    expect(mealPlanService.getCurrentMealPlan).toHaveBeenCalledTimes(2);
  });
});

// NUT-10 (sexta iteración) — Observación 4 del revisor externo: abortar la request del
// navegador no cancela la generación del lado del backend. Si el usuario reintenta después
// de un timeout del cliente, puede dispararse un segundo `POST /meal-plans/generate` mientras
// el primero todavía corre en el servidor, y el backend (check-then-create antes de confiar
// en la constraint única `(userId, startDate)`) puede fallar con un conflicto. La corrección
// agrega (a) una guarda de "una sola generación a la vez" en `useMealPlan.ts`, y (b) una
// reconciliación contra `getCurrentMealPlan` antes de reportar error si `generate()` falla.
// Los 3 tests de este bloque se esperan en ROJO hoy: el hook actual no tiene ninguna de las
// dos protecciones.
describe('useMealPlan generate() overlap guard and failure reconciliation', () => {
  beforeEach(() => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockReset();
    vi.mocked(mealPlanService.generateMealPlan).mockReset();
  });

  it('does not trigger a second generateMealPlan request when generate() is called again while the first one is still in flight', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(null);
    let resolveGenerate!: (value: typeof REAL_MEAL_PLAN) => void;
    const generatePromise = new Promise<typeof REAL_MEAL_PLAN>((resolve) => {
      resolveGenerate = resolve;
    });
    vi.mocked(mealPlanService.generateMealPlan).mockReturnValue(generatePromise as never);

    const { result } = renderHook(() => useMealPlan('2026-08-24'));
    await waitFor(() => expect(result.current.status).toBe('empty'));

    // Dispara `generate()` dos veces seguidas sin esperar a que la primera resuelva —
    // equivalente a un usuario haciendo doble click en "Generar plan"/"Reintentar".
    act(() => {
      void result.current.generate();
      void result.current.generate();
    });

    expect(mealPlanService.generateMealPlan).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveGenerate(REAL_MEAL_PLAN as never);
      await generatePromise;
    });

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(mealPlanService.generateMealPlan).toHaveBeenCalledTimes(1);
  });

  it('reconciles with getCurrentMealPlan after a failed generate(): shows success if the plan actually exists server-side', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValueOnce(null); // carga inicial: sin plan
    vi.mocked(mealPlanService.generateMealPlan).mockRejectedValueOnce(new Error('timeout'));
    // Reconciliación posterior a la falla: el plan sí se creó del lado del servidor.
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValueOnce(REAL_MEAL_PLAN as never);

    const { result } = renderHook(() => useMealPlan('2026-08-24'));
    await waitFor(() => expect(result.current.status).toBe('empty'));

    await act(async () => {
      await result.current.generate();
    });

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.mealPlan).toEqual(REAL_MEAL_PLAN);
  });

  it('still reports error when generate() fails and reconciliation confirms no plan was actually created (does not hide a real failure)', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValueOnce(null); // carga inicial: sin plan
    vi.mocked(mealPlanService.generateMealPlan).mockRejectedValueOnce(new Error('timeout'));
    // Reconciliación posterior a la falla: sigue sin existir un plan del lado del servidor.
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValueOnce(null);

    const { result } = renderHook(() => useMealPlan('2026-08-24'));
    await waitFor(() => expect(result.current.status).toBe('empty'));

    await act(async () => {
      await result.current.generate();
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toBeTruthy();
  });
});

// NUT-10 (séptima iteración) — Hallazgo B (Medio, confiabilidad/resiliencia) de la segunda
// vuelta de reviewers: si `generate()` falla Y la reconciliación posterior
// (`getCurrentMealPlan`) TAMBIÉN falla (error de red — no se pudo confirmar nada, a
// diferencia de una reconciliación que resuelve `null` y así CONFIRMA que no hay plan),
// `lastActionRef.current` hoy queda en `'generate'`. Si el usuario aprieta "Reintentar"
// después, eso dispara OTRA vez `generateMealPlan`, exactamente el escenario de
// generaciones solapadas que la reconciliación de la sexta iteración quería evitar (la
// primera generación puede seguir corriendo del lado del servidor).
//
// La corrección esperada (a cargo del implementer): cuando la reconciliación MISMA falla
// (se rechaza su promesa, no cuando resuelve `null`), se debe marcar
// `lastActionRef.current = 'load'` antes de reportar el error, para que un `retry()`
// posterior dispare `getCurrentMealPlan` (reintentar la reconciliación / revisar el estado
// real) en vez de otro `generateMealPlan`.
//
// Distinción clave entre los dos mocks de "reconciliación" usados en este bloque:
//   - `mockResolvedValueOnce(null)`   -> la reconciliación CONFIRMA que no hay plan.
//   - `mockRejectedValueOnce(error)`  -> la reconciliación NO PUDO CONFIRMAR nada (ambiguo).
// Solo el segundo caso debe redirigir `retry()` hacia `load`.
describe('useMealPlan retry routing after an ambiguous (failed) reconciliation (NUT-10 hallazgo B, séptima iteración)', () => {
  beforeEach(() => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockReset();
    vi.mocked(mealPlanService.generateMealPlan).mockReset();
  });

  it('routes retry() to load (getCurrentMealPlan), not to another generateMealPlan, when generate() fails AND the reconciliation call itself rejects (ambiguous outcome)', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValueOnce(null); // carga inicial: sin plan
    vi.mocked(mealPlanService.generateMealPlan).mockRejectedValueOnce(new Error('timeout'));
    // La reconciliación posterior a la falla NO confirma nada: se rechaza (ej. la red sigue
    // mal), a diferencia de resolver `null`.
    vi.mocked(mealPlanService.getCurrentMealPlan).mockRejectedValueOnce(
      new Error('network error during reconciliation'),
    );

    const { result } = renderHook(() => useMealPlan('2026-08-24'));
    await waitFor(() => expect(result.current.status).toBe('empty'));

    await act(async () => {
      await result.current.generate();
    });
    await waitFor(() => expect(result.current.status).toBe('error'));

    const generateCallsBeforeRetry = vi.mocked(mealPlanService.generateMealPlan).mock.calls.length;
    const getCallsBeforeRetry = vi.mocked(mealPlanService.getCurrentMealPlan).mock.calls.length;

    // Se dejan ambos mocks listos para resolver con éxito: si `retry()` termina llamando a
    // `getCurrentMealPlan` (comportamiento correcto) o, incorrectamente, a
    // `generateMealPlan` de nuevo (bug de hoy), cualquiera de los dos lleva a `status:
    // 'success'`, así la aserción de qué mock se llamó queda limpia en vez de que el test
    // explote con un `TypeError` por quedarse sin respuestas encoladas en el mock que no se
    // esperaba usar.
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValueOnce(REAL_MEAL_PLAN as never);
    vi.mocked(mealPlanService.generateMealPlan).mockResolvedValueOnce(REAL_MEAL_PLAN as never);

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe('success'));

    // La llamada siguiente que dispara `retry()` es a `getCurrentMealPlan`, no a
    // `generateMealPlan` de nuevo.
    expect(vi.mocked(mealPlanService.generateMealPlan).mock.calls.length).toBe(
      generateCallsBeforeRetry,
    );
    expect(vi.mocked(mealPlanService.getCurrentMealPlan).mock.calls.length).toBe(
      getCallsBeforeRetry + 1,
    );
  });

  // Caso de control / no-regresión: si la reconciliación SÍ confirma que no hay plan
  // (resuelve `null`, no se rechaza), el comportamiento actual se mantiene: `retry()` sigue
  // apuntando a `generate` (la última acción intencional del usuario), no a `load`.
  it('control (non-regression): retry() still calls generateMealPlan again when the reconciliation call CONFIRMS there is no plan by resolving null (not rejecting)', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValueOnce(null); // carga inicial: sin plan
    vi.mocked(mealPlanService.generateMealPlan).mockRejectedValueOnce(new Error('timeout'));
    // La reconciliación posterior a la falla SÍ confirma (con éxito) que no hay plan.
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValueOnce(null);

    const { result } = renderHook(() => useMealPlan('2026-08-24'));
    await waitFor(() => expect(result.current.status).toBe('empty'));

    await act(async () => {
      await result.current.generate();
    });
    await waitFor(() => expect(result.current.status).toBe('error'));

    const getCallsBeforeRetry = vi.mocked(mealPlanService.getCurrentMealPlan).mock.calls.length;
    vi.mocked(mealPlanService.generateMealPlan).mockResolvedValueOnce(REAL_MEAL_PLAN as never);

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(mealPlanService.generateMealPlan).toHaveBeenCalledTimes(2);
    // Ninguna llamada adicional a `getCurrentMealPlan` debería haberse disparado por este
    // `retry()`, porque se redirige a `generate`, no a `load`.
    expect(vi.mocked(mealPlanService.getCurrentMealPlan).mock.calls.length).toBe(
      getCallsBeforeRetry,
    );
  });
});

// NUT-10 (séptima iteración) — Hallazgo C (Bajo, resiliencia) de la segunda vuelta de
// reviewers: la llamada de reconciliación (`getCurrentMealPlan` dentro del `catch` de
// `generate()`) no recibe ningún `AbortSignal`, a diferencia de las llamadas principales de
// `load`/`generate`, que sí usan `abortControllerRef`. Por lo tanto no se cancela si el
// componente se desmonta mientras la reconciliación está en curso.
describe('useMealPlan reconciliation call cancellation (NUT-10 hallazgo C, séptima iteración)', () => {
  beforeEach(() => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockReset();
    vi.mocked(mealPlanService.generateMealPlan).mockReset();
  });

  it('invokes the reconciliation getCurrentMealPlan call with an AbortSignal as the second argument, like the main load() call', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValueOnce(null); // carga inicial: sin plan
    vi.mocked(mealPlanService.generateMealPlan).mockRejectedValueOnce(new Error('timeout'));
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValueOnce(null); // reconciliación

    const { result } = renderHook(() => useMealPlan('2026-08-24'));
    await waitFor(() => expect(result.current.status).toBe('empty'));

    await act(async () => {
      await result.current.generate();
    });
    await waitFor(() => expect(result.current.status).toBe('error'));

    const reconciliationCall = vi.mocked(mealPlanService.getCurrentMealPlan).mock.calls[1];
    expect(reconciliationCall?.[0]).toBe('2026-08-24');
    expect(reconciliationCall?.[1]).toEqual(expect.any(AbortSignal));
  });
});
