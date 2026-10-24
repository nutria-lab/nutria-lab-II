import { calculateAdherencePercent, transformAdherence } from '../adherence.transform';

const weekStart = '2026-10-19';
const today = '2026-10-22';
const userId = '00000000-0000-4000-8000-000000000092';
const planId = '00000000-0000-4000-8000-000000000093';
const planUpdatedAt = new Date('2026-10-19T09:00:00.000Z');

function id(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
}

function baseSnapshot() {
  const days = Array.from({ length: 7 }, (_, index) => ({
    id: id(100 + index),
    date: new Date(`2026-10-${String(19 + index).padStart(2, '0')}T00:00:00.000Z`),
  }));
  const meals = [
    { id: id(1), dayId: days[0].id, mealType: 'BREAKFAST', title: 'Desayuno uno', recipeId: id(201), updatedAt: new Date('2026-10-19T10:00:00.000Z') },
    { id: id(2), dayId: days[0].id, mealType: 'BREAKFAST', title: 'Desayuno dos', recipeId: id(202), updatedAt: new Date('2026-10-19T10:01:00.000Z') },
    { id: id(3), dayId: days[0].id, mealType: 'LUNCH', title: 'Almuerzo sin registro', recipeId: id(203), updatedAt: new Date('2026-10-19T11:00:00.000Z') },
    { id: id(4), dayId: days[0].id, mealType: 'SNACK', title: 'Merienda stale', recipeId: id(204), updatedAt: new Date('2026-10-19T12:00:00.000Z') },
    { id: id(5), dayId: days[0].id, mealType: 'DINNER', title: 'Cena stale', recipeId: id(205), updatedAt: new Date('2026-10-19T13:00:00.000Z') },
    { id: id(6), dayId: days[0].id, mealType: 'DINNER', title: 'Cena nueva', recipeId: id(206), updatedAt: new Date('2026-10-19T14:00:00.000Z') },
    { id: id(7), dayId: days[1].id, mealType: 'LUNCH', title: 'Receta eliminada', recipeId: null, updatedAt: new Date('2026-10-20T10:00:00.000Z') },
    { id: id(8), dayId: days[2].id, mealType: 'SNACK', title: 'Comida regenerada', recipeId: id(208), updatedAt: new Date('2026-10-21T10:00:00.000Z') },
    { id: id(9), dayId: days[3].id, mealType: 'DINNER', title: 'Comida de hoy', recipeId: id(209), updatedAt: new Date('2026-10-22T10:00:00.000Z') },
    { id: id(10), dayId: days[4].id, mealType: 'BREAKFAST', title: 'Comida futura', recipeId: id(210), updatedAt: new Date('2026-10-23T10:00:00.000Z') },
  ];
  const completions = [
    { userId, plannedMealId: id(1), status: 'COMPLETED', recipeIdSnapshot: id(201), mealUpdatedAtSnapshot: meals[0].updatedAt },
    { userId, plannedMealId: id(2), status: 'SKIPPED', recipeIdSnapshot: id(202), mealUpdatedAtSnapshot: meals[1].updatedAt },
    { userId, plannedMealId: id(4), status: 'COMPLETED', recipeIdSnapshot: id(204), mealUpdatedAtSnapshot: new Date(meals[3].updatedAt.getTime() - 1) },
    { userId, plannedMealId: id(5), status: 'COMPLETED', recipeIdSnapshot: id(999), mealUpdatedAtSnapshot: meals[4].updatedAt },
    { userId, plannedMealId: id(7), status: 'SKIPPED', recipeIdSnapshot: null, mealUpdatedAtSnapshot: meals[6].updatedAt },
    // A prior planned-meal ID cannot transfer its completion to the regenerated meal.
    { userId, plannedMealId: id(88), status: 'COMPLETED', recipeIdSnapshot: id(208), mealUpdatedAtSnapshot: meals[7].updatedAt },
    { userId, plannedMealId: id(9), status: 'COMPLETED', recipeIdSnapshot: id(209), mealUpdatedAtSnapshot: meals[8].updatedAt },
    { userId, plannedMealId: id(10), status: 'COMPLETED', recipeIdSnapshot: id(210), mealUpdatedAtSnapshot: meals[9].updatedAt },
  ];

  return {
    plan: { id: planId, version: 4, updatedAt: planUpdatedAt },
    days,
    meals,
    completions,
  };
}

