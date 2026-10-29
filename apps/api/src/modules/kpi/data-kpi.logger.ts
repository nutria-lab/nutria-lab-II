import { Injectable } from '@nestjs/common';
import type { MealCompletionStatus } from '@/generated/prisma/client';
import { dateInBuenosAires } from '@/modules/adherence/adherence.repository';
import { effectiveMealStatus } from '@/modules/adherence/effective-meal-status';
import type { AdherenceEvidence, CollectionContext, KpiLogger, KpiResult } from './kpi-contract';

type CountRow = {
  initial_plans_count: bigint | number;
  manual_recipes_count: bigint | number;
};

type AdherenceMealRow = {
  recipe_id: string | null;
  meal_updated_at: Date;
  completion_status: MealCompletionStatus | null;
  completion_recipe_id_snapshot: string | null;
  completion_meal_updated_at_snapshot: Date | null;
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
    // Freeze the collection instant before either query. The report window is only
    // the identity for the existing two count KPIs; adherence observes current DB state.
    const measuredInstant = this.clock();
    const measuredAt = measuredInstant.toISOString();
    const collectionDate = dateInBuenosAires(measuredInstant);
    const [initialPlans, manualRecipes] = await this.collectWindowCounts(context, measuredAt);
    const adherence = await this.collectAdherence(context, collectionDate, measuredAt);
    return [initialPlans, manualRecipes, adherence];
  }

  private async collectWindowCounts(context: CollectionContext, measuredAt: string): Promise<[KpiResult, KpiResult]> {
    const start = new Date(context.window_start);
    const end = new Date(context.window_end);
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
      const initialPlans = row ? countToSafeNumber(row.initial_plans_count, 'initial_plans_count') : 0;
      const manualRecipes = row ? countToSafeNumber(row.manual_recipes_count, 'manual_recipes_count') : 0;
      return [
        observedResult('initial_plans_count', initialPlans, measuredAt),
        observedResult('manual_recipes_count', manualRecipes, measuredAt),
      ];
    } catch (error: unknown) {
      if (!isExpectedSourceFailure(error)) throw error;
      return [unavailableResult('initial_plans_count', measuredAt), unavailableResult('manual_recipes_count', measuredAt)];
    }
  }

  private async collectAdherence(
    context: CollectionContext,
    collectionDate: string,
    measuredAt: string,
  ): Promise<KpiResult> {
    try {
      const rows = await this.prisma.$queryRaw<AdherenceMealRow[]>`
        SELECT
          pm."recipeId" AS recipe_id,
          pm."updatedAt" AS meal_updated_at,
          mc."status" AS completion_status,
          mc."recipeIdSnapshot" AS completion_recipe_id_snapshot,
          mc."mealUpdatedAtSnapshot" AS completion_meal_updated_at_snapshot
        FROM "meal_plans" AS p
        INNER JOIN "meal_plan_days" AS d ON d."mealPlanId" = p."id"
        INNER JOIN "planned_meals" AS pm ON pm."dayId" = d."id"
        LEFT JOIN "meal_completions" AS mc
          ON mc."plannedMealId" = pm."id" AND mc."userId" = p."userId"
        WHERE p."isCurrent" = true
          AND d."date"::date <= ${collectionDate}::date
      `;

      let numerator = 0;
      for (const row of rows) {
        if (!(row.meal_updated_at instanceof Date) ||
          !(row.completion_meal_updated_at_snapshot === null || row.completion_meal_updated_at_snapshot instanceof Date) ||
          !(row.completion_status === null || ['COMPLETED', 'SKIPPED', 'NOT_LOGGED'].includes(row.completion_status)) ||
          (row.completion_status !== null && row.completion_meal_updated_at_snapshot === null)) {
          throw new TypeError('KPI adherence source row is invalid');
        }
        const status = effectiveMealStatus(row.completion_status === null ? null : {
          status: row.completion_status,
          recipeIdSnapshot: row.completion_recipe_id_snapshot,
          mealUpdatedAtSnapshot: row.completion_meal_updated_at_snapshot!,
        }, { recipeId: row.recipe_id, updatedAt: row.meal_updated_at });
        if (status === 'COMPLETED') numerator += 1;
      }
      if (!Number.isSafeInteger(rows.length) || !Number.isSafeInteger(numerator) || numerator > rows.length) {
        throw new TypeError('KPI adherence count exceeds the safe integer range');
      }
      return adherenceResult(numerator, rows.length, context.environment, collectionDate, measuredAt);
    } catch (error: unknown) {
      if (!isExpectedSourceFailure(error)) throw error;
      return adherenceUnavailable(context.environment, collectionDate, measuredAt, 'SOURCE_UNAVAILABLE');
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

function adherenceResult(
  numerator: number,
  denominator: number,
  environment: CollectionContext['environment'],
  collectionDate: string,
  measuredAt: string,
): KpiResult {
  if (denominator === 0) return adherenceUnavailable(environment, collectionDate, measuredAt, 'NO_ELIGIBLE_MEALS');
  const evidence: AdherenceEvidence = {
    numerator, denominator, quality: 'observed', reason: null,
    collection_date: collectionDate, measured_at: measuredAt, environment,
  };
  return {
    kpi_id: 'adherence_rate', value: (100 * numerator) / denominator, quality: 'observed',
    reason: null, sample_count: denominator, measured_at: measuredAt, evidence,
  };
}

function adherenceUnavailable(
  environment: CollectionContext['environment'],
  collectionDate: string,
  measuredAt: string,
  reason: 'NO_ELIGIBLE_MEALS' | 'SOURCE_UNAVAILABLE',
): KpiResult {
  const evidence: AdherenceEvidence = {
    numerator: reason === 'NO_ELIGIBLE_MEALS' ? 0 : null,
    denominator: reason === 'NO_ELIGIBLE_MEALS' ? 0 : null,
    quality: 'unavailable', reason,
    collection_date: collectionDate, measured_at: measuredAt, environment,
  };
  return {
    kpi_id: 'adherence_rate', value: null, quality: 'unavailable', reason,
    sample_count: 0, measured_at: measuredAt, evidence,
  };
}

function isExpectedSourceFailure(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && typeof error.code === 'string' && SOURCE_UNAVAILABLE_CODES.has(error.code);
}
