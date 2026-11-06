import { Injectable } from '@nestjs/common';
import type { CollectionContext, KpiLogger, KpiResult } from './kpi-contract';

type CountRow = {
  adherence_percent: number | null;
  adherence_users: bigint | number;
  manual_recipes_count: bigint | number;
};

/** The only Prisma capability needed by this isolated read-only collector. */
interface RawQueryClient {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

const SOURCE_UNAVAILABLE_CODES = new Set([
  'P1001', 'P1002', 'P1008', 'P1017', 'P2021', 'P2022', 'P2024',
]);

@Injectable()
export class DataKpiLogger implements KpiLogger {
  constructor(private readonly prisma: RawQueryClient, private readonly clock: () => Date = () => new Date()) {}

  async collect(context: CollectionContext): Promise<readonly KpiResult[]> {
    const start = new Date(context.window_start);
    const end = new Date(context.window_end);
    const reportDate = new Date(`${context.date}T00:00:00.000Z`);
    const weekStart = new Date(reportDate);
    weekStart.setUTCDate(reportDate.getUTCDate() - ((reportDate.getUTCDay() + 6) % 7));

    try {
      const rows = await this.prisma.$queryRaw<CountRow[]>`
        WITH bounds AS (
          SELECT ${start}::timestamptz AS start_at, ${end}::timestamptz AS end_at
        )
        SELECT
          (
            WITH user_adherence AS (
              SELECT p."userId",
                COUNT(*) FILTER (
                  WHERE c.status = 'COMPLETED'
                    AND d.date <= ${reportDate}
                    AND c."mealUpdatedAtSnapshot" = pm."updatedAt"
                    AND c."recipeIdSnapshot" IS NOT DISTINCT FROM pm."recipeId"
                )::double precision / COUNT(*)::double precision * 100 AS percent
              FROM "meal_plans" p
              JOIN "meal_plan_days" d ON d."mealPlanId" = p.id
              JOIN "planned_meals" pm ON pm."dayId" = d.id
              LEFT JOIN "meal_completions" c ON c."plannedMealId" = pm.id AND c."userId" = p."userId"
              WHERE p."isCurrent" = TRUE AND p."startDate" = ${weekStart}
              GROUP BY p."userId"
            )
            SELECT AVG(percent)::double precision FROM user_adherence
          ) AS adherence_percent,
          (
            SELECT COUNT(*) FROM (
              SELECT p."userId"
              FROM "meal_plans" p
              JOIN "meal_plan_days" d ON d."mealPlanId" = p.id
              JOIN "planned_meals" pm ON pm."dayId" = d.id
              WHERE p."isCurrent" = TRUE AND p."startDate" = ${weekStart}
              GROUP BY p."userId"
            ) users_with_meals
          ) AS adherence_users,
          (
            SELECT COUNT(*)
            FROM "recipes" r
            CROSS JOIN bounds b
            WHERE r.origin = 'MANUAL'
              AND r."createdAt" >= b.start_at
              AND r."createdAt" < b.end_at
          ) AS manual_recipes_count
      `;
      const row = rows[0];
      const adherenceUsers = row ? countToSafeNumber(row.adherence_users, 'adherence_users') : 0;
      const manualRecipes = row ? countToSafeNumber(row.manual_recipes_count, 'manual_recipes_count') : 0;
      const measuredAt = this.clock().toISOString();
      return [
        adherenceUsers === 0
          ? unavailableResult('adherence_rate', measuredAt, 'NO_PLANNED_MEALS')
          : observedResult('adherence_rate', row!.adherence_percent ?? 0, measuredAt, adherenceUsers),
        observedResult('manual_recipes_count', manualRecipes, measuredAt),
      ];
    } catch (error: unknown) {
      if (!isExpectedSourceFailure(error)) {
        throw error;
      }
      const measuredAt = this.clock().toISOString();
      return [unavailableResult('adherence_rate', measuredAt), unavailableResult('manual_recipes_count', measuredAt)];
    }
  }
}

function countToSafeNumber(value: bigint | number, field: string): number {
  const numeric = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(numeric)) {
    throw new Error(`KPI ${field} count exceeds the safe integer range`);
  }
  return numeric;
}

function observedResult(kpi_id: 'adherence_rate' | 'manual_recipes_count', value: number, measured_at: string, sample_count = value): KpiResult {
  return { kpi_id, value, quality: 'observed', reason: null, sample_count, measured_at };
}

function unavailableResult(kpi_id: 'adherence_rate' | 'manual_recipes_count', measured_at: string, reason = 'SOURCE_UNAVAILABLE'): KpiResult {
  return { kpi_id, value: null, quality: 'unavailable', reason, sample_count: 0, measured_at };
}

function isExpectedSourceFailure(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && typeof error.code === 'string' && SOURCE_UNAVAILABLE_CODES.has(error.code);
}
