import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AdherenceDay,
  AdherenceMeal,
  AdherenceResponse,
  CardState,
  MealCompletionStatus,
  TodayMeal,
  TodayMealsData,
} from '@/modules/dashboard/types';
import {
  MEAL_STATUS_LABELS,
  MEAL_TYPE_ORDER,
  buildGreeting,
  buildUnavailableViewModel,
  getMealStatusLabel,
  hasNextMealColumn,
  hasUnknownStatus,
  nextMealToLog,
  selectTodayMeals,
  sortMealsByType,
} from '@/modules/dashboard/utils';

const TODAY = '2026-10-19';

function meal(overrides: Partial<TodayMeal> & Pick<TodayMeal, 'plannedMealId' | 'mealType'>): TodayMeal {
  return {
    title: `Comida ${overrides.plannedMealId}`,
    recipeId: `recipe-${overrides.plannedMealId}`,
    status: 'NOT_LOGGED',
    ...overrides,
  };
}

function adherenceMeal(
  overrides: Partial<AdherenceMeal> & Pick<AdherenceMeal, 'plannedMealId' | 'mealType'>,
): AdherenceMeal {
  return {
    mealUpdatedAt: '2026-10-18T12:00:00.000Z',
    recipeId: `recipe-${overrides.plannedMealId}`,
    title: `Comida ${overrides.plannedMealId}`,
    status: 'NOT_LOGGED',
    canEdit: true,
    ...overrides,
  };
}

function adherenceDay(date: string, meals: AdherenceMeal[]): AdherenceDay {
  return {
    date,
    plannedMeals: meals.length,
    completedMeals: 0,
    skippedMeals: 0,
    notLoggedMeals: meals.length,
    adherencePercent: null,
    meals,
  };
}

