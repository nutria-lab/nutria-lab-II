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
  const $queryRaw = jest.fn(async () => [row]);
  return { $queryRaw };
}

describe('DataKpiLogger', () => {
  it('uses one tagged, parameterized query over the UTC [start, end) bounds and maps successful counts as observed', async () => {
    const prisma = queryPrisma({ initial_plans_count: 2n, manual_recipes_count: 3n });
    const logger = new DataKpiLogger(prisma as never);

    await expect(logger.collect(context)).resolves.toEqual([
      expect.objectContaining({
        kpi_id: 'initial_plans_count', value: 2, quality: 'observed', reason: null,
      }),
      expect.objectContaining({
        kpi_id: 'manual_recipes_count', value: 3, quality: 'observed', reason: null,
      }),
    ]);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
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

    await expect(logger.collect(context)).resolves.toEqual([
      expect.objectContaining({ kpi_id: 'initial_plans_count', value: 0, quality: 'observed', reason: null }),
      expect.objectContaining({ kpi_id: 'manual_recipes_count', value: 0, quality: 'observed', reason: null }),
    ]);
  });

  it('returns both business IDs as unavailable when the query source is unavailable', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue({ code: 'P2021' }) };
    const logger = new DataKpiLogger(prisma as never);

    await expect(logger.collect(context)).resolves.toEqual([
      expect.objectContaining({
        kpi_id: 'initial_plans_count', value: null, quality: 'unavailable', reason: 'SOURCE_UNAVAILABLE',
      }),
      expect.objectContaining({
        kpi_id: 'manual_recipes_count', value: null, quality: 'unavailable', reason: 'SOURCE_UNAVAILABLE',
      }),
    ]);
  });

  it('converts bigint only while it remains a safe integer and fails structurally on overflow', async () => {
    const safe = new DataKpiLogger(queryPrisma({
      initial_plans_count: BigInt(Number.MAX_SAFE_INTEGER), manual_recipes_count: 1n,
    }) as never);
    await expect(safe.collect(context)).resolves.toEqual([
      expect.objectContaining({ value: Number.MAX_SAFE_INTEGER }),
      expect.objectContaining({ value: 1 }),
    ]);

    const overflow = new DataKpiLogger(queryPrisma({
      initial_plans_count: BigInt(Number.MAX_SAFE_INTEGER) + 1n, manual_recipes_count: 1n,
    }) as never);
    await expect(overflow.collect(context)).rejects.toThrow(/safe integer|overflow/i);
  });
});
