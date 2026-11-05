import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@/generated/prisma/client';
import { KPI_CLIENT_TIMEOUT_MS } from './db/kpi-prisma';
import { KPI_API_REQUEST_TIMEOUT_MS } from './kpi-api-client';
import { selectAutomaticArgentinaKpiDate } from './kpi-window';
import type { AdherenceEvidence, CollectionContext, KpiLogger, KpiResult } from './kpi-contract';

type CountRow = {
  initial_plans_count: bigint | number;
  manual_recipes_count: bigint | number;
};

type AdherenceCountRow = {
  numerator: bigint | number;
  denominator: bigint | number;
};

/** The only Prisma capability needed by this isolated read-only collector. */
type RawQueryClient = Pick<PrismaClient, '$queryRaw' | '$transaction'>;

const SOURCE_UNAVAILABLE_CODES = new Set([
  'P1001', 'P1002', 'P1008', 'P1017', 'P2021', 'P2022', 'P2024', 'P2028',
]);

export const KPI_DATA_SQL_STATEMENT_TIMEOUT_MS = KPI_CLIENT_TIMEOUT_MS - 1_000;
export const KPI_DATA_TRANSACTION_MAX_WAIT_MS = 250;
export const KPI_DATA_TRANSACTION_TIMEOUT_MS = KPI_CLIENT_TIMEOUT_MS - 500;
const SET_LOCAL_KPI_DATA_TIMEOUT = `SET LOCAL statement_timeout = '${KPI_DATA_SQL_STATEMENT_TIMEOUT_MS}ms'`;
const KPI_DATA_COLLECTION_BUDGET_MS = 2 * (KPI_DATA_TRANSACTION_MAX_WAIT_MS + KPI_DATA_TRANSACTION_TIMEOUT_MS);
if (KPI_DATA_SQL_STATEMENT_TIMEOUT_MS <= 0 ||
  KPI_DATA_SQL_STATEMENT_TIMEOUT_MS >= KPI_CLIENT_TIMEOUT_MS ||
  KPI_DATA_TRANSACTION_MAX_WAIT_MS + KPI_DATA_TRANSACTION_TIMEOUT_MS >= KPI_CLIENT_TIMEOUT_MS ||
  KPI_DATA_COLLECTION_BUDGET_MS >= KPI_API_REQUEST_TIMEOUT_MS) {
  throw new Error('KPI_DATA_QUERY_TIMEOUT_CONFIGURATION_INVALID');
}

@Injectable()
export class DataKpiLogger implements KpiLogger {
  constructor(private readonly prisma: RawQueryClient, private readonly clock: () => Date = () => new Date()) {}

  async collect(context: CollectionContext): Promise<readonly KpiResult[]> {
    // Freeze the collection instant before either query so the report-date gate and
    // evidence use one clock reading. Adherence only observes current DB state.
    const measuredInstant = this.clock();
    const measuredAt = measuredInstant.toISOString();
    const [initialPlans, manualRecipes] = await this.collectWindowCounts(context, measuredAt);
    const adherence = await this.collectAdherence(context, measuredInstant, measuredAt);
    return [initialPlans, manualRecipes, adherence];
  }

