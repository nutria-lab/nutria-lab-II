import { describe, expect, it } from 'vitest';

import {
  DASHBOARD_FIXTURES,
  DASHBOARD_FIXTURE_SENTINEL,
  adherenceResponseFixture,
  selectDashboardFixture,
  type DashboardFixtureKey,
} from '@/modules/dashboard/fixtures';
import type { TodayMeal } from '@/modules/dashboard/types';
import { sortMealsByType, selectTodayMeals } from '@/modules/dashboard/utils';

const FIXTURE_KEYS: DashboardFixtureKey[] = [
  'loading',
  'sin-plan',
  'sin-comidas',
  'comidas',
  'todo-registrado',
  'error',
  'error-parcial',
  'no-disponible',
  'sin-nombre',
];

// Datos de muestra de los frames de Stitch que nunca deben llegar a los fixtures.
const STITCH_SAMPLE_DATA = /Elena|Russo|Martina|Quinoa|Mediterranean|Hamburguesa|kcal/i;

function mealsOf(key: DashboardFixtureKey): TodayMeal[] {
  const state = DASHBOARD_FIXTURES[key].todayMeals;
  if (state.kind !== 'ready' || state.data.kind !== 'meals') {
    throw new Error(`El fixture ${key} no tiene comidas`);
  }
  return state.data.meals;
}

describe('DASHBOARD_FIXTURE_SENTINEL', () => {
  it('is the agreed sentinel string', () => {
    expect(DASHBOARD_FIXTURE_SENTINEL).toBe('nut95-dashboard-fixture-sentinel');
  });

  it('is embedded in every plannedMealId of the view model fixtures', () => {
    const ids = FIXTURE_KEYS.flatMap((key) => {
      const state = DASHBOARD_FIXTURES[key].todayMeals;
      return state.kind === 'ready' && state.data.kind === 'meals'
        ? state.data.meals.map((meal) => meal.plannedMealId)
        : [];
    });

    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).toContain(DASHBOARD_FIXTURE_SENTINEL);
    }
  });

  it('is embedded in every plannedMealId of the adherence response fixture', () => {
    const ids = adherenceResponseFixture.days.flatMap((day) => day.meals.map((meal) => meal.plannedMealId));

    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).toContain(DASHBOARD_FIXTURE_SENTINEL);
    }
  });
});

