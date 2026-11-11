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

function nestedKeys(value: unknown): string[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...nestedKeys(child)]);
}

function makePrisma(readData: {
  plan?: any | null;
  days?: any[];
  meals?: any[];
  completions?: any[];
} = {}) {
  const events: Array<{ kind: string; sql?: string; values?: unknown[]; model?: string; args?: any }> = [];
  const data = {
    plan: null,
    days: [],
    meals: [],
    completions: [],
    ...readData,
  };
  const dataRead = (model: string, value: any) => jest.fn(async (args: any) => {
    events.push({ kind: 'dataRead', model, args });
    return value;
  });
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
    mealPlan: {
      findFirst: dataRead('mealPlan', data.plan),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    mealPlanDay: {
      findFirst: jest.fn(),
      findMany: dataRead('mealPlanDay', data.days),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    plannedMeal: {
      findFirst: jest.fn(async () => {
        events.push({ kind: 'mealLookup' });
        return { id: plannedMealId, day: { mealPlanId: planId } };
      }),
      findUnique: jest.fn(),
      findMany: dataRead('plannedMeal', data.meals),
      update: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    mealCompletion: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: dataRead('mealCompletion', data.completions),
      upsert: jest.fn().mockResolvedValue({
        plannedMealId,
        status: request.status,
        updatedAt: new Date('2026-10-20T12:31:00.000Z'),
      }),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
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

  it('refreshes snapshots for a stale NOT_LOGGED completion instead of treating it as idempotent', async () => {
    const { prisma, tx } = makePrisma();
    const staleCompletion = {
      userId: 'user-one',
      plannedMealId,
      status: 'NOT_LOGGED',
      recipeIdSnapshot: 'recipe-old',
      mealUpdatedAtSnapshot: new Date('2026-10-19T12:30:45.123Z'),
    };
    const currentCompletion = {
      ...staleCompletion,
      recipeIdSnapshot: 'recipe-one',
      mealUpdatedAtSnapshot: mealToken,
    };
    tx.mealCompletion.findUnique.mockResolvedValue(staleCompletion);
    tx.mealCompletion.upsert.mockResolvedValue(currentCompletion);
    const repository = new AdherenceRepository(prisma, () => new Date('2026-10-20T16:00:00.000Z'));

    const result = await repository.setMealStatus('user-one', plannedMealId, {
      ...request,
      status: 'NOT_LOGGED',
    });

    expect(result).toBe(currentCompletion);
    expect(tx.mealCompletion.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { plannedMealId },
      update: expect.objectContaining({
        status: 'NOT_LOGGED',
        recipeIdSnapshot: 'recipe-one',
        mealUpdatedAtSnapshot: mealToken,
      }),
    }));
  });

  it('keeps an exact current NOT_LOGGED completion idempotent', async () => {
    const { prisma, tx } = makePrisma();
    const existingCompletion = {
      userId: 'user-one',
      plannedMealId,
      status: 'NOT_LOGGED',
      recipeIdSnapshot: 'recipe-one',
      mealUpdatedAtSnapshot: new Date(mealToken.getTime()),
    };
    tx.mealCompletion.findUnique.mockResolvedValue(existingCompletion);
    const repository = new AdherenceRepository(prisma, () => new Date('2026-10-20T16:00:00.000Z'));

    const result = await repository.setMealStatus('user-one', plannedMealId, {
      ...request,
      status: 'NOT_LOGGED',
    });

    expect(result).toBe(existingCompletion);
    expect(tx.mealCompletion.upsert).not.toHaveBeenCalled();
  });
});