  private async collectWindowCounts(context: CollectionContext, measuredAt: string): Promise<[KpiResult, KpiResult]> {
    const start = new Date(context.window_start);
    const end = new Date(context.window_end);
    try {
      const rows = await this.prisma.$transaction(async transaction => {
        await transaction.$executeRawUnsafe(SET_LOCAL_KPI_DATA_TIMEOUT);
        return transaction.$queryRaw<CountRow[]>`
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
      }, {
        maxWait: KPI_DATA_TRANSACTION_MAX_WAIT_MS,
        timeout: KPI_DATA_TRANSACTION_TIMEOUT_MS,
      });
      const row = rows[0];
      const initialPlans = row ? countToSafeNumber(row.initial_plans_count, 'initial_plans_count') : 0;
      const manualRecipes = row ? countToSafeNumber(row.manual_recipes_count, 'manual_recipes_count') : 0;
      return [
        observedResult('initial_plans_count', initialPlans, measuredAt),
        observedResult('manual_recipes_count', manualRecipes, measuredAt),
      ];
    } catch (error: unknown) {
      if (!isExpectedSourceFailure(error) && !isStatementTimeout(error) && !isClientQueryTimeout(error)) throw error;
      return [unavailableResult('initial_plans_count', measuredAt), unavailableResult('manual_recipes_count', measuredAt)];
    }
  }

  private async collectAdherence(
    context: CollectionContext,
    measuredInstant: Date,
    measuredAt: string,
  ): Promise<KpiResult> {
    const reportDate = context.date;
    if (reportDate !== selectAutomaticArgentinaKpiDate({ now: () => measuredInstant })) {
      return adherenceUnavailable(context.environment, reportDate, measuredAt, 'REPORT_DATE_NOT_CURRENT');
    }

    try {
      const counts = await this.prisma.$transaction(async transaction => {
        await transaction.$executeRawUnsafe(SET_LOCAL_KPI_DATA_TIMEOUT);
        const rows = await transaction.$queryRaw<AdherenceCountRow[]>`
          SELECT
            COUNT(*) FILTER (
              WHERE mc."status" = 'COMPLETED'
                AND mc."recipeIdSnapshot" IS NOT DISTINCT FROM pm."recipeId"
                AND mc."mealUpdatedAtSnapshot" = pm."updatedAt"
            ) AS numerator,
            COUNT(*) AS denominator
          FROM "meal_plans" AS p
          INNER JOIN "meal_plan_days" AS d ON d."mealPlanId" = p."id"
          INNER JOIN "planned_meals" AS pm ON pm."dayId" = d."id"
          LEFT JOIN "meal_completions" AS mc
            ON mc."plannedMealId" = pm."id" AND mc."userId" = p."userId"
          WHERE p."isCurrent" = true
            AND d."date"::date = ${reportDate}::date
        `;
        return rows[0];
      }, {
        maxWait: KPI_DATA_TRANSACTION_MAX_WAIT_MS,
        timeout: KPI_DATA_TRANSACTION_TIMEOUT_MS,
      });

      if (!counts) throw new TypeError('KPI adherence aggregate row is missing');
      const numerator = countToNonNegativeSafeNumber(counts.numerator, 'adherence numerator');
      const denominator = countToNonNegativeSafeNumber(counts.denominator, 'adherence denominator');
      if (numerator > denominator) throw new TypeError('KPI adherence numerator exceeds denominator');
      return adherenceResult(numerator, denominator, context.environment, reportDate, measuredAt);
    } catch (error: unknown) {
      if (!isExpectedSourceFailure(error) && !isStatementTimeout(error) && !isClientQueryTimeout(error)) throw error;
      return adherenceUnavailable(context.environment, reportDate, measuredAt, 'SOURCE_UNAVAILABLE');
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

function countToNonNegativeSafeNumber(value: bigint | number, field: string): number {
  const numeric = countToSafeNumber(value, field);
  if (numeric < 0) throw new TypeError(`KPI ${field} count cannot be negative`);
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
  reportDate: string,
  measuredAt: string,
): KpiResult {
  if (denominator === 0) return adherenceUnavailable(environment, reportDate, measuredAt, 'NO_ELIGIBLE_MEALS');
  const evidence: AdherenceEvidence = {
    numerator, denominator, quality: 'observed', reason: null,
    collection_date: reportDate, measured_at: measuredAt, environment,
  };
  return {
    kpi_id: 'adherence_rate', value: (100 * numerator) / denominator, quality: 'observed',
    reason: null, sample_count: denominator, measured_at: measuredAt, evidence,
  };
}

function adherenceUnavailable(
  environment: CollectionContext['environment'],
  reportDate: string,
  measuredAt: string,
  reason: 'NO_ELIGIBLE_MEALS' | 'SOURCE_UNAVAILABLE' | 'REPORT_DATE_NOT_CURRENT',
): KpiResult {
  const evidence: AdherenceEvidence = {
    numerator: reason === 'NO_ELIGIBLE_MEALS' ? 0 : null,
    denominator: reason === 'NO_ELIGIBLE_MEALS' ? 0 : null,
    quality: 'unavailable', reason,
    collection_date: reportDate, measured_at: measuredAt, environment,
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

function isStatementTimeout(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== 'object' || current === null || seen.has(current)) continue;
    seen.add(current);
    const record = current as Record<string, unknown>;
    if (record.code === '57014' || record.originalCode === '57014') return true;
    pending.push(record.cause, record.meta, record.driverAdapterError);
  }
  return false;
}

function isClientQueryTimeout(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== 'object' || current === null || seen.has(current)) continue;
    seen.add(current);
    const record = current as Record<string, unknown>;
    if (record.message === 'Query read timeout') return true;
    pending.push(record.cause, record.meta, record.driverAdapterError);
  }
  return false;
}