function adherence(overrides: Partial<AdherenceResponse> = {}): AdherenceResponse {
  return {
    weekStart: '2026-10-19',
    timezone: 'America/Argentina/Buenos_Aires',
    today: TODAY,
    plan: { id: 'plan-1', version: 1, updatedAt: '2026-10-18T12:00:00.000Z' },
    days: [],
    summary: {
      plannedMeals: 0,
      completedMeals: 0,
      skippedMeals: 0,
      notLoggedMeals: 0,
      adherencePercent: null,
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('buildGreeting', () => {
  it.each([
    ['María José Rosales', 'Hola, María'],
    ['Persona', 'Hola, Persona'],
    ['  Ana  Paula', 'Hola, Ana'],
  ])('uses the first name of %j', (name, expected) => {
    expect(buildGreeting(name)).toBe(expected);
  });

  it.each([null, undefined, '', '   '])('falls back to "Hola" without comma for %j', (name) => {
    expect(buildGreeting(name)).toBe('Hola');
  });
});

describe('MEAL_TYPE_ORDER', () => {
  it('is the fixed order BREAKFAST, LUNCH, SNACK, DINNER', () => {
    expect(MEAL_TYPE_ORDER).toEqual(['BREAKFAST', 'LUNCH', 'SNACK', 'DINNER']);
  });
});

describe('sortMealsByType', () => {
  it('orders meals by the fixed meal type order', () => {
    const input = [
      meal({ plannedMealId: 'd', mealType: 'DINNER' }),
      meal({ plannedMealId: 's', mealType: 'SNACK' }),
      meal({ plannedMealId: 'b', mealType: 'BREAKFAST' }),
      meal({ plannedMealId: 'l', mealType: 'LUNCH' }),
    ];

    expect(sortMealsByType(input).map((m) => m.mealType)).toEqual([
      'BREAKFAST',
      'LUNCH',
      'SNACK',
      'DINNER',
    ]);
  });

  it('does not mutate the input', () => {
    const input = Object.freeze([
      meal({ plannedMealId: 'd', mealType: 'DINNER' }),
      meal({ plannedMealId: 'b', mealType: 'BREAKFAST' }),
    ]);
    const snapshot = [...input];

    const result = sortMealsByType(input);

    expect(input).toEqual(snapshot);
    expect(result).not.toBe(input);
  });

  it('keeps the relative order of meals with the same type', () => {
    const input = [
      meal({ plannedMealId: 'snack-1', mealType: 'SNACK' }),
      meal({ plannedMealId: 'lunch-1', mealType: 'LUNCH' }),
      meal({ plannedMealId: 'snack-2', mealType: 'SNACK' }),
      meal({ plannedMealId: 'lunch-2', mealType: 'LUNCH' }),
    ];

    expect(sortMealsByType(input).map((m) => m.plannedMealId)).toEqual([
      'lunch-1',
      'lunch-2',
      'snack-1',
      'snack-2',
    ]);
  });
});

describe('selectTodayMeals', () => {
  it('returns noPlan when the plan is null', () => {
    const result: TodayMealsData = selectTodayMeals(
      adherence({
        plan: null,
        days: [adherenceDay(TODAY, [adherenceMeal({ plannedMealId: 'b', mealType: 'BREAKFAST' })])],
      }),
    );

    expect(result).toEqual({ kind: 'noPlan' });
  });

  it('returns noMealsToday when there is no day for today', () => {
    const result = selectTodayMeals(
      adherence({
        days: [adherenceDay('2026-10-20', [adherenceMeal({ plannedMealId: 'b', mealType: 'BREAKFAST' })])],
      }),
    );

    expect(result).toEqual({ kind: 'noMealsToday' });
  });

  it('returns noMealsToday when today has no meals', () => {
    const result = selectTodayMeals(adherence({ days: [adherenceDay(TODAY, [])] }));

    expect(result).toEqual({ kind: 'noMealsToday' });
  });

  it('maps and orders today meals, ignoring other days', () => {
    const result = selectTodayMeals(
      adherence({
        days: [
          adherenceDay('2026-10-18', [adherenceMeal({ plannedMealId: 'yesterday', mealType: 'BREAKFAST' })]),
          adherenceDay(TODAY, [
            adherenceMeal({ plannedMealId: 'd', mealType: 'DINNER', title: 'Cena X', status: 'NOT_LOGGED' }),
            adherenceMeal({ plannedMealId: 's', mealType: 'SNACK', title: 'Merienda X', status: 'SKIPPED' }),
            adherenceMeal({
              plannedMealId: 'b',
              mealType: 'BREAKFAST',
              title: 'Desayuno X',
              status: 'COMPLETED',
              recipeId: null,
            }),
            adherenceMeal({ plannedMealId: 'l', mealType: 'LUNCH', title: 'Almuerzo X', status: 'NOT_LOGGED' }),
          ]),
          adherenceDay('2026-10-20', [adherenceMeal({ plannedMealId: 'tomorrow', mealType: 'LUNCH' })]),
        ],
      }),
    );

    expect(result).toEqual({
      kind: 'meals',
      meals: [
        { plannedMealId: 'b', mealType: 'BREAKFAST', title: 'Desayuno X', recipeId: null, status: 'COMPLETED' },
        { plannedMealId: 'l', mealType: 'LUNCH', title: 'Almuerzo X', recipeId: 'recipe-l', status: 'NOT_LOGGED' },
        { plannedMealId: 's', mealType: 'SNACK', title: 'Merienda X', recipeId: 'recipe-s', status: 'SKIPPED' },
        { plannedMealId: 'd', mealType: 'DINNER', title: 'Cena X', recipeId: 'recipe-d', status: 'NOT_LOGGED' },
      ],
    });
  });

  it('maps contract A meals without inventing an image', () => {
    const result = selectTodayMeals(
      adherence({
        days: [
          adherenceDay(TODAY, [
            adherenceMeal({ plannedMealId: 'l', mealType: 'LUNCH', title: 'Almuerzo X' }),
            adherenceMeal({ plannedMealId: 'b', mealType: 'BREAKFAST', title: 'Desayuno X', recipeId: null }),
          ]),
        ],
      }),
    );

    expect(result.kind).toBe('meals');
    if (result.kind !== 'meals') return;
    expect(result.meals.map((m) => m.plannedMealId)).toEqual(['b', 'l']);
    for (const todayMeal of result.meals) {
      expect(todayMeal.image).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(todayMeal, 'image') && todayMeal.image !== undefined).toBe(false);
    }
  });

  it('does not depend on the system clock', () => {
    const input = adherence({
      days: [
        adherenceDay(TODAY, [
          adherenceMeal({ plannedMealId: 'd', mealType: 'DINNER' }),
          adherenceMeal({ plannedMealId: 'b', mealType: 'BREAKFAST' }),
        ]),
      ],
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T07:00:00-03:00'));
    const morning = selectTodayMeals(input);
    vi.setSystemTime(new Date('2026-10-20T02:30:00Z'));
    const lateNight = selectTodayMeals(input);
    vi.setSystemTime(new Date('2030-01-01T12:00:00Z'));
    const otherDate = selectTodayMeals(input);

    expect(morning.kind).toBe('meals');
    expect(lateNight).toEqual(morning);
    expect(otherDate).toEqual(morning);
  });
});

describe('nextMealToLog', () => {
  it('returns the first NOT_LOGGED meal in fixed order even when unordered', () => {
    const meals = [
      meal({ plannedMealId: 'd', mealType: 'DINNER', status: 'NOT_LOGGED' }),
      meal({ plannedMealId: 's', mealType: 'SNACK', status: 'COMPLETED' }),
      meal({ plannedMealId: 'l', mealType: 'LUNCH', status: 'NOT_LOGGED' }),
      meal({ plannedMealId: 'b', mealType: 'BREAKFAST', status: 'SKIPPED' }),
    ];

    expect(nextMealToLog(meals)?.plannedMealId).toBe('l');
  });

  it('returns null when every meal is completed or skipped', () => {
    const meals = [
      meal({ plannedMealId: 'b', mealType: 'BREAKFAST', status: 'COMPLETED' }),
      meal({ plannedMealId: 'l', mealType: 'LUNCH', status: 'SKIPPED' }),
    ];

    expect(nextMealToLog(meals)).toBeNull();
  });

  it('returns null when statuses are unavailable', () => {
    const meals = [
      meal({ plannedMealId: 'b', mealType: 'BREAKFAST', status: null }),
      meal({ plannedMealId: 'l', mealType: 'LUNCH', status: null }),
    ];

    expect(nextMealToLog(meals)).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(nextMealToLog([])).toBeNull();
  });

  it('returns null when any status is unavailable, even with a NOT_LOGGED meal', () => {
    const meals = [
      meal({ plannedMealId: 'b', mealType: 'BREAKFAST', status: null }),
      meal({ plannedMealId: 'l', mealType: 'LUNCH', status: 'NOT_LOGGED' }),
    ];

    expect(nextMealToLog(meals)).toBeNull();
  });

  it('returns the same meal regardless of the time of day', () => {
    const meals = [
      meal({ plannedMealId: 'd', mealType: 'DINNER', status: 'NOT_LOGGED' }),
      meal({ plannedMealId: 'b', mealType: 'BREAKFAST', status: 'NOT_LOGGED' }),
    ];

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T07:00:00-03:00'));
    const morning = nextMealToLog(meals);
    vi.setSystemTime(new Date('2026-10-19T22:00:00-03:00'));
    const night = nextMealToLog(meals);

    expect(morning?.plannedMealId).toBe('b');
    expect(night?.plannedMealId).toBe('b');
  });
});

describe('meal status labels', () => {
  it('maps every status to its label', () => {
    expect(MEAL_STATUS_LABELS).toEqual({
      NOT_LOGGED: 'Pendiente',
      COMPLETED: 'Registrada',
      SKIPPED: 'Salteada',
    });
  });

  it.each<[MealCompletionStatus, string]>([
    ['NOT_LOGGED', 'Pendiente'],
    ['COMPLETED', 'Registrada'],
    ['SKIPPED', 'Salteada'],
  ])('getMealStatusLabel(%s) is %s', (status, label) => {
    expect(getMealStatusLabel(status)).toBe(label);
  });

  it('returns null for an unavailable status', () => {
    expect(getMealStatusLabel(null)).toBeNull();
  });

  it('returns null for an unknown status string from the backend', () => {
    expect(getMealStatusLabel('PARTIAL' as MealCompletionStatus)).toBeNull();
  });
});

describe('hasUnknownStatus', () => {
  it('is true when any meal has a null status', () => {
    expect(
      hasUnknownStatus([
        meal({ plannedMealId: 'b', mealType: 'BREAKFAST', status: 'COMPLETED' }),
        meal({ plannedMealId: 'l', mealType: 'LUNCH', status: null }),
      ]),
    ).toBe(true);
  });

  it('is false when every status is known', () => {
    expect(
      hasUnknownStatus([
        meal({ plannedMealId: 'b', mealType: 'BREAKFAST', status: 'COMPLETED' }),
        meal({ plannedMealId: 'l', mealType: 'LUNCH', status: 'NOT_LOGGED' }),
        meal({ plannedMealId: 's', mealType: 'SNACK', status: 'SKIPPED' }),
      ]),
    ).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(hasUnknownStatus([])).toBe(false);
  });
});

describe('hasNextMealColumn', () => {
  const ready = (data: TodayMealsData): CardState<TodayMealsData> => ({ kind: 'ready', data });

  it('is true while loading', () => {
    expect(hasNextMealColumn({ kind: 'loading' })).toBe(true);
  });

  it('is true for meals with known statuses (pending or all logged)', () => {
    expect(hasNextMealColumn(ready({ kind: 'meals', meals: [meal({ plannedMealId: 'l', mealType: 'LUNCH' })] }))).toBe(
      true,
    );
    expect(
      hasNextMealColumn(
        ready({ kind: 'meals', meals: [meal({ plannedMealId: 'l', mealType: 'LUNCH', status: 'COMPLETED' })] }),
      ),
    ).toBe(true);
  });

  it('is false for an empty meals array', () => {
    expect(hasNextMealColumn(ready({ kind: 'meals', meals: [] }))).toBe(false);
  });

  it('is false when any status is unknown', () => {
    expect(
      hasNextMealColumn(
        ready({
          kind: 'meals',
          meals: [
            meal({ plannedMealId: 'b', mealType: 'BREAKFAST', status: null }),
            meal({ plannedMealId: 'l', mealType: 'LUNCH', status: 'NOT_LOGGED' }),
          ],
        }),
      ),
    ).toBe(false);
  });

  it.each<[string, CardState<TodayMealsData>]>([
    ['error', { kind: 'error', message: 'fallo' }],
    ['unavailable', { kind: 'unavailable' }],
    ['noPlan', { kind: 'ready', data: { kind: 'noPlan' } }],
    ['noMealsToday', { kind: 'ready', data: { kind: 'noMealsToday' } }],
  ])('is false for %s', (_label, state) => {
    expect(hasNextMealColumn(state)).toBe(false);
  });
});

describe('buildUnavailableViewModel', () => {
  it('marks both cards as unavailable and keeps the user name', () => {
    const unavailable: CardState<null> = { kind: 'unavailable' };

    expect(buildUnavailableViewModel('María José')).toEqual({
      userName: 'María José',
      todayMeals: unavailable,
      adherence: unavailable,
    });
  });

  it('keeps a null user name', () => {
    const viewModel = buildUnavailableViewModel(null);

    expect(viewModel.userName).toBeNull();
    expect(viewModel.todayMeals.kind).toBe('unavailable');
    expect(viewModel.adherence.kind).toBe('unavailable');
  });
});