describe('DASHBOARD_FIXTURES', () => {
  it('defines exactly one fixture per ?estado key', () => {
    expect(Object.keys(DASHBOARD_FIXTURES).sort()).toEqual([...FIXTURE_KEYS].sort());
  });

  it('loading: both cards are loading', () => {
    expect(DASHBOARD_FIXTURES.loading.todayMeals.kind).toBe('loading');
    expect(DASHBOARD_FIXTURES.loading.adherence.kind).toBe('loading');
  });

  it('sin-plan: today meals ready with noPlan, progress slot ready', () => {
    const { todayMeals, adherence } = DASHBOARD_FIXTURES['sin-plan'];
    expect(todayMeals).toEqual({ kind: 'ready', data: { kind: 'noPlan' } });
    expect(adherence.kind).toBe('ready');
  });

  it('sin-comidas: today meals ready with noMealsToday, progress slot ready', () => {
    const { todayMeals, adherence } = DASHBOARD_FIXTURES['sin-comidas'];
    expect(todayMeals).toEqual({ kind: 'ready', data: { kind: 'noMealsToday' } });
    expect(adherence.kind).toBe('ready');
  });

  it('comidas: unordered mixed meals with every status and a meal without recipe', () => {
    const meals = mealsOf('comidas');
    const statuses = meals.map((meal) => meal.status);

    expect(DASHBOARD_FIXTURES.comidas.adherence.kind).toBe('ready');
    expect(statuses).toEqual(expect.arrayContaining(['NOT_LOGGED', 'COMPLETED', 'SKIPPED']));
    expect(meals.some((meal) => meal.status === 'NOT_LOGGED' && meal.recipeId !== null)).toBe(true);
    expect(meals.some((meal) => meal.recipeId === null)).toBe(true);
    expect(meals.map((meal) => meal.plannedMealId)).not.toEqual(
      sortMealsByType(meals).map((meal) => meal.plannedMealId),
    );
  });

  it('comidas: uses generic recipe titles', () => {
    for (const meal of mealsOf('comidas')) {
      expect(meal.title).toMatch(/^Receta de ejemplo/);
    }
  });

  it('todo-registrado: every meal is COMPLETED or SKIPPED', () => {
    const meals = mealsOf('todo-registrado');

    expect(meals.length).toBeGreaterThan(0);
    for (const meal of meals) {
      expect(['COMPLETED', 'SKIPPED']).toContain(meal.status);
    }
    expect(DASHBOARD_FIXTURES['todo-registrado'].adherence.kind).toBe('ready');
  });

  it('error: both cards in error without retry', () => {
    const { todayMeals, adherence } = DASHBOARD_FIXTURES.error;

    expect(todayMeals.kind).toBe('error');
    expect(adherence.kind).toBe('error');
    expect(todayMeals.kind === 'error' && todayMeals.retry).toBeFalsy();
    expect(adherence.kind === 'error' && adherence.retry).toBeFalsy();
  });

  it('error-parcial: meals listed with null status while the progress slot errors', () => {
    const meals = mealsOf('error-parcial');

    expect(meals.length).toBeGreaterThan(0);
    for (const meal of meals) {
      expect(meal.status).toBeNull();
    }
    const { adherence } = DASHBOARD_FIXTURES['error-parcial'];
    expect(adherence.kind).toBe('error');
    expect(adherence.kind === 'error' && adherence.message.length).toBeGreaterThan(0);
  });

  it('no-disponible: both cards unavailable', () => {
    expect(DASHBOARD_FIXTURES['no-disponible'].todayMeals.kind).toBe('unavailable');
    expect(DASHBOARD_FIXTURES['no-disponible'].adherence.kind).toBe('unavailable');
  });

  it('sin-nombre: same meals state as comidas', () => {
    expect(DASHBOARD_FIXTURES['sin-nombre'].todayMeals).toEqual(DASHBOARD_FIXTURES.comidas.todayMeals);
    expect(DASHBOARD_FIXTURES['sin-nombre'].adherence.kind).toBe('ready');
  });

  it('contain no percentages nor Stitch sample names or dishes', () => {
    const serialized = JSON.stringify(DASHBOARD_FIXTURES);

    expect(serialized).not.toContain('%');
    expect(serialized).not.toMatch(/percent/i);
    expect(serialized).not.toMatch(STITCH_SAMPLE_DATA);
  });
});

describe('adherenceResponseFixture', () => {
  it('maps to today meals through selectTodayMeals', () => {
    const result = selectTodayMeals(adherenceResponseFixture);

    expect(result.kind).toBe('meals');
    expect(result.kind === 'meals' && result.meals.length).toBeGreaterThan(0);
  });

  it('carries no percentage values nor Stitch sample data', () => {
    expect(adherenceResponseFixture.summary.adherencePercent).toBeNull();
    for (const day of adherenceResponseFixture.days) {
      expect(day.adherencePercent).toBeNull();
    }
    const serialized = JSON.stringify(adherenceResponseFixture);
    expect(serialized).not.toContain('%');
    expect(serialized).not.toMatch(STITCH_SAMPLE_DATA);
  });
});

function selectValid(key: DashboardFixtureKey, userName: string | null) {
  const viewModel = selectDashboardFixture(key, userName);
  if (viewModel === null) throw new Error(`selectDashboardFixture returned null for ${key}`);
  return viewModel;
}

describe('selectDashboardFixture', () => {
  it.each(FIXTURE_KEYS.filter((key) => key !== 'sin-nombre'))(
    'returns the %s fixture with the session userName',
    (key) => {
      const viewModel = selectValid(key, 'María José');

      expect(viewModel.userName).toBe('María José');
      expect(viewModel.todayMeals).toEqual(DASHBOARD_FIXTURES[key].todayMeals);
      expect(viewModel.adherence).toEqual(DASHBOARD_FIXTURES[key].adherence);
    },
  );

  it('forces userName to null for sin-nombre', () => {
    const viewModel = selectValid('sin-nombre', 'María José');

    expect(viewModel.userName).toBeNull();
    expect(viewModel.todayMeals).toEqual(DASHBOARD_FIXTURES.comidas.todayMeals);
  });

  it.each([
    ['unknown', 'no-existe'],
    ['empty', ''],
    ['missing', null],
    ['inherited object property', 'toString'],
  ])('returns null (no fallback to comidas) for a %s key', (_label, key) => {
    expect(selectDashboardFixture(key, 'María José')).toBeNull();
  });

  it('keeps a null session userName', () => {
    expect(selectValid('comidas', null).userName).toBeNull();
  });
});
