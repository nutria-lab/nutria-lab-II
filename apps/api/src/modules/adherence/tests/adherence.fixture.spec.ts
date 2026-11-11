import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformAdherence } from '../adherence.transform';

const fixturePath = resolve(__dirname, '../../../../../../apps/web/public/fixtures/adherence.json');
const weekStart = '2026-10-19';
const today = '2026-10-22';
const userId = '00000000-0000-4000-8000-000000000092';

function id(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
}

function syntheticSnapshot() {
  const days = Array.from({ length: 7 }, (_, index) => ({
    id: id(300 + index),
    date: new Date(`2026-10-${String(19 + index).padStart(2, '0')}T00:00:00.000Z`),
  }));
  const meals = [
    { id: id(1), dayId: days[0].id, mealType: 'BREAKFAST', title: 'Yogur y avena', recipeId: id(401), updatedAt: new Date('2026-10-19T08:00:00.000Z') },
    { id: id(2), dayId: days[0].id, mealType: 'BREAKFAST', title: 'Tostadas', recipeId: id(402), updatedAt: new Date('2026-10-19T08:01:00.000Z') },
    { id: id(3), dayId: days[0].id, mealType: 'LUNCH', title: 'Almuerzo sin registrar', recipeId: id(403), updatedAt: new Date('2026-10-19T12:00:00.000Z') },
    { id: id(4), dayId: days[0].id, mealType: 'SNACK', title: 'Merienda con token viejo', recipeId: id(404), updatedAt: new Date('2026-10-19T16:00:00.000Z') },
    { id: id(5), dayId: days[1].id, mealType: 'DINNER', title: 'Cena con receta cambiada', recipeId: id(405), updatedAt: new Date('2026-10-20T20:00:00.000Z') },
    { id: id(6), dayId: days[2].id, mealType: 'LUNCH', title: 'Comida sin receta', recipeId: null, updatedAt: new Date('2026-10-21T12:00:00.000Z') },
    { id: id(7), dayId: days[3].id, mealType: 'DINNER', title: 'Cena de hoy', recipeId: id(407), updatedAt: new Date('2026-10-22T20:00:00.000Z') },
    { id: id(8), dayId: days[4].id, mealType: 'BREAKFAST', title: 'Desayuno futuro', recipeId: id(408), updatedAt: new Date('2026-10-23T08:00:00.000Z') },
  ];
  const completions = [
    { userId, plannedMealId: id(1), status: 'COMPLETED', recipeIdSnapshot: id(401), mealUpdatedAtSnapshot: meals[0].updatedAt },
    { userId, plannedMealId: id(2), status: 'SKIPPED', recipeIdSnapshot: id(402), mealUpdatedAtSnapshot: meals[1].updatedAt },
    { userId, plannedMealId: id(4), status: 'COMPLETED', recipeIdSnapshot: id(404), mealUpdatedAtSnapshot: new Date('2026-10-19T15:59:59.999Z') },
    { userId, plannedMealId: id(5), status: 'COMPLETED', recipeIdSnapshot: id(999), mealUpdatedAtSnapshot: meals[4].updatedAt },
    { userId, plannedMealId: id(6), status: 'SKIPPED', recipeIdSnapshot: null, mealUpdatedAtSnapshot: meals[5].updatedAt },
    { userId, plannedMealId: id(7), status: 'COMPLETED', recipeIdSnapshot: id(407), mealUpdatedAtSnapshot: meals[6].updatedAt },
    { userId, plannedMealId: id(8), status: 'COMPLETED', recipeIdSnapshot: id(408), mealUpdatedAtSnapshot: meals[7].updatedAt },
  ];

  return {
    plan: { id: id(92), version: 2, updatedAt: new Date('2026-10-19T07:00:00.000Z') },
    days,
    meals,
    completions,
  };
}

describe('public adherence fixture', () => {
  function assertResponseContract(response: any) {
    expect(Object.keys(response).sort()).toEqual(['days', 'plan', 'summary', 'timezone', 'today', 'weekStart']);
    expect(response.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(response.today).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(response.timezone).toBe('America/Argentina/Buenos_Aires');
    expect(Object.keys(response.summary).sort()).toEqual([
      'adherencePercent', 'completedMeals', 'notLoggedMeals', 'plannedMeals', 'skippedMeals',
    ]);
    for (const day of response.days) {
      expect(Object.keys(day).sort()).toEqual([
        'adherencePercent', 'completedMeals', 'date', 'meals', 'notLoggedMeals', 'plannedMeals', 'skippedMeals',
      ]);
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      for (const meal of day.meals) {
        expect(Object.keys(meal).sort()).toEqual([
          'canEdit', 'mealType', 'mealUpdatedAt', 'plannedMealId', 'recipeId', 'status', 'title',
        ]);
        expect(meal.plannedMealId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
        expect(meal.status).toMatch(/^(NOT_LOGGED|COMPLETED|SKIPPED)$/u);
        expect(typeof meal.canEdit).toBe('boolean');
      }
    }
  }

  it('matches the real transformation for complete-week and empty synthetic examples', () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    expect(Object.keys(fixture).sort()).toEqual(['empty', 'populated']);
    assertResponseContract(fixture.populated);
    assertResponseContract(fixture.empty);

    expect(transformAdherence(weekStart, syntheticSnapshot() as any, today)).toEqual(fixture.populated);
    expect(transformAdherence(weekStart, { plan: null, days: [], meals: [], completions: [] } as any, today))
      .toEqual(fixture.empty);

    expect(fixture.populated.days.map((day: any) => day.date)).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
    ]);
    expect(fixture.populated.summary).toEqual({
      plannedMeals: 8,
      completedMeals: 2,
      skippedMeals: 2,
      notLoggedMeals: 4,
      adherencePercent: 25,
    });
    expect(fixture.populated.days[4].meals[0]).toMatchObject({ status: 'NOT_LOGGED', canEdit: false });
    expect(fixture.empty).toMatchObject({
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