describe('transformAdherence', () => {
  it.each([
    [3, 10, 30],
    [1, 3, 33.3],
    [2, 3, 66.7],
    [0, 0, null],
    [0, 10, 0],
    [10, 10, 100],
  ])('rounds %i/%i to %s percent', (completed, planned, expected) => {
    expect(calculateAdherencePercent(completed, planned)).toBe(expected);
  });

  it('applies both snapshot tokens, null recipe equality, and the future override', () => {
    const snapshot = baseSnapshot();
    const result = transformAdherence(weekStart, snapshot as any, today);
    const meals = result.days.flatMap((day: any) => day.meals);
    const byId = new Map(meals.map((meal: any) => [meal.plannedMealId, meal]));

    expect(byId.get(id(1))).toMatchObject({ status: 'COMPLETED', canEdit: true });
    expect(byId.get(id(2))).toMatchObject({ status: 'SKIPPED', canEdit: true });
    expect(byId.get(id(3))).toMatchObject({ status: 'NOT_LOGGED', canEdit: true });
    expect(byId.get(id(4))).toMatchObject({ status: 'NOT_LOGGED', canEdit: true });
    expect(byId.get(id(5))).toMatchObject({ status: 'NOT_LOGGED', canEdit: true });
    expect(byId.get(id(7))).toMatchObject({ recipeId: null, status: 'SKIPPED', canEdit: true });
    expect(byId.get(id(8))).toMatchObject({ status: 'NOT_LOGGED', canEdit: true });
    expect(byId.get(id(9))).toMatchObject({ status: 'COMPLETED', canEdit: true });
    expect(byId.get(id(10))).toMatchObject({ status: 'NOT_LOGGED', canEdit: false });
    expect(byId.get(id(10))).toMatchObject({ mealUpdatedAt: '2026-10-23T10:00:00.000Z' });
  });

  it('preserves seven persisted civil dates and sorts meals by explicit type then ID', () => {
    const result = transformAdherence(weekStart, baseSnapshot() as any, today);

    expect(result.days.map((day: any) => day.date)).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
    ]);
    expect(result.days[0].meals.map((meal: any) => meal.plannedMealId)).toEqual([
      id(1), id(2), id(3), id(4), id(5), id(6),
    ]);
    expect(result.days.every((day: any) => !Object.prototype.hasOwnProperty.call(day, 'canEdit'))).toBe(true);
    expect(result.days.flatMap((day: any) => day.meals).every((meal: any) =>
      Object.prototype.hasOwnProperty.call(meal, 'canEdit'))).toBe(true);
    expect(result.days[0].date).toBe('2026-10-19');
  });

  it('derives counters and weekly percentage from persisted meals rather than averaging days', () => {
    const result = transformAdherence(weekStart, baseSnapshot() as any, today);

    expect(result.days.map((day: any) => [
      day.plannedMeals, day.completedMeals, day.skippedMeals, day.notLoggedMeals,
    ])).toEqual([
      [6, 1, 1, 4],
      [1, 0, 1, 0],
      [1, 0, 0, 1],
      [1, 1, 0, 0],
      [1, 0, 0, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    for (const day of result.days) {
      expect(day.completedMeals + day.skippedMeals + day.notLoggedMeals).toBe(day.plannedMeals);
    }
    expect(result.summary).toEqual({
      plannedMeals: 10,
      completedMeals: 2,
      skippedMeals: 2,
      notLoggedMeals: 6,
      adherencePercent: 20,
    });
    expect(result.days[0].adherencePercent).toBe(16.7);
    expect(result.days[5].adherencePercent).toBeNull();
    expect(result.days[6].adherencePercent).toBeNull();
    expect(result.summary.adherencePercent).not.toBeCloseTo(
      result.days.reduce((sum: number, day: any) => sum + (day.adherencePercent ?? 0), 0) / result.days.length,
      1,
    );
  });

  it('returns only persisted days for a partial legacy plan and an empty contract without a plan', () => {
    const snapshot = baseSnapshot();
    const partial = {
      ...snapshot,
      days: [snapshot.days[3], snapshot.days[0]],
      meals: snapshot.meals.filter((meal) => meal.dayId === snapshot.days[0].id || meal.dayId === snapshot.days[3].id),
      completions: snapshot.completions.filter((completion) =>
        snapshot.meals.some((meal) => meal.id === completion.plannedMealId && (meal.dayId === snapshot.days[0].id || meal.dayId === snapshot.days[3].id))),
    };
    const partialResult = transformAdherence(weekStart, partial as any, today);
    expect(partialResult.days.map((day: any) => day.date)).toEqual(['2026-10-19', '2026-10-22']);
    expect(partialResult.days.reduce((count: number, day: any) => count + day.plannedMeals, 0)).toBe(7);

    const empty = transformAdherence(weekStart, { plan: null, days: [], meals: [], completions: [] } as any, today);
    expect(empty).toEqual({
      weekStart,
      timezone: 'America/Argentina/Buenos_Aires',
      today,
      plan: null,
      days: [],
      summary: {
        plannedMeals: 0,
        completedMeals: 0,
        skippedMeals: 0,
        notLoggedMeals: 0,
        adherencePercent: null,
      },
    });
  });
});
