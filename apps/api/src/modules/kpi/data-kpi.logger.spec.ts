import { DataKpiLogger } from './data-kpi.logger';
import { effectiveMealStatus } from '@/modules/adherence/effective-meal-status';
import { dateInBuenosAires } from '@/modules/adherence/adherence.repository';
import type { CollectionContext } from './kpi-contract';
import { selectAutomaticArgentinaKpiDate } from './kpi-window';

const context: CollectionContext = {
  contract_version: '1',
  date: '2026-10-09',
  environment: 'dev',
  window_start: '2026-10-09T03:00:00.000Z',
  window_end: '2026-10-10T00:00:00.000Z',
  run_id: 'run-86',
};

const measuredInstant = new Date('2026-10-10T06:04:05.006Z');

function queryPrisma(
  row: Record<string, bigint | number>,
  aggregate: { numerator: bigint | number; denominator: bigint | number } = { numerator: 0n, denominator: 0n },
) {
  const transactionCalls: { transaction: number | null; method: string; sql: string; values: unknown[] }[] = [];
  let currentTransaction: number | null = null;
  let transactionNumber = 0;
  const record = (method: string, result: unknown | ((transaction: number | null) => unknown)) =>
    jest.fn((strings: TemplateStringsArray | string, ...values: unknown[]) => {
      const sql = typeof strings === 'string' ? strings : Array.from(strings).join('?');
      transactionCalls.push({ transaction: currentTransaction, method, sql, values });
      return Promise.resolve(typeof result === 'function' ? result(currentTransaction) : result);
    });
  const transaction = {
    $executeRaw: record('$executeRaw', 0),
    $executeRawUnsafe: record('$executeRawUnsafe', 0),
    $queryRaw: record('$queryRaw', (transactionId: number | null) => transactionId === 1 ? [row] : [aggregate]),
  };
  const $queryRaw = jest.fn();
  const $transaction = jest.fn(async (run: (tx: typeof transaction) => Promise<unknown>) => {
    currentTransaction = ++transactionNumber;
    try {
      return await run(transaction);
    } finally {
      currentTransaction = null;
    }
  });
  return { $queryRaw, $transaction, transaction, transactionCalls };
}

function adherenceMeal(
  id: string,
  status: 'COMPLETED' | 'SKIPPED' | null,
  options: { userId?: string; stale?: boolean; staleRecipe?: boolean; staleUpdatedAt?: boolean; date?: string } = {},
) {
  const updatedAt = new Date('2026-10-28T12:00:00.000Z');
  return {
    planned_meal_id: id,
    user_id: options.userId ?? 'user-a',
    plan_is_current: true,
    meal_date: options.date ?? '2026-10-29',
    recipe_id: `recipe-${id}`,
    meal_updated_at: updatedAt,
    completion_status: status,
    completion_recipe_id_snapshot: status === null ? null : options.stale || options.staleRecipe ? 'old-recipe' : `recipe-${id}`,
    completion_meal_updated_at_snapshot: status === null
      ? null
      : options.stale || options.staleUpdatedAt ? new Date(updatedAt.getTime() - 1) : updatedAt,
  };
}

function queryWithAdherenceRows(rows: readonly Record<string, unknown>[]) {
  const numerator = rows.filter((row) => {
    if (row.completion_status === null) return false;
    return effectiveMealStatus({
      status: row.completion_status as 'COMPLETED' | 'SKIPPED',
      recipeIdSnapshot: row.completion_recipe_id_snapshot as string | null,
      mealUpdatedAtSnapshot: row.completion_meal_updated_at_snapshot as Date,
    }, {
      recipeId: row.recipe_id as string | null,
      updatedAt: row.meal_updated_at as Date,
    }) === 'COMPLETED';
  }).length;
  return queryPrisma(
    { initial_plans_count: 2n, manual_recipes_count: 3n },
    { numerator: BigInt(numerator), denominator: BigInt(rows.length) },
  );
}

function loggerFor(prisma: unknown) {
  return new DataKpiLogger(prisma as never, () => measuredInstant);
}

