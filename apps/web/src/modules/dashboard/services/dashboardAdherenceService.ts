import { apiClient } from '../../../services/apiClient';
import { PRODUCT_TIME_ZONE, getWeekEnd, isCalendarDate } from '../dates';
import type { AdherenceResponse } from '../types';
import { isKnownMealType } from '../utils';

const ADHERENCE_REQUEST_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPercent(value: unknown): boolean {
  return value === null || isFiniteNumber(value);
}

function isPlanRef(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) && typeof value.id === 'string' && isFiniteNumber(value.version) && typeof value.updatedAt === 'string')
  );
}

function hasCounters(value: Record<string, unknown>): boolean {
  return (
    isFiniteNumber(value.plannedMeals) &&
    isFiniteNumber(value.completedMeals) &&
    isFiniteNumber(value.skippedMeals) &&
    isFiniteNumber(value.notLoggedMeals) &&
    isPercent(value.adherencePercent)
  );
}

// `status` desconocido se conserva: la tarjeta de comidas lo muestra como "estado no disponible".
// `mealType` desconocido invalida la respuesta: no hay forma honesta de ubicar ni nombrar esa comida.
function isMeal(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.plannedMealId === 'string' &&
    typeof value.mealUpdatedAt === 'string' &&
    (typeof value.recipeId === 'string' || value.recipeId === null) &&
    typeof value.mealType === 'string' &&
    isKnownMealType(value.mealType) &&
    typeof value.title === 'string' &&
    typeof value.status === 'string' &&
    typeof value.canEdit === 'boolean'
  );
}

function isDay(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.date === 'string' &&
    hasCounters(value) &&
    Array.isArray(value.meals) &&
    value.meals.every(isMeal)
  );
}

// Forma del contrato A. Las reglas aritméticas del resumen las valida el widget (isConsistentAdherence).
export function isAdherenceResponse(value: unknown): value is AdherenceResponse {
  return (
    isRecord(value) &&
    typeof value.weekStart === 'string' &&
    isCalendarDate(value.weekStart) &&
    value.timezone === PRODUCT_TIME_ZONE &&
    typeof value.today === 'string' &&
    // "Hoy" fuera de la semana haría que la tarjeta afirme que hoy no hay comidas.
    value.today >= value.weekStart &&
    value.today <= getWeekEnd(value.weekStart) &&
    isPlanRef(value.plan) &&
    Array.isArray(value.days) &&
    value.days.every(isDay) &&
    isRecord(value.summary) &&
    hasCounters(value.summary)
  );
}

export const dashboardAdherenceService = {
  // Los errores HTTP y las cancelaciones se propagan sin cambios: el coordinador los clasifica.
  async getForWeek(weekStart: string, signal: AbortSignal): Promise<AdherenceResponse> {
    const { data } = await apiClient.get<unknown>('/adherence', {
      params: { weekStart },
      timeout: ADHERENCE_REQUEST_TIMEOUT_MS,
      signal,
    });
    if (!isAdherenceResponse(data) || data.weekStart !== weekStart) {
      throw new Error('INVALID_ADHERENCE_RESPONSE');
    }
    return data;
  },
};
