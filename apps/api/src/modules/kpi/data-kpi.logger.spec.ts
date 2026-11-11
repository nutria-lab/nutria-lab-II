import { DataKpiLogger } from './data-kpi.logger';
import type { CollectionContext } from './kpi-contract';

const context: CollectionContext = {
  contract_version: '1', date: '2026-10-09', environment: 'dev',
  window_start: '2026-10-09T03:00:00.000Z', window_end: '2026-10-10T00:00:00.000Z', run_id: 'run-86',
};

function queryPrisma(row: Record<string, number | bigint | null>) {
  const $queryRaw = jest.fn(async () => [row]);
  return { $queryRaw };
}

describe('DataKpiLogger', () => {
  it('collects simple average weekly adherence per user and manual recipe count', async () => {
    const prisma = queryPrisma({ adherence_percent: 66.7, adherence_users: 2n, manual_recipes_count: 3n });
    const logger = new DataKpiLogger(prisma as never);
    await expect(logger.collect(context)).resolves.toEqual([
      expect.objectContaining({ kpi_id: 'adherence_rate', value: 66.7, quality: 'observed', sample_count: 2 }),
      expect.objectContaining({ kpi_id: 'manual_recipes_count', value: 3, quality: 'observed' }),
    ]);

    const [sql, ...parameters] = prisma.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    const query = Array.from(sql).join('?');
    expect(query).toContain('meal_completions');
    expect(query).toContain('planned_meals');
    expect(query).toContain('"isCurrent"');
    expect(query).toContain('"mealUpdatedAtSnapshot"');
    expect(parameters).toContainEqual(new Date('2026-10-05T00:00:00.000Z'));
    expect(parameters).toContainEqual(new Date(context.date + 'T00:00:00.000Z'));
    expect(query).toContain('recipes');
  });

  it('preserves zero adherence when users have planned meals', async () => {
    const logger = new DataKpiLogger(queryPrisma({ adherence_percent: 0, adherence_users: 4n, manual_recipes_count: 0n }) as never);
    await expect(logger.collect(context)).resolves.toEqual([
      expect.objectContaining({ kpi_id: 'adherence_rate', value: 0, quality: 'observed', sample_count: 4 }),
      expect.objectContaining({ kpi_id: 'manual_recipes_count', value: 0, quality: 'observed' }),
    ]);
  });

  it('reports adherence unavailable when the query has no users with planned meals', async () => {
    const logger = new DataKpiLogger({ $queryRaw: jest.fn(async () => []) } as never, () => new Date('2026-10-10T00:04:05.006Z'));
    await expect(logger.collect(context)).resolves.toEqual([
      expect.objectContaining({ kpi_id: 'adherence_rate', value: null, quality: 'unavailable', reason: 'NO_PLANNED_MEALS', measured_at: '2026-10-10T00:04:05.006Z' }),
      expect.objectContaining({ kpi_id: 'manual_recipes_count', value: 0, quality: 'observed', measured_at: '2026-10-10T00:04:05.006Z' }),
    ]);
  });

  it('returns both business IDs unavailable when the source is unavailable', async () => {
    const logger = new DataKpiLogger({ $queryRaw: jest.fn().mockRejectedValue({ code: 'P2021' }) } as never);
    await expect(logger.collect(context)).resolves.toEqual([
      expect.objectContaining({ kpi_id: 'adherence_rate', value: null, quality: 'unavailable', reason: 'SOURCE_UNAVAILABLE' }),
      expect.objectContaining({ kpi_id: 'manual_recipes_count', value: null, quality: 'unavailable', reason: 'SOURCE_UNAVAILABLE' }),
    ]);
  });

  it('rejects an unsafe user sample count', async () => {
    const logger = new DataKpiLogger(queryPrisma({ adherence_percent: 50, adherence_users: BigInt(Number.MAX_SAFE_INTEGER) + 1n, manual_recipes_count: 1n }) as never);
    await expect(logger.collect(context)).rejects.toThrow(/safe integer|overflow/i);
  });
});
