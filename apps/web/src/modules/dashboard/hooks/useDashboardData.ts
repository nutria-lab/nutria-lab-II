import axios from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';

import { mealPlanService, type MealPlan } from '../../../services/mealPlanService';
import {
  buildDashboardViewModel,
  createLoadingResources,
  hasPlanConflict,
  isUsableMealPlan,
  planIdOf,
  planIdsOf,
  type DashboardResources,
  type Resource,
} from '../coordinator';
import { getBuenosAiresToday, getCurrentWeekStart } from '../dates';
import { dashboardAdherenceService } from '../services/dashboardAdherenceService';
import { dashboardShoppingService } from '../services/dashboardShoppingService';
import type { DashboardViewModel } from '../types';
import { buildUnavailableViewModel } from '../utils';

// Mínimo entre recargas al volver a la pestaña: evita 3 pedidos por cada cambio de pestaña.
const VISIBILITY_REFRESH_MIN_MS = 30_000;

type Options = {
  userId: string | null;
  userName: string | null;
  // false mientras se muestra un fixture de desarrollo: no se pide nada.
  enabled: boolean;
};

type Outcome<T> = { status: 'success'; data: T } | { status: 'error' | 'unauthorized' };

type KeyedResources = { key: string; resources: DashboardResources };

// Sin acceso, ningún Reintentar del Inicio puede funcionar: el 401 y el 403 los resuelve la sesión global
// (apiClient → AuthProvider) y el 403 ACCESS_GATE_REQUIRED es del access gate. La tarjeta queda
// "No disponible todavía", sin botón.
function isAccessFailure(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === 401 || status === 403;
}

// Las cancelaciones propias se descartan antes (signal.aborted); cualquier otra falla, incluida una
// cancelación que no pedimos, es un error recuperable para no dejar la tarjeta cargando.
function toOutcome<T>(result: PromiseSettledResult<T>): Outcome<T> {
  if (result.status === 'fulfilled') return { status: 'success', data: result.value };
  return { status: isAccessFailure(result.reason) ? 'unauthorized' : 'error' };
}

// Reutiliza el servicio del planificador sin modificarlo y valida lo que el Inicio lee del plan.
async function getMealPlanForWeek(weekStart: string, signal: AbortSignal): Promise<MealPlan | null> {
  const plan = await mealPlanService.getCurrentMealPlan(weekStart, signal);
  if (plan !== null && !isUsableMealPlan(plan, weekStart)) throw new Error('INVALID_MEAL_PLAN_RESPONSE');
  return plan;
}

// Una falla conserva el dato anterior solo si pertenece a la misma versión del plan que la respuesta nueva.
function settleResource<T>(previous: Resource<T>, outcome: Outcome<T>, isSamePlan: (data: T) => boolean): Resource<T> {
  if (outcome.status === 'success') return { status: 'success', data: outcome.data };
  if (outcome.status === 'unauthorized') return { status: 'unauthorized' };
  return previous.data !== undefined && isSamePlan(previous.data)
    ? { status: 'error', data: previous.data }
    : { status: 'error' };
}

function dataOf<T>(outcome: Outcome<T>): T | undefined {
  return outcome.status === 'success' ? outcome.data : undefined;
}

function keyOf(userId: string, weekStart: string): string {
  return `${userId}|${weekStart}`;
}

function markLoading(resources: DashboardResources, today: string): DashboardResources {
  return {
    ...resources,
    today,
    conflict: false,
    mealPlan: { ...resources.mealPlan, status: 'loading' },
    adherence: { ...resources.adherence, status: 'loading' },
    shopping: { ...resources.shopping, status: 'loading' },
  };
}