describe('AdherenceRepository.getCurrentSnapshot', () => {
  const weekStart = '2026-10-19';

  it('returns the same empty snapshot for a missing plan and skips child reads', async () => {
    const { prisma, tx } = makePrisma();
    const repository = new AdherenceRepository(prisma, () => new Date('2026-10-20T16:00:00.000Z'));

    await expect(repository.getCurrentSnapshot('user-one', weekStart)).resolves.toEqual({
      plan: null,
      days: [],
      meals: [],
      completions: [],
    });

    expect(tx.mealPlan.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: 'user-one',
        startDate: new Date(`${weekStart}T00:00:00.000Z`),
        isCurrent: true,
      },
      select: expect.any(Object),
    }));
    expect(tx.mealPlanDay.findMany).not.toHaveBeenCalled();
    expect(tx.plannedMeal.findMany).not.toHaveBeenCalled();
    expect(tx.mealCompletion.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      isolationLevel: 'RepeatableRead',
    }));
  });

  it('uses at most four scoped selected reads in one RepeatableRead transaction and performs no writes', async () => {
    const day = { id: 'day-one', mealPlanId: planId, date: new Date('2026-10-20T00:00:00.000Z') };
    const meal = {
      id: plannedMealId,
      dayId: day.id,
      mealType: 'BREAKFAST',
      title: 'Avena',
      recipeId: null,
      updatedAt: mealToken,
    };
    const plan = { id: planId, version: 2, updatedAt: new Date('2026-10-19T12:00:00.000Z') };
    const completion = {
      userId: 'user-one',
      plannedMealId,
      status: 'COMPLETED',
      recipeIdSnapshot: null,
      mealUpdatedAtSnapshot: mealToken,
    };
    const { prisma, tx, events } = makePrisma({ plan, days: [day], meals: [meal], completions: [completion] });
    const repository = new AdherenceRepository(prisma, () => new Date('2026-10-20T16:00:00.000Z'));

    const snapshot = await repository.getCurrentSnapshot('user-one', weekStart);

    expect(snapshot).toEqual({ plan, days: [day], meals: [meal], completions: [completion] });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      isolationLevel: 'RepeatableRead',
    }));

    const reads = events.filter((event) => event.kind === 'dataRead');
    expect(reads.map((event) => event.model)).toEqual(['mealPlan', 'mealPlanDay', 'plannedMeal', 'mealCompletion']);
    expect(reads.length).toBeLessThanOrEqual(4);
    for (const { args } of reads) {
      expect(args.select).toBeDefined();
      expect(args.include).toBeUndefined();
    }

    expect(tx.mealPlanDay.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { mealPlanId: planId },
      select: expect.any(Object),
    }));
    expect(tx.plannedMeal.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ day: { mealPlanId: planId } }),
      select: expect.any(Object),
    }));
    const completionRead = tx.mealCompletion.findMany.mock.calls[0][0];
    expect(completionRead.where).toEqual(expect.objectContaining({
      userId: 'user-one',
      plannedMealId: { in: [plannedMealId] },
    }));
    expect(completionRead.select).toBeDefined();

    const selectedKeys = reads.flatMap(({ args }) => nestedKeys(args.select));
    expect(selectedKeys).not.toContain('recipe');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    for (const delegate of [tx.mealPlan, tx.mealPlanDay, tx.plannedMeal, tx.mealCompletion]) {
      for (const method of ['create', 'upsert', 'update', 'delete']) {
        if (delegate[method]) expect(delegate[method]).not.toHaveBeenCalled();
      }
    }
  });

  it('does not query completions when the current plan has no persisted meals', async () => {
    const plan = { id: planId, version: 1, updatedAt: new Date('2026-10-19T12:00:00.000Z') };
    const { tx } = makePrisma({ plan, days: [{ id: 'empty-day', date: new Date('2026-10-20T00:00:00.000Z') }] });
    const repository = new AdherenceRepository({ $transaction: async (callback: any) => callback(tx) } as any);

    await repository.getCurrentSnapshot('user-one', weekStart);

    expect(tx.mealPlanDay.findMany).toHaveBeenCalledTimes(1);
    expect(tx.plannedMeal.findMany).toHaveBeenCalledTimes(1);
    expect(tx.mealCompletion.findMany).not.toHaveBeenCalled();
  });
});
