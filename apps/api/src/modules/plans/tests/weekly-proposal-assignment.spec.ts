import { DayOfWeek, MealType } from '../../../generated/prisma/client';

type Slot = { key: string; date?: string; day?: DayOfWeek; mealType?: MealType };
const { buildWeeklySlots, chunkHomogeneous, matchRecipesToSlots } = require('../weekly-proposal-assignment') as {
  buildWeeklySlots: (weekStart: Date) => Slot[];
  chunkHomogeneous: <T>(items: T[], keyOf: (item: T) => unknown, maxSize?: number) => T[][];
  matchRecipesToSlots: <T extends { id: string }>(
    slots: Slot[], candidates: T[], isEligible: (slot: Slot, candidate: T) => boolean,
  ) => Map<string, T>;
};

describe('weekly proposal assignment helpers', () => {
  const weekStart = new Date('2026-09-14T00:00:00.000Z');

  it('builds 28 slots in date order and BREAKFAST, LUNCH, SNACK, DINNER order', () => {
    const slots = buildWeeklySlots(weekStart);

    expect(slots).toHaveLength(28);
    expect(slots.slice(0, 4).map(({ date, day, mealType }) => ({ date, day, mealType }))).toEqual([
      { date: '2026-09-14', day: DayOfWeek.MONDAY, mealType: MealType.BREAKFAST },
      { date: '2026-09-14', day: DayOfWeek.MONDAY, mealType: MealType.LUNCH },
      { date: '2026-09-14', day: DayOfWeek.MONDAY, mealType: MealType.SNACK },
      { date: '2026-09-14', day: DayOfWeek.MONDAY, mealType: MealType.DINNER },
    ]);
    expect(slots.slice(-4).map(({ date, day, mealType }) => ({ date, day, mealType }))).toEqual([
      { date: '2026-09-20', day: DayOfWeek.SUNDAY, mealType: MealType.BREAKFAST },
      { date: '2026-09-20', day: DayOfWeek.SUNDAY, mealType: MealType.LUNCH },
      { date: '2026-09-20', day: DayOfWeek.SUNDAY, mealType: MealType.SNACK },
      { date: '2026-09-20', day: DayOfWeek.SUNDAY, mealType: MealType.DINNER },
    ]);
  });

  it('maximizes catalog coverage when a greedy first choice would leave a slot empty', () => {
    const slots = [{ key: 'A' }, { key: 'B' }] as any[];
    const recipes = [{ id: 'r1' }, { id: 'r2' }];
    const eligible = new Map([
      ['A', new Set(['r1', 'r2'])],
      ['B', new Set(['r1'])],
    ]);

    const assigned = matchRecipesToSlots(slots, recipes, (slot, recipe) => eligible.get(slot.key)?.has(recipe.id) ?? false);

    expect(assigned.get('A')?.id).toBe('r2');
    expect(assigned.get('B')?.id).toBe('r1');
    expect(new Set([...assigned.values()].map(({ id }) => id)).size).toBe(2);
  });

  it('resolves equal-cardinality ties deterministically and reports the exact missing slots', () => {
    const slots = [{ key: 'slot-1' }, { key: 'slot-2' }, { key: 'slot-3' }] as any[];
    const recipes = [{ id: 'r1' }, { id: 'r2' }];
    const eligible = () => true;

    const first = matchRecipesToSlots(slots, recipes, eligible);
    const second = matchRecipesToSlots(slots, recipes, eligible);
    const missing = slots.filter(({ key }) => !first.has(key));

    expect([...first.entries()].map(([key, recipe]) => [key, recipe.id])).toEqual(
      [...second.entries()].map(([key, recipe]) => [key, recipe.id]),
    );
    expect(first.size).toBe(2);
    expect(new Set([...first.values()].map(({ id }) => id)).size).toBe(2);
    expect(missing).toEqual([{ key: 'slot-3' }]);
  });

  it('chunks in input order, keeps criteria groups homogeneous, and never exceeds ten', () => {
    const items = [
      ...Array.from({ length: 11 }, (_, index) => ({ id: `a-${index}`, criteria: 'A' })),
      ...Array.from({ length: 17 }, (_, index) => ({ id: `b-${index}`, criteria: 'B' })),
    ];

    const chunks = chunkHomogeneous(items, item => item.criteria, 10);

    expect(chunks.map(chunk => chunk.length)).toEqual([10, 1, 10, 7]);
    expect(chunks.flat().map(({ id }) => id)).toEqual(items.map(({ id }) => id));
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(10);
      expect(new Set(chunk.map(({ criteria }) => criteria)).size).toBe(1);
    }
  });
});
