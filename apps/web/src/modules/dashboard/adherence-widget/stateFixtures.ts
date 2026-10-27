// Fixtures de NUT-94 para las combinaciones que no cubre `createAdherenceWidgetProps` (NUT-103).
// Se construyen sobre los fixtures de NUT-103 sin modificarlos.
import type { AdherenceResponse } from '../types';
import { adherencePartialProgressFixture } from './fixtures';
import type { AdherenceWidgetViewProps } from './utils';

// Estados base; las combinaciones con `loading` y `error` se arman pisando esas props.
export type AdherenceWidgetExtraState = 'noRecords' | 'staleWeek' | 'stalePlan' | 'inconsistent';

// Valores esperados distintos de los del fixture parcial: simulan una semana o versión de plan nueva.
export const EXPECTED_OTHER_WEEK = '2026-10-26';
export const EXPECTED_OTHER_PLAN_ID = 'fixture-plan-regenerated';

// Misma semana que el fixture parcial, sin ninguna comida completada ni omitida.
export const adherenceNoRecordsFixture: AdherenceResponse = {
  ...structuredClone(adherencePartialProgressFixture),
  plan: { id: 'fixture-plan-no-records', version: 1, updatedAt: '2026-10-18T12:00:00.000Z' },
  days: adherencePartialProgressFixture.days.map((day) => ({
    ...day,
    completedMeals: 0,
    skippedMeals: 0,
    notLoggedMeals: day.plannedMeals,
    adherencePercent: 0,
    meals: day.meals.map((meal) => ({ ...meal, status: 'NOT_LOGGED' as const })),
  })),
  summary: { plannedMeals: 28, completedMeals: 0, skippedMeals: 0, notLoggedMeals: 28, adherencePercent: 0 },
};

// Rompe una sola regla del contrato: los contadores no suman las comidas planificadas.
export const adherenceInconsistentFixture: AdherenceResponse = {
  ...structuredClone(adherencePartialProgressFixture),
  summary: { ...adherencePartialProgressFixture.summary, notLoggedMeals: 17 },
};

function partial(): AdherenceResponse {
  return structuredClone(adherencePartialProgressFixture);
}

export function createAdherenceWidgetStateProps(
  state: AdherenceWidgetExtraState,
  onRetry: () => void = () => {},
): AdherenceWidgetViewProps {
  switch (state) {
    case 'noRecords':
      return { data: structuredClone(adherenceNoRecordsFixture), loading: false, error: null, onRetry };
    case 'staleWeek':
      return { data: partial(), loading: false, error: null, onRetry, expectedWeekStart: EXPECTED_OTHER_WEEK };
    case 'stalePlan':
      return { data: partial(), loading: false, error: null, onRetry, expectedPlanId: EXPECTED_OTHER_PLAN_ID };
    case 'inconsistent':
      return { data: structuredClone(adherenceInconsistentFixture), loading: false, error: null, onRetry };
  }
}
