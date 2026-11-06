import axios from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../features/auth/AuthProvider';
import { adherenceService } from '../../../services/adherenceService';
import type { AdherenceResponse, MealCompletionStatus } from '../types';

type UseAdherenceOptions = {
  enabled?: boolean;
  refreshKey?: string;
  reloadPlan?: () => Promise<unknown>;
};

type HookContext = {
  active: boolean;
  weekStart: string | null;
  userId: string | null;
};

function getErrorDetails(error: unknown): { status: number; code?: string } {
  if (!axios.isAxiosError(error)) return { status: 0 };
  const data = error.response?.data;
  return {
    status: error.response?.status ?? 0,
    code: data && typeof data === 'object' && typeof (data as { code?: unknown }).code === 'string'
      ? (data as { code: string }).code
      : undefined,
  };
}

function isCancelled(error: unknown, controller: AbortController): boolean {
  return controller.signal.aborted || axios.isCancel(error);
}

export function useAdherence(weekStart: string | null, options: UseAdherenceOptions = {}) {
  const { status: authStatus, user } = useAuth();
  const userId = user?.id ?? null;
  const enabled = options.enabled ?? true;
  const active = enabled && weekStart !== null && authStatus === 'authenticated' && userId !== null;
  const [data, setData] = useState<AdherenceResponse | null>(null);
  const [loading, setLoading] = useState(active);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});

  const dataRef = useRef<AdherenceResponse | null>(null);
  const currentContext = useRef<HookContext>({ active, weekStart, userId });
  const reloadPlanRef = useRef(options.reloadPlan);
  const readGeneration = useRef(0);
  const contextGeneration = useRef(0);
  const activeRead = useRef<AbortController | null>(null);
  const writeControllers = useRef(new Set<AbortController>());
  const pendingIds = useRef(new Set<string>());

  currentContext.current = { active, weekStart, userId };
  reloadPlanRef.current = options.reloadPlan;

  const commitData = useCallback((next: AdherenceResponse | null) => {
    dataRef.current = next;
    setData(next);
  }, []);

  const load = useCallback(async (): Promise<AdherenceResponse | null> => {
    const context = currentContext.current;
    if (!context.active || !context.weekStart || !context.userId) {
      commitData(null);
      setLoading(false);
      setError(null);
      return null;
    }

    const requestId = ++readGeneration.current;
    const generation = contextGeneration.current;
    activeRead.current?.abort();
    const controller = new AbortController();
    activeRead.current = controller;
    setLoading(true);
    setError(null);

    const isCurrent = () =>
      readGeneration.current === requestId &&
      contextGeneration.current === generation &&
      currentContext.current.active &&
      currentContext.current.weekStart === context.weekStart &&
      currentContext.current.userId === context.userId;

    try {
      const response = await adherenceService.getForWeek(context.weekStart, controller.signal);
      if (!isCurrent()) return null;
      if (response.weekStart !== context.weekStart || !Array.isArray(response.days)) {
        throw new Error('Unexpected adherence response');
      }
      commitData(response);
      setItemErrors({});
      return response;
    } catch (requestError) {
      if (!isCurrent() || isCancelled(requestError, controller)) return null;
      setError('No pudimos cargar tu progreso.');
      return null;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [commitData]);

  useEffect(() => {
    contextGeneration.current += 1;
    const generation = contextGeneration.current;
    readGeneration.current += 1;
    activeRead.current?.abort();
    for (const controller of writeControllers.current) controller.abort();
    pendingIds.current.clear();
    setPending({});
    setItemErrors({});

    if (!active) {
      commitData(null);
      setLoading(false);
      setError(null);
    } else {
      commitData(null);
      setLoading(true);
      setError(null);
      void load();
    }

    return () => {
      if (contextGeneration.current === generation) contextGeneration.current += 1;
      readGeneration.current += 1;
      activeRead.current?.abort();
      for (const controller of writeControllers.current) controller.abort();
    };
  }, [active, weekStart, userId, options.refreshKey, load, commitData]);

  const setMealStatus = useCallback(async (plannedMealId: string, nextStatus: MealCompletionStatus) => {
    const context = currentContext.current;
    const snapshot = dataRef.current;
    if (!context.active || !context.weekStart || !context.userId || !snapshot) return;
    if (snapshot.weekStart !== context.weekStart || !snapshot.plan) return;
    if (pendingIds.current.has(plannedMealId)) return;

    const meal = snapshot.days.flatMap((day) => day.meals)
      .find((entry) => entry.plannedMealId === plannedMealId);
    if (!meal || !meal.canEdit || meal.status === nextStatus) return;

    const generation = contextGeneration.current;
    const controller = new AbortController();
    const isCurrent = () =>
      contextGeneration.current === generation &&
      currentContext.current.active &&
      currentContext.current.weekStart === context.weekStart &&
      currentContext.current.userId === context.userId;

    pendingIds.current.add(plannedMealId);
    writeControllers.current.add(controller);
    setPending((current) => ({ ...current, [plannedMealId]: true }));
    setItemErrors((current) => {
      const next = { ...current };
      delete next[plannedMealId];
      return next;
    });

    try {
      const result = await adherenceService.setMealStatus(
        plannedMealId,
        {
          planId: snapshot.plan.id,
          mealUpdatedAt: meal.mealUpdatedAt,
          status: nextStatus,
        },
        controller.signal,
      );
      if (!isCurrent()) return;
      if (result.plannedMealId !== plannedMealId || result.status !== nextStatus) {
        throw new Error('Unexpected adherence mutation response');
      }

      const current = dataRef.current;
      if (current?.plan?.id === snapshot.plan.id && current.weekStart === context.weekStart) {
        commitData({
          ...current,
          days: current.days.map((day) => ({
            ...day,
            meals: day.meals.map((entry) => entry.plannedMealId === plannedMealId
              ? { ...entry, status: result.status }
              : entry),
          })),
        });
      }
      void load();
    } catch (requestError) {
      if (!isCurrent() || isCancelled(requestError, controller)) return;
      const details = getErrorDetails(requestError);
      if (details.code === 'ADHERENCE_STALE' || details.status === 404) {
        await reloadPlanRef.current?.();
        await load();
        if (!isCurrent()) return;
        setItemErrors((current) => ({
          ...current,
          [plannedMealId]: details.code === 'ADHERENCE_STALE'
            ? 'El plan cambió. Revisá el estado actualizado y volvé a elegir.'
            : 'La comida ya no está en este plan. Revisá el plan actualizado.',
        }));
      } else if (details.code === 'MEAL_IN_FUTURE') {
        await load();
        if (!isCurrent()) return;
        setItemErrors((current) => ({
          ...current,
          [plannedMealId]: 'Las comidas futuras no se pueden registrar.',
        }));
      } else {
        setItemErrors((current) => ({
          ...current,
          [plannedMealId]: 'No se pudo guardar. El estado anterior sigue activo; podés volver a intentarlo.',
        }));
      }
    } finally {
      writeControllers.current.delete(controller);
      pendingIds.current.delete(plannedMealId);
      if (isCurrent()) {
        setPending((current) => {
          const next = { ...current };
          delete next[plannedMealId];
          return next;
        });
      }
    }
  }, [commitData, load]);

  return {
    data,
    loading: loading || (active && data !== null && data.weekStart !== weekStart),
    error,
    pending,
    itemErrors,
    reload: load,
    setMealStatus,
  };
}
