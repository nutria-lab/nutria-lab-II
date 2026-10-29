// TODO: unificar con shoppingListService de NUT-90 cuando se mergee.
import { apiClient } from '../../../services/apiClient';
import type { ShoppingProgress } from '../types';

const SHOPPING_REQUEST_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

// Valida solo lo que usa el Inicio: el plan (para comparar versiones) y los contadores del resumen.
export function isShoppingProgress(value: unknown): value is ShoppingProgress {
  if (!isRecord(value) || typeof value.weekStart !== 'string' || !isRecord(value.summary)) return false;
  const { plan, summary } = value;
  if (
    plan !== null &&
    !(isRecord(plan) && typeof plan.id === 'string' && typeof plan.version === 'number' && typeof plan.updatedAt === 'string')
  ) {
    return false;
  }
  if (!isCount(summary.totalItems) || !isCount(summary.checkedItems)) return false;
  if (summary.checkedItems > summary.totalItems) return false;
  return plan !== null || summary.totalItems === 0;
}

export const dashboardShoppingService = {
  async getForWeek(weekStart: string, signal: AbortSignal): Promise<ShoppingProgress> {
    const { data } = await apiClient.get<unknown>('/shopping-list', {
      params: { weekStart },
      timeout: SHOPPING_REQUEST_TIMEOUT_MS,
      signal,
    });
    if (!isShoppingProgress(data) || data.weekStart !== weekStart) {
      throw new Error('INVALID_SHOPPING_RESPONSE');
    }
    const { totalItems, checkedItems } = data.summary;
    return { weekStart: data.weekStart, plan: data.plan, summary: { totalItems, checkedItems } };
  },
};