// Único coordinador del Inicio: pide plan actual, adherencia (contrato A) y compras (contrato C) y entrega
// a cada tarjeta datos, estado y reintento. Qué muestra cada combinación está en coordinator.ts.
export function useDashboardData({ userId, userName, enabled }: Options): DashboardViewModel {
  const [weekStart, setWeekStart] = useState(() => getCurrentWeekStart());
  const [state, setState] = useState<KeyedResources | null>(null);
  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const lastLoadAtRef = useRef(0);

  const active = enabled && userId !== null;
  const key = userId === null ? null : keyOf(userId, weekStart);

  const load = useCallback(
    (attempt: 0 | 1 = 0) => {
      if (!active || key === null) return;
      // Pasada la medianoche del domingo se pide la semana nueva: el cambio de `weekStart` dispara la carga.
      const currentWeekStart = getCurrentWeekStart();
      if (currentWeekStart !== weekStart) {
        setWeekStart(currentWeekStart);
        return;
      }

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const requestId = ++requestIdRef.current;
      const today = getBuenosAiresToday();
      lastLoadAtRef.current = Date.now();

      setState((previous) => ({
        key,
        resources: markLoading(previous?.key === key ? previous.resources : createLoadingResources(weekStart, today), today),
      }));

      void Promise.allSettled([
        getMealPlanForWeek(weekStart, controller.signal),
        dashboardAdherenceService.getForWeek(weekStart, controller.signal),
        dashboardShoppingService.getForWeek(weekStart, controller.signal),
      ]).then(([planResult, adherenceResult, shoppingResult]) => {
        // Respuesta obsoleta: hubo otra carga, un cambio de usuario/semana o un desmontaje.
        if (requestId !== requestIdRef.current || controller.signal.aborted) return;

        const mealPlan = toOutcome(planResult);
        const adherence = toOutcome(adherenceResult);
        const shopping = toOutcome(shoppingResult);
        const fresh = { mealPlan: dataOf(mealPlan), adherence: dataOf(adherence), shopping: dataOf(shopping) };

        if (hasPlanConflict(fresh)) {
          // Regeneración concurrente: se reconsulta todo una sola vez antes de mostrar el conflicto.
          if (attempt === 0) {
            load(1);
            return;
          }
          setState({
            key,
            resources: {
              ...createLoadingResources(weekStart, today),
              mealPlan: { status: 'error' },
              adherence: { status: 'error' },
              shopping: { status: 'error' },
              conflict: true,
            },
          });
          return;
        }

        // Sin conflicto, todas las respuestas nuevas comparten el mismo planId (o no hubo ninguna).
        const [freshPlanId] = planIdsOf(fresh);
        const belongsToFreshPlan = (planId: string | null) => freshPlanId === undefined || planId === freshPlanId;

        setState((previous) => {
          const base = previous?.key === key ? previous.resources : createLoadingResources(weekStart, today);
          return {
            key,
            resources: {
              ...base,
              mealPlan: settleResource(base.mealPlan, mealPlan, (data) => belongsToFreshPlan(planIdOf.mealPlan(data))),
              adherence: settleResource(base.adherence, adherence, (data) => belongsToFreshPlan(planIdOf.adherence(data))),
              shopping: settleResource(base.shopping, shopping, (data) => belongsToFreshPlan(planIdOf.shopping(data))),
            },
          };
        });
      });
    },
    [active, key, weekStart],
  );

  const retry = useCallback(() => load(0), [load]);

  useEffect(() => {
    load(0);
    return () => {
      requestIdRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [load]);

  // Al volver a la pestaña (p. ej. después de registrar una comida o una compra) se refresca el resumen,
  // como mucho una vez cada 30 s desde la última carga. Un cambio de semana no espera.
  useEffect(() => {
    if (!active) return;
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const weekChanged = getCurrentWeekStart() !== weekStart;
      if (weekChanged || Date.now() - lastLoadAtRef.current >= VISIBILITY_REFRESH_MIN_MS) load(0);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [active, load, weekStart]);

  if (!active || key === null) return buildUnavailableViewModel(userName);
  // Los datos de otra (usuario, semana) nunca se muestran: hasta la primera respuesta se ve la carga.
  const resources = state?.key === key ? state.resources : createLoadingResources(weekStart, getBuenosAiresToday());
  return buildDashboardViewModel(resources, userName, retry);
}
