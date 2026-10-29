import type { AdherenceResponse } from '../types';
import type { AdherenceWidgetProps } from './types';

export type ExpectedAdherence = {
  expectedWeekStart?: string;
  expectedPlanId?: string | null;
};

// Contrato de NUT-103 más los valores que la página espera; ver la precedencia en el design de NUT-94.
export type AdherenceWidgetViewProps = AdherenceWidgetProps & ExpectedAdherence;

const PERCENT_FORMAT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

// Solo formatea el valor del backend (ya redondeado a 1 decimal); nunca lo recalcula.
export function formatAdherencePercent(value: number): string {
  return `${PERCENT_FORMAT.format(value)} %`;
}

// "Sin registros": hay comidas planificadas pero ninguna marcada como completada u omitida.
export function hasNoRecords(summary: AdherenceResponse['summary']): boolean {
  return summary.plannedMeals > 0 && summary.completedMeals === 0 && summary.skippedMeals === 0;
}

// Una respuesta de otra semana o de otra versión del plan no se mezcla con lo que espera la página.
// Sin valores esperados no hay contra qué comparar, así que la respuesta se acepta.
export function isStaleAdherence(data: AdherenceResponse, expected: ExpectedAdherence): boolean {
  if (expected.expectedWeekStart !== undefined && data.weekStart !== expected.expectedWeekStart) return true;
  if (expected.expectedPlanId !== undefined && (data.plan?.id ?? null) !== expected.expectedPlanId) return true;
  return false;
}

function isCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

// Reglas del contrato A que el widget necesita para no afirmar algo falso. No recalcula el porcentaje:
// solo exige que exista cuando hay comidas, que sea null cuando no hay, y que esté en 0–100.
export function isConsistentAdherence(data: AdherenceResponse): boolean {
  const { plannedMeals, completedMeals, skippedMeals, notLoggedMeals, adherencePercent } = data.summary;
  if (![plannedMeals, completedMeals, skippedMeals, notLoggedMeals].every(isCount)) return false;
  if (completedMeals + skippedMeals + notLoggedMeals !== plannedMeals) return false;
  if (data.plan === null && plannedMeals !== 0) return false;
  if (plannedMeals === 0) return adherencePercent === null;
  return adherencePercent !== null && Number.isFinite(adherencePercent) && adherencePercent >= 0 && adherencePercent <= 100;
}
