jest.mock('../../../prisma/prisma.service', () => ({ PrismaService: class PrismaService {} }));
import { AdherenceRepository } from '../adherence.repository';

const plannedMealId = '11111111-1111-4111-8111-111111111111';
const planId = '22222222-2222-4222-8222-222222222222';
const mealToken = new Date('2026-10-20T12:30:45.123Z');
const request = {
  planId,
  mealUpdatedAt: mealToken.toISOString(),
  status: 'COMPLETED' as const,
};

function makePrisma() {
  const events: Array<{ kind: string; sql?: string; values?: unknown[] }> = [];
  const tx: any = {
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      events.push({ kind: 'execute', sql: strings.join(' ').replace(/\s+/g, ' ').trim(), values });
      return 0;
    }),
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join(' ').replace(/\s+/g, ' ').trim();
      events.push({ kind: 'query', sql, values });
      if (sql.includes('FOR UPDATE') && sql.includes('"meal_plans"')) {
        return [{ id: planId, userId: 'user-one', isCurrent: true, updatedAt: new Date('2026-10-20T10:00:00.000Z') }];
      }
      if (sql.includes('FOR UPDATE') && sql.includes('"planned_meals"')) {
        return [{
          id: plannedMealId,
          planId,
          recipeId: 'recipe-one',
          updatedAt: mealToken,
          date: new Date('2026-10-20T00:00:00.000Z'),
        }];
      }
      return [];
    }),
    mealPlan: { findFirst: jest.fn(), findUnique: jest.fn() },
    mealPlanDay: { findFirst: jest.fn() },
    plannedMeal: {
      findFirst: jest.fn(async () => {
        events.push({ kind: 'mealLookup' });
        return { id: plannedMealId, day: { mealPlanId: planId } };
      }),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    mealCompletion: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({
        plannedMealId,
        status: request.status,
        updatedAt: new Date('2026-10-20T12:31:00.000Z'),
      }),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const prisma: any = {
    ...tx,
    $transaction: jest.fn(async (callback: (transaction: unknown) => Promise<unknown>) => callback(tx)),
  };
  return { prisma, tx, events };
}

describe('AdherenceRepository transaction policy', () => {
  it('sets a local lock timeout, then locks the owned plan before its meal', async () => {
    const { prisma, events } = makePrisma();
    const repository = new AdherenceRepository(prisma, () => new Date('2026-10-20T16:00:00.000Z'));

    await repository.setMealStatus('user-one', plannedMealId, request);

    expect(events[0]).toMatchObject({
      kind: 'execute',
      sql: "SET LOCAL lock_timeout = '5s'",
    });
    const locks = events.filter((event) => event.kind === 'query' && event.sql?.includes('FOR UPDATE'));
    expect(locks).toHaveLength(2);
    expect(locks[0].sql).toContain('"meal_plans"');
    expect(locks[1].sql).toContain('"planned_meals"');
    const mealLookupIndex = events.findIndex((event) => event.kind === 'mealLookup' || (
      event.kind === 'query' && event.sql?.includes('"planned_meals"') && !event.sql.includes('FOR UPDATE')
    ));
    expect(mealLookupIndex).toBeGreaterThan(0);
    expect(mealLookupIndex).toBeLessThan(events.indexOf(locks[0]));
    expect(locks[0].sql).toContain('"userId"');
    expect(locks[0].values).toEqual(expect.arrayContaining(['user-one', planId]));
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      isolationLevel: 'ReadCommitted',
    }));
  });

  it.each([
    ['P2034', { code: 'P2034' }],
    ['40001', { code: 'P2010', meta: { code: '40001' } }],
    ['40P01', { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '40P01' } } } }],
    ['55P03', { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '55P03' } } } }],
  ])('maps real transaction conflict %s to ADHERENCE_STALE', async (_name, conflict) => {
    const { prisma } = makePrisma();
    prisma.$transaction.mockRejectedValue(conflict);
    const repository = new AdherenceRepository(prisma, () => new Date('2026-10-20T16:00:00.000Z'));

    await expect(repository.setMealStatus('user-one', plannedMealId, request)).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'ADHERENCE_STALE' }),
    });
  });

  it('does not turn a generic transaction-start P2028 into ADHERENCE_STALE', async () => {
    const { prisma } = makePrisma();
    const infrastructureFailure = Object.assign(
      new Error('Unable to start a transaction in the given time'),
      { code: 'P2028' },
    );
    prisma.$transaction.mockRejectedValue(infrastructureFailure);
    const repository = new AdherenceRepository(prisma, () => new Date('2026-10-20T16:00:00.000Z'));

    await expect(repository.setMealStatus('user-one', plannedMealId, request)).rejects.toBe(infrastructureFailure);
  });

  it('does not convert an unknown connection failure into a domain conflict', async () => {
    const { prisma } = makePrisma();
    const infrastructureFailure = new Error('synthetic pool connection failure');
    prisma.$transaction.mockRejectedValue(infrastructureFailure);
    const repository = new AdherenceRepository(prisma, () => new Date('2026-10-20T16:00:00.000Z'));

    await expect(repository.setMealStatus('user-one', plannedMealId, request)).rejects.toBe(infrastructureFailure);
  });
});
