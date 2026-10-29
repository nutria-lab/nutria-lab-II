import { DataKpiLogger } from './data-kpi.logger';
import type { CollectionContext } from './kpi-contract';

const context: CollectionContext = {
  contract_version: '1',
  date: '2026-10-09',
  environment: 'dev',
  window_start: '2026-10-09T03:00:00.000Z',
  window_end: '2026-10-10T00:00:00.000Z',
  run_id: 'run-86',
};

function queryPrisma(row: Record<string, bigint | number>) {
  const $queryRaw = jest.fn()
    .mockResolvedValueOnce([row])
    .mockResolvedValueOnce([]);
  return { $queryRaw };
}

function adherenceMeal(
  id: string,
  status: 'COMPLETED' | 'SKIPPED' | null,
  options: { userId?: string; stale?: boolean; date?: string } = {},
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
    completion_recipe_id_snapshot: status === null ? null : options.stale ? 'old-recipe' : `recipe-${id}`,
    completion_meal_updated_at_snapshot: status === null
      ? null
      : options.stale ? new Date(updatedAt.getTime() - 1) : updatedAt,
  };
}

function queryWithAdherenceRows(rows: readonly Record<string, unknown>[]) {
  const $queryRaw = jest.fn()
    .mockResolvedValueOnce([{ initial_plans_count: 2n, manual_recipes_count: 3n }])
    .mockResolvedValueOnce(rows);
  return { $queryRaw };
}

function resultFor(results: readonly { kpi_id: string }[]) {
  return results.find(({ kpi_id }) => kpi_id === 'adherence_rate') as
    | ({ kpi_id: string; value: number | null; quality: string; reason: string | null; sample_count: number; measured_at: string } & { evidence?: Record<string, unknown> })
    | undefined;
}