function resultFor(results: readonly { kpi_id: string }[]) {
  return results.find(({ kpi_id }) => kpi_id === 'adherence_rate') as
    | ({ kpi_id: string; value: number | null; quality: string; reason: string | null; sample_count: number; measured_at: string } & { evidence?: Record<string, unknown> })
    | undefined;
}

describe('DataKpiLogger', () => {
  it('keeps the tagged business-count query and aggregates adherence in its own bounded transaction', async () => {
    const prisma = queryPrisma({ initial_plans_count: 2n, manual_recipes_count: 3n });
    const logger = loggerFor(prisma);

    await expect(logger.collect(context)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kpi_id: 'initial_plans_count', value: 2, quality: 'observed', reason: null,
      }),
      expect.objectContaining({
        kpi_id: 'manual_recipes_count', value: 3, quality: 'observed', reason: null,
      }),
    ]));

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    const businessQuery = prisma.transactionCalls.find(({ transaction, method }) => transaction === 1 && method === '$queryRaw');
    expect(businessQuery?.sql).toContain('generation_runs');
    expect(businessQuery?.sql).toContain('MEAL_PLAN_INITIAL');
    expect(businessQuery?.sql).toContain('SUCCEEDED');
    expect(businessQuery?.sql).toContain('recipes');
    expect(businessQuery?.sql).toContain('MANUAL');
    expect(businessQuery?.sql).toMatch(/"createdAt"\s*>=/);
    expect(businessQuery?.sql).toMatch(/"createdAt"\s*</);
    expect(businessQuery?.values).toContainEqual(new Date(context.window_start));
    expect(businessQuery?.values).toContainEqual(new Date(context.window_end));
    for (const transactionId of [1, 2]) {
      const read = prisma.transactionCalls.find(({ transaction, method }) => transaction === transactionId && method === '$queryRaw');
      expect(read).toBeDefined();
      const readIndex = prisma.transactionCalls.indexOf(read!);
      const timeout = prisma.transactionCalls.find((call, index) =>
        call.transaction === transactionId && index < readIndex && /SET\s+LOCAL\s+statement_timeout/i.test(call.sql));
      expect(timeout).toBeDefined();
    }
  });

  it('preserves a successful zero as observed rather than unavailable', async () => {
    const logger = loggerFor(queryPrisma({ initial_plans_count: 0n, manual_recipes_count: 0n }));

    await expect(logger.collect(context)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ kpi_id: 'initial_plans_count', value: 0, quality: 'observed', reason: null }),
      expect.objectContaining({ kpi_id: 'manual_recipes_count', value: 0, quality: 'observed', reason: null }),
    ]));
  });

  it('maps a successful business-count query with no row to two observed zeros and records the real calculation time', async () => {
    const prisma = queryPrisma({ initial_plans_count: 0n, manual_recipes_count: 0n });
    prisma.transaction.$queryRaw.mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ numerator: 0n, denominator: 0n }]);
    const logger = new DataKpiLogger(prisma as never, () => measuredInstant);

    await expect(logger.collect(context)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ kpi_id: 'initial_plans_count', value: 0, quality: 'observed', measured_at: '2026-10-10T06:04:05.006Z' }),
      expect.objectContaining({ kpi_id: 'manual_recipes_count', value: 0, quality: 'observed', measured_at: '2026-10-10T06:04:05.006Z' }),
    ]));
  });

  it('returns both business IDs as unavailable when the query source is unavailable', async () => {
    const prisma = queryPrisma({ initial_plans_count: 0n, manual_recipes_count: 0n });
    prisma.transaction.$queryRaw.mockReset()
      .mockRejectedValueOnce({ code: 'P2021' })
      .mockResolvedValueOnce([{ numerator: 0n, denominator: 0n }]);
    const logger = loggerFor(prisma);

    await expect(logger.collect(context)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kpi_id: 'initial_plans_count', value: null, quality: 'unavailable', reason: 'SOURCE_UNAVAILABLE',
      }),
      expect.objectContaining({
        kpi_id: 'manual_recipes_count', value: null, quality: 'unavailable', reason: 'SOURCE_UNAVAILABLE',
      }),
    ]));
  });

  it('converts bigint only while it remains a safe integer and fails structurally on overflow', async () => {
    const safe = loggerFor(queryPrisma({
      initial_plans_count: BigInt(Number.MAX_SAFE_INTEGER), manual_recipes_count: 1n,
    }));
    await expect(safe.collect(context)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ value: Number.MAX_SAFE_INTEGER }),
      expect.objectContaining({ value: 1 }),
    ]));

    const overflow = loggerFor(queryPrisma({
      initial_plans_count: BigInt(Number.MAX_SAFE_INTEGER) + 1n, manual_recipes_count: 1n,
    }));
    await expect(overflow.collect(context)).rejects.toThrow(/safe integer|overflow/i);
  });

  it('collects adherence_rate as a third business KPI alongside the existing two', async () => {
    const logger = loggerFor(queryPrisma({ initial_plans_count: 2n, manual_recipes_count: 3n }));

    const results = await logger.collect(context);

    expect(results.map(({ kpi_id }) => kpi_id)).toContain('adherence_rate');
  });

  it.each([
    [32, 40, 80],
    [33, 40, 82.5],
    [31, 40, 77.5],
    [7999, 10000, 79.99],
  ])('calculates %i/%i as %s percent from planned meals and keeps numerator and denominator evidence', async (completed, eligible, value) => {
    const rows = Array.from({ length: eligible }, (_, index) => adherenceMeal(`meal-${index}`, index < completed ? 'COMPLETED' : null));
    const logger = loggerFor(queryWithAdherenceRows(rows));

    const results = await logger.collect({ ...context, environment: 'qa' });
    const result = resultFor(results);

    expect(result).toMatchObject({ value, quality: 'observed', reason: null, sample_count: eligible });
    expect(result?.evidence).toMatchObject({
      numerator: completed,
      denominator: eligible,
      quality: 'observed',
      reason: null,
      collection_date: context.date,
      measured_at: measuredInstant.toISOString(),
      environment: 'qa',
    });
  });

  it('treats zero completed meals with an eligible denominator as observed zero', async () => {
    const logger = loggerFor(queryWithAdherenceRows([
      adherenceMeal('meal-skipped', 'SKIPPED'),
      adherenceMeal('meal-not-logged', null),
    ]));

    const result = resultFor(await logger.collect(context));

    expect(result).toMatchObject({ value: 0, quality: 'observed', reason: null, sample_count: 2 });
    expect(result?.evidence).toMatchObject({ numerator: 0, denominator: 2, quality: 'observed' });
  });

  it('reports no eligible meals as unavailable rather than a fabricated observed zero', async () => {
    const logger = loggerFor(queryWithAdherenceRows([]));

    const result = resultFor(await logger.collect(context));

    expect(result).toMatchObject({ value: null, quality: 'unavailable', reason: 'NO_ELIGIBLE_MEALS', sample_count: 0 });
    expect(result?.evidence).toMatchObject({ numerator: 0, denominator: 0, quality: 'unavailable', reason: 'NO_ELIGIBLE_MEALS' });
  });

  it('aggregates by meal across unequal user populations instead of averaging user percentages', async () => {
    const rows = [
      adherenceMeal('one-meal-user-completed', 'COMPLETED', { userId: 'user-one' }),
      ...Array.from({ length: 9 }, (_, index) => adherenceMeal(`nine-meal-user-${index}`, null, { userId: 'user-nine' })),
    ];
    const logger = loggerFor(queryWithAdherenceRows(rows));

    const result = resultFor(await logger.collect(context));

    expect(result).toMatchObject({ value: 10, quality: 'observed', sample_count: 10 });
    expect(result?.evidence).toMatchObject({ numerator: 1, denominator: 10 });
  });

  it('keeps skipped, not-logged, and completion snapshots stale from the numerator', async () => {
    const logger = loggerFor(queryWithAdherenceRows([
      adherenceMeal('completed', 'COMPLETED'),
      adherenceMeal('skipped', 'SKIPPED'),
      adherenceMeal('not-logged', null),
      adherenceMeal('stale', 'COMPLETED', { stale: true }),
    ]));

    const result = resultFor(await logger.collect(context));

    expect(result).toMatchObject({ value: 25, quality: 'observed', sample_count: 4 });
    expect(result?.evidence).toMatchObject({ numerator: 1, denominator: 4 });
  });

  it('isolates an adherence source outage from the two existing business counts', async () => {
    const prisma = queryPrisma({ initial_plans_count: 2n, manual_recipes_count: 3n });
    prisma.transaction.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ initial_plans_count: 2n, manual_recipes_count: 3n }])
      .mockRejectedValueOnce({ code: 'P2021' });
    const logger = loggerFor(prisma);

    const results = await logger.collect(context);

    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ kpi_id: 'initial_plans_count', value: 2, quality: 'observed' }),
      expect.objectContaining({ kpi_id: 'manual_recipes_count', value: 3, quality: 'observed' }),
      expect.objectContaining({ kpi_id: 'adherence_rate', value: null, quality: 'unavailable', reason: 'SOURCE_UNAVAILABLE' }),
    ]));
  });

  it('does not put user, meal, or recipe identifiers into adherence evidence', async () => {
    const logger = loggerFor(queryWithAdherenceRows([
      adherenceMeal('private-meal-id', 'COMPLETED', { userId: 'private-user-id' }),
    ]));

    const result = resultFor(await logger.collect(context));

    expect(JSON.stringify(result?.evidence)).not.toMatch(/private-(?:user|meal)-id|recipe-private/i);
  });

  it('gates the report date and runs one bounded PostgreSQL aggregate for that date', async () => {
    const measuredAt = new Date('2026-10-10T06:04:05.006Z');
    const validDate = selectAutomaticArgentinaKpiDate({ now: () => measuredAt });
    expect(validDate).toBe('2026-10-09');

    expect(dateInBuenosAires(measuredAt)).toBe('2026-10-10');
    expect(validDate).not.toBe(dateInBuenosAires(measuredAt));
    const prisma = queryPrisma(
      { initial_plans_count: 2n, manual_recipes_count: 3n },
      { numerator: 32n, denominator: 40n },
    );
    const logger = new DataKpiLogger(prisma as never, () => measuredAt);
    const validContext = { ...context, date: validDate };

    const validResult = resultFor(await logger.collect(validContext));

    expect(validResult).toMatchObject({ value: 80, quality: 'observed', sample_count: 40 });
    expect(validResult?.evidence).toMatchObject({ numerator: 32, denominator: 40, collection_date: validDate });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.transaction.$queryRaw).toHaveBeenCalledTimes(2);
    const timeoutIndex = prisma.transactionCalls.findIndex(({ sql }) => /SET\s+LOCAL\s+statement_timeout/i.test(sql));
    const aggregateIndex = prisma.transactionCalls.findIndex(({ sql }) => /COUNT\s*\(\s*\*\s*\)[\s\S]*FILTER\s*\(/i.test(sql));
    expect(timeoutIndex).toBeGreaterThanOrEqual(0);
    expect(aggregateIndex).toBeGreaterThan(timeoutIndex);
    const timeoutSql = prisma.transactionCalls[timeoutIndex].sql;
    const timeoutMatch = /statement_timeout\s*=\s*'?(\d+)(ms|s)'?/i.exec(timeoutSql);
    expect(timeoutMatch).not.toBeNull();
    const timeoutMs = Number(timeoutMatch?.[1]) * (timeoutMatch?.[2] === 's' ? 1000 : 1);
    expect(timeoutMs).toBeGreaterThan(0);
    expect(timeoutMs).toBeLessThan(5_000);

    const aggregate = prisma.transactionCalls[aggregateIndex];
    expect(aggregate.sql).toMatch(/"date"\s*::date\s*=\s*\?/i);
    expect(aggregate.values).toContain(validDate);
    expect(aggregate.sql).toMatch(/COUNT\s*\(\s*\*\s*\)[\s\S]*FILTER\s*\(/i);
    expect(aggregate.sql).toMatch(/IS\s+NOT\s+DISTINCT\s+FROM/i);
    expect(aggregate.sql).toMatch(/mealUpdatedAtSnapshot/i);
    expect(aggregate.sql).not.toMatch(/SELECT\s+pm\."recipeId"\s+AS/i);

    const invalidContext = { ...validContext, date: '2026-10-08' };
    const invalidPrisma = queryPrisma({ initial_plans_count: 2n, manual_recipes_count: 3n });
    const invalidResult = resultFor(await loggerFor(invalidPrisma).collect(invalidContext));

    expect(invalidResult).toMatchObject({ value: null, quality: 'unavailable', reason: 'REPORT_DATE_NOT_CURRENT' });
    expect(invalidPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(invalidPrisma.transactionCalls.filter(({ method }) => method === '$queryRaw')).toHaveLength(1);
    expect(invalidPrisma.transactionCalls.some(({ sql }) => sql.includes('meal_plan_days'))).toBe(false);
  });

  it.each([
    ['recipe snapshot', { staleRecipe: true }],
    ['meal update snapshot', { staleUpdatedAt: true }],
  ])('does not count a stale %s as effective completion', async (_name, staleSnapshot) => {
    const prisma = queryWithAdherenceRows([
      adherenceMeal('fresh-completion', 'COMPLETED'),
      adherenceMeal('stale-completion', 'COMPLETED', staleSnapshot),
    ]);

    const result = resultFor(await loggerFor(prisma).collect(context));

    expect(result).toMatchObject({ value: 50, quality: 'observed', sample_count: 2 });
    expect(result?.evidence).toMatchObject({ numerator: 1, denominator: 2 });
  });

  it('maps the Prisma query-read timeout to unavailable adherence while preserving other KPIs', async () => {
    const prisma = queryPrisma({ initial_plans_count: 2n, manual_recipes_count: 3n });
    prisma.transaction.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ initial_plans_count: 2n, manual_recipes_count: 3n }])
      .mockRejectedValueOnce(new Error('Query read timeout'));

    const results = await loggerFor(prisma).collect(context);

    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ kpi_id: 'initial_plans_count', value: 2, quality: 'observed' }),
      expect.objectContaining({ kpi_id: 'manual_recipes_count', value: 3, quality: 'observed' }),
      expect.objectContaining({ kpi_id: 'adherence_rate', value: null, quality: 'unavailable', reason: 'SOURCE_UNAVAILABLE' }),
    ]));
  });

  it('bounds both initial business counts and adherence with a local timeout in each transaction', async () => {
    const prisma = queryPrisma(
      { initial_plans_count: 2n, manual_recipes_count: 3n },
      { numerator: 1n, denominator: 1n },
    );

    await loggerFor(prisma).collect(context);

    const selects = prisma.transactionCalls.filter(({ method, sql }) => method === '$queryRaw' && /\bSELECT\b[\s\S]*\bCOUNT\s*\(/i.test(sql));
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(selects).toHaveLength(2);
    for (const select of selects) {
      expect(select.transaction).not.toBeNull();
      const queryIndex = prisma.transactionCalls.indexOf(select);
      const timeout = prisma.transactionCalls.find((call, index) =>
        call.transaction === select.transaction && index < queryIndex && /SET\s+LOCAL\s+statement_timeout/i.test(call.sql));
      expect(timeout).toBeDefined();
      const configured = timeout && /statement_timeout\s*=\s*'?(\d+)(ms|s)'?/i.exec(timeout.sql);
      expect(configured).not.toBeNull();
      const timeoutMs = Number(configured?.[1]) * (configured?.[2] === 's' ? 1000 : 1);
      expect(timeoutMs).toBeGreaterThan(0);
      expect(timeoutMs).toBeLessThan(5_000);
    }
  });
});
