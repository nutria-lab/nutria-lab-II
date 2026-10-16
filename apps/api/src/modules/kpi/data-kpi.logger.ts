import { Injectable } from '@nestjs/common';
import type { CollectionContext, KpiLogger, KpiResult } from './kpi-contract';

type CountRow = {
  initial_plans_count: bigint | number;
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
  constructor(private readonly prisma: RawQueryClient, private readonly clock: { now(): Date } = { now: () => new Date() }) {}

  async collect(context: CollectionContext): Promise<readonly KpiResult[]> {
    const start = new Date(context.window_start);
    const end = new Date(context.window_end);
    const measuredAt = this.clock.now().toISOString();

    try {
      const rows = await this.prisma.$queryRaw<CountRow[]>`
        WITH bounds AS (
          SELECT ${start}::timestamptz AS start_at, ${end}::timestamptz AS end_at
        )
        SELECT
          (
            SELECT COUNT(DISTINCT p.id)
            FROM "meal_plans" p
            JOIN "generation_runs" g ON g.id = p."generationRunId"
            CROSS JOIN bounds b
            WHERE g.kind = 'MEAL_PLAN_INITIAL'
              AND g.status = 'SUCCEEDED'
              AND p."createdAt" >= b.start_at
              AND p."createdAt" < b.end_at
          ) AS initial_plans_count,
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
      if (!row) {
        throw new Error('KPI count query returned no row');
      }

      const initialPlans = countToSafeNumber(row.initial_plans_count, 'initial_plans_count');
      const manualRecipes = countToSafeNumber(row.manual_recipes_count, 'manual_recipes_count');
      return [
        observedResult('initial_plans_count', initialPlans, measuredAt),
        observedResult('manual_recipes_count', manualRecipes, measuredAt),
      ];
    } catch (error: unknown) {
      if (!isExpectedSourceFailure(error)) {
        throw error;
      }
      return [
        unavailableResult('initial_plans_count', measuredAt),
        unavailableResult('manual_recipes_count', measuredAt),
      ];
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

function observedResult(kpi_id: 'initial_plans_count' | 'manual_recipes_count', value: number, measured_at: string): KpiResult {
  return { kpi_id, value, quality: 'observed', reason: null, sample_count: value, measured_at };
}

function unavailableResult(kpi_id: 'initial_plans_count' | 'manual_recipes_count', measured_at: string): KpiResult {
  return { kpi_id, value: null, quality: 'unavailable', reason: 'SOURCE_UNAVAILABLE', sample_count: 0, measured_at };
}

function isExpectedSourceFailure(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && typeof error.code === 'string' && SOURCE_UNAVAILABLE_CODES.has(error.code);
}