describe('DataKpiLogger', () => {
  it('keeps the tagged business-count query and reads adherence with an isolated second query', async () => {
    const prisma = queryPrisma({ initial_plans_count: 2n, manual_recipes_count: 3n });
    const logger = new DataKpiLogger(prisma as never);

    await expect(logger.collect(context)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kpi_id: 'initial_plans_count', value: 2, quality: 'observed', reason: null,
      }),
      expect.objectContaining({
        kpi_id: 'manual_recipes_count', value: 3, quality: 'observed', reason: null,
      }),
    ]));

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    const [sql, start, end] = prisma.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, Date, Date];
    expect(Array.from(sql).join('?')).toEqual(expect.stringContaining('meal_plans'));
    expect(Array.from(sql).join('?')).toEqual(expect.stringContaining('generation_runs'));
    expect(Array.from(sql).join('?')).toEqual(expect.stringContaining("'MEAL_PLAN_INITIAL'"));
    expect(Array.from(sql).join('?')).toEqual(expect.stringContaining("'SUCCEEDED'"));
    expect(Array.from(sql).join('?')).toEqual(expect.stringContaining('recipes'));
    expect(Array.from(sql).join('?')).toEqual(expect.stringContaining("'MANUAL'"));
    expect(Array.from(sql).join('?')).toEqual(expect.stringMatching(/"createdAt"\s*>=/));
    expect(Array.from(sql).join('?')).toEqual(expect.stringMatching(/"createdAt"\s*</));
    expect(start).toEqual(new Date(context.window_start));
    expect(end).toEqual(new Date(context.window_end));
  });

  it('preserves a successful zero as observed rather than unavailable', async () => {
    const logger = new DataKpiLogger(queryPrisma({ initial_plans_count: 0n, manual_recipes_count: 0n }) as never);

    await expect(logger.collect(context)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ kpi_id: 'initial_plans_count', value: 0, quality: 'observed', reason: null }),
      expect.objectContaining({ kpi_id: 'manual_recipes_count', value: 0, quality: 'observed', reason: null }),
    ]));
  });

  it('maps a successful business-count query with no row to two observed zeros and records the real calculation time', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]) };
    const logger = new DataKpiLogger(prisma as never, () => new Date('2026-10-10T00:04:05.006Z'));

    await expect(logger.collect(context)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ kpi_id: 'initial_plans_count', value: 0, quality: 'observed', measured_at: '2026-10-10T00:04:05.006Z' }),
      expect.objectContaining({ kpi_id: 'manual_recipes_count', value: 0, quality: 'observed', measured_at: '2026-10-10T00:04:05.006Z' }),
    ]));
  });

  it('returns both business IDs as unavailable when the query source is unavailable', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValueOnce({ code: 'P2021' }).mockResolvedValueOnce([]) };
    const logger = new DataKpiLogger(prisma as never);

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
    const safe = new DataKpiLogger(queryPrisma({
      initial_plans_count: BigInt(Number.MAX_SAFE_INTEGER), manual_recipes_count: 1n,
    }) as never);
    await expect(safe.collect(context)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ value: Number.MAX_SAFE_INTEGER }),
      expect.objectContaining({ value: 1 }),
    ]));

    const overflow = new DataKpiLogger(queryPrisma({
      initial_plans_count: BigInt(Number.MAX_SAFE_INTEGER) + 1n, manual_recipes_count: 1n,
    }) as never);
    await expect(overflow.collect(context)).rejects.toThrow(/safe integer|overflow/i);
  });

  it('collects adherence_rate as a third business KPI alongside the existing two', async () => {
    const logger = new DataKpiLogger(queryPrisma({ initial_plans_count: 2n, manual_recipes_count: 3n }) as never);

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
    const logger = new DataKpiLogger(
      queryWithAdherenceRows(rows) as never,
      () => new Date('2026-10-29T03:00:00.000Z'),
    );

    const results = await logger.collect({ ...context, date: '2026-10-01', environment: 'qa' });
    const result = resultFor(results);

    expect(result).toMatchObject({ value, quality: 'observed', reason: null, sample_count: eligible });
    expect(result?.evidence).toMatchObject({
      numerator: completed,
      denominator: eligible,
      quality: 'observed',
      reason: null,
      collection_date: '2026-10-29',
      measured_at: '2026-10-29T03:00:00.000Z',
      environment: 'qa',
    });
  });

  it('treats zero completed meals with an eligible denominator as observed zero', async () => {
    const logger = new DataKpiLogger(queryWithAdherenceRows([
      adherenceMeal('meal-skipped', 'SKIPPED'),
      adherenceMeal('meal-not-logged', null),
    ]) as never, () => new Date('2026-10-29T03:00:00.000Z'));

    const result = resultFor(await logger.collect(context));

    expect(result).toMatchObject({ value: 0, quality: 'observed', reason: null, sample_count: 2 });
    expect(result?.evidence).toMatchObject({ numerator: 0, denominator: 2, quality: 'observed' });
  });

  it('reports no eligible meals as unavailable rather than a fabricated observed zero', async () => {
    const logger = new DataKpiLogger(queryWithAdherenceRows([]) as never, () => new Date('2026-10-29T03:00:00.000Z'));

    const result = resultFor(await logger.collect(context));

    expect(result).toMatchObject({ value: null, quality: 'unavailable', reason: 'NO_ELIGIBLE_MEALS', sample_count: 0 });
    expect(result?.evidence).toMatchObject({ numerator: 0, denominator: 0, quality: 'unavailable', reason: 'NO_ELIGIBLE_MEALS' });
  });

  it('aggregates by meal across unequal user populations instead of averaging user percentages', async () => {
    const rows = [
      adherenceMeal('one-meal-user-completed', 'COMPLETED', { userId: 'user-one' }),
      ...Array.from({ length: 9 }, (_, index) => adherenceMeal(`nine-meal-user-${index}`, null, { userId: 'user-nine' })),
    ];
    const logger = new DataKpiLogger(queryWithAdherenceRows(rows) as never, () => new Date('2026-10-29T03:00:00.000Z'));

    const result = resultFor(await logger.collect(context));

    expect(result).toMatchObject({ value: 10, quality: 'observed', sample_count: 10 });
    expect(result?.evidence).toMatchObject({ numerator: 1, denominator: 10 });
  });

  it('keeps skipped, not-logged, and completion snapshots stale from the numerator', async () => {
    const logger = new DataKpiLogger(queryWithAdherenceRows([
      adherenceMeal('completed', 'COMPLETED'),
      adherenceMeal('skipped', 'SKIPPED'),
      adherenceMeal('not-logged', null),
      adherenceMeal('stale', 'COMPLETED', { stale: true }),
    ]) as never, () => new Date('2026-10-29T03:00:00.000Z'));

    const result = resultFor(await logger.collect(context));

    expect(result).toMatchObject({ value: 25, quality: 'observed', sample_count: 4 });
    expect(result?.evidence).toMatchObject({ numerator: 1, denominator: 4 });
  });

  it('isolates an adherence source outage from the two existing business counts', async () => {
    const prisma = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ initial_plans_count: 2n, manual_recipes_count: 3n }])
        .mockRejectedValueOnce({ code: 'P2021' }),
    };
    const logger = new DataKpiLogger(prisma as never, () => new Date('2026-10-29T03:00:00.000Z'));

    const results = await logger.collect(context);

    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ kpi_id: 'initial_plans_count', value: 2, quality: 'observed' }),
      expect.objectContaining({ kpi_id: 'manual_recipes_count', value: 3, quality: 'observed' }),
      expect.objectContaining({ kpi_id: 'adherence_rate', value: null, quality: 'unavailable', reason: 'SOURCE_UNAVAILABLE' }),
    ]));
  });

  it('uses the Buenos Aires collection date, not the report date, to select current meals', async () => {
    const prisma = queryWithAdherenceRows([adherenceMeal('today-meal', null)]);
    const logger = new DataKpiLogger(prisma as never, () => new Date('2026-10-29T03:00:00.000Z'));

    const result = resultFor(await logger.collect({ ...context, date: '2026-10-01', environment: 'qa' }));

    expect(result?.evidence).toMatchObject({ collection_date: '2026-10-29', environment: 'qa' });
    const [query] = prisma.$queryRaw.mock.calls[1] as unknown as [TemplateStringsArray, ...unknown[]];
    const sql = Array.from(query).join('?');
    expect(sql).toContain('meal_plans');
    expect(sql).toContain('meal_plan_days');
    expect(sql).toContain('planned_meals');
    expect(sql).toContain('meal_completions');
    expect(sql).toContain('isCurrent');
    expect(sql).toContain('date');
    expect(sql).not.toMatch(/updatedAt\s*</i);
    expect(prisma.$queryRaw.mock.calls[1]).toContain('2026-10-29');
  });

  it('switches the collection civil date at Buenos Aires midnight even when the UTC day already changed', async () => {
    const prisma = queryWithAdherenceRows([adherenceMeal('previous-local-day-meal', null, { date: '2026-10-28' })]);
    const logger = new DataKpiLogger(prisma as never, () => new Date('2026-10-29T02:59:59.999Z'));

    const result = resultFor(await logger.collect({ ...context, date: '2026-10-29' }));

    expect(result?.evidence).toMatchObject({ collection_date: '2026-10-28' });
    expect(prisma.$queryRaw.mock.calls[1]).toContain('2026-10-28');
  });

  it('does not put user, meal, or recipe identifiers into adherence evidence', async () => {
    const logger = new DataKpiLogger(queryWithAdherenceRows([
      adherenceMeal('private-meal-id', 'COMPLETED', { userId: 'private-user-id' }),
    ]) as never, () => new Date('2026-10-29T03:00:00.000Z'));

    const result = resultFor(await logger.collect(context));

    expect(JSON.stringify(result?.evidence)).not.toMatch(/private-(?:user|meal)-id|recipe-private/i);
  });
});
