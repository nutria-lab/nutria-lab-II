import { toPublicMealPlan } from '../meal-plan-response';

describe('toPublicMealPlan - orden canónico NUT-106', () => {
  it('ordena días por fecha e ID y comidas por prioridad explícita e ID estable', () => {
    const plan = {
      id: 'plan-1',
      days: [
        {
          id: 'day-2026-09-15-b',
          date: new Date('2026-09-15T00:00:00.000Z'),
          meals: [
            { id: 'dinner-2', mealType: 'DINNER', updatedAt: new Date('2026-01-01T00:00:00.000Z') },
            { id: 'snack', mealType: 'SNACK' },
            { id: 'breakfast', mealType: 'BREAKFAST' },
            { id: 'lunch', mealType: 'LUNCH' },
            { id: 'dinner-1', mealType: 'DINNER', updatedAt: new Date('2026-12-31T00:00:00.000Z') },
          ],
        },
        {
          id: 'day-2026-09-14',
          date: new Date('2026-09-14T00:00:00.000Z'),
          meals: [
            { id: 'missing-types-lunch', mealType: 'LUNCH' },
            { id: 'missing-types-breakfast', mealType: 'BREAKFAST' },
          ],
        },
        {
          id: 'day-2026-09-15-a',
          date: new Date('2026-09-15T00:00:00.000Z'),
          meals: [],
        },
      ],
    };

    const response = toPublicMealPlan(plan);

    expect(response.days.map((day: any) => day.id)).toEqual([
      'day-2026-09-14',
      'day-2026-09-15-a',
      'day-2026-09-15-b',
    ]);
    expect(response.days.map((day: any) => day.meals.map((meal: any) => meal.id))).toEqual([
      ['missing-types-breakfast', 'missing-types-lunch'],
      [],
      ['breakfast', 'lunch', 'snack', 'dinner-1', 'dinner-2'],
    ]);
  });

  it('preserva días vacíos y ausencias, no muta la entrada y es idempotente', () => {
    const sourceDays = [
      { id: 'day-2', date: '2026-09-15', meals: [{ id: 'dinner', mealType: 'DINNER' }] },
      { id: 'day-1', date: '2026-09-14', meals: [] },
    ];
    const originalDayIds = sourceDays.map(day => day.id);
    const originalMealIds = sourceDays.map(day => day.meals.map(meal => meal.id));

    const first = toPublicMealPlan({ id: 'plan-1', days: sourceDays });
    const second = toPublicMealPlan(first);

    expect(first.days.map((day: any) => day.id)).toEqual(['day-1', 'day-2']);
    expect(first.days[0].meals).toEqual([]);
    expect(first.days[1].meals.map((meal: any) => meal.mealType)).toEqual(['DINNER']);
    expect(second.days).toEqual(first.days);
    expect(sourceDays.map(day => day.id)).toEqual(originalDayIds);
    expect(sourceDays.map(day => day.meals.map(meal => meal.id))).toEqual(originalMealIds);
  });
});
