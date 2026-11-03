import { describe, expect, it, vi } from 'vitest';

import {
  DASHBOARD_FIXTURES,
  DASHBOARD_FIXTURE_SENTINEL,
  adherenceResponseFixture,
  selectDashboardFixture,
  type DashboardFixtureKey,
} from '@/modules/dashboard/fixtures';
import { createAdherenceWidgetProps } from '@/modules/dashboard/adherence-widget/fixtures';
import { createAdherenceWidgetStateProps } from '@/modules/dashboard/adherence-widget/stateFixtures';
import { isConsistentAdherence } from '@/modules/dashboard/adherence-widget/utils';
import type { DashboardViewModel, TodayMeal } from '@/modules/dashboard/types';
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
  'progreso-sin-registros',
  'progreso-sin-comidas',
  'progreso-actualizando',
  'progreso-error-actualizacion',
  'progreso-desactualizado',
  'progreso-inconsistente',
];

const READY_ADHERENCE_KEYS: DashboardFixtureKey[] = ['sin-plan', 'sin-comidas', 'comidas', 'todo-registrado', 'sin-nombre'];

// Datos de muestra de los frames de Stitch que nunca deben llegar a los fixtures.
const STITCH_SAMPLE_DATA = /Elena|Russo|Martina|Quinoa|Mediterranean|Hamburguesa|kcal/i;

// Los retry se inyectan al seleccionar el fixture (§16), así que los estados se leen desde ahí.
function selectValid(key: DashboardFixtureKey, userName: string | null, onRetry: () => void = vi.fn()): DashboardViewModel {
  const viewModel = selectDashboardFixture(key, userName, onRetry);
  if (viewModel === null) throw new Error(`selectDashboardFixture returned null for ${key}`);
  return viewModel;
}

function mealsOf(key: DashboardFixtureKey): TodayMeal[] {
  const state = selectValid(key, 'María José').todayMeals;
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
      const state = selectValid(key, 'María José').todayMeals;
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

  it('loading: today meals loading and adherence loading without data nor error', () => {
    const { todayMeals, adherence } = selectValid('loading', 'María José');

    expect(todayMeals.kind).toBe('loading');
    expect(adherence).toMatchObject({ data: null, loading: true, error: null });
  });

  it('sin-plan: today meals ready with noPlan', () => {
    expect(selectValid('sin-plan', 'María José').todayMeals).toEqual({ kind: 'ready', data: { kind: 'noPlan' } });
  });

  it('sin-comidas: today meals ready with noMealsToday', () => {
    expect(selectValid('sin-comidas', 'María José').todayMeals).toEqual({
      kind: 'ready',
      data: { kind: 'noMealsToday' },
    });
  });

  it.each(READY_ADHERENCE_KEYS)('%s: adherence has data, is not loading and has no error', (key) => {
    const { adherence } = selectValid(key, 'María José');

    expect(adherence.data).not.toBeNull();
    expect(adherence.loading).toBe(false);
    expect(adherence.error).toBeNull();
    expect(adherence.onRetry).toEqual(expect.any(Function));
  });

  it('comidas: unordered mixed meals with every status and a meal without recipe', () => {
    const meals = mealsOf('comidas');
    const statuses = meals.map((meal) => meal.status);

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
  });

  it('error: both cards in error and both retries are the injected onRetry (§16)', () => {
    const onRetry = vi.fn();
    const { todayMeals, adherence } = selectValid('error', 'María José', onRetry);

    expect(todayMeals).toEqual({ kind: 'error', retry: onRetry });
    expect(todayMeals.kind === 'error' && todayMeals.retry).toBe(onRetry);
    expect(adherence.data).toBeNull();
    expect(adherence.loading).toBe(false);
    expect(adherence.error?.length).toBeGreaterThan(0);
    expect(adherence.onRetry).toBe(onRetry);
  });

  it('error-parcial: meals listed with null status while adherence errors with the injected onRetry', () => {
    const onRetry = vi.fn();
    const { adherence } = selectValid('error-parcial', 'María José', onRetry);

    const meals = mealsOf('error-parcial');
    expect(meals.length).toBeGreaterThan(0);
    for (const meal of meals) {
      expect(meal.status).toBeNull();
    }
    expect(adherence.data).toBeNull();
    expect(adherence.loading).toBe(false);
    expect(adherence.error?.length).toBeGreaterThan(0);
    expect(adherence.onRetry).toBe(onRetry);
  });

  it('no-disponible: today meals unavailable and adherence empty', () => {
    const { todayMeals, adherence } = selectValid('no-disponible', 'María José');

    expect(todayMeals.kind).toBe('unavailable');
    expect(adherence).toMatchObject({ data: null, loading: false, error: null });
  });

  it('sin-nombre: same meals state as comidas', () => {
    expect(selectValid('sin-nombre', 'María José').todayMeals).toEqual(selectValid('comidas', 'María José').todayMeals);
  });

  it('contain no percentages nor Stitch sample names or dishes', () => {
    const models = FIXTURE_KEYS.map((key) => selectValid(key, 'María José'));
    const serializedMeals = JSON.stringify(models.map((model) => model.todayMeals));
    const serialized = JSON.stringify(models);

    expect(serialized).not.toContain('%');
    expect(serializedMeals).not.toMatch(/percent/i);
    expect(serialized).not.toMatch(STITCH_SAMPLE_DATA);
  });
});

describe('adherenceResponseFixture', () => {
  it('maps to today meals through selectTodayMeals', () => {
    const result = selectTodayMeals(adherenceResponseFixture);

    expect(result.kind).toBe('meals');
    expect(result.kind === 'meals' && result.meals.length).toBeGreaterThan(0);
  });

  it('keeps contract A percents (completed / planned × 100) and carries no Stitch sample data', () => {
    for (const day of adherenceResponseFixture.days) {
      expect(day.adherencePercent).toBe(Math.round((day.completedMeals / day.plannedMeals) * 1000) / 10);
    }
    expect(isConsistentAdherence(adherenceResponseFixture)).toBe(true);
    const serialized = JSON.stringify(adherenceResponseFixture);
    expect(serialized).not.toContain('%');
    expect(serialized).not.toMatch(STITCH_SAMPLE_DATA);
  });
});

describe('progress dev fixtures (NUT-94)', () => {
  it.each<[DashboardFixtureKey, ReturnType<typeof createAdherenceWidgetProps>]>([
    ['sin-plan', createAdherenceWidgetProps('noPlan')],
    ['comidas', createAdherenceWidgetProps('partial')],
    ['progreso-sin-registros', createAdherenceWidgetStateProps('noRecords')],
    ['progreso-sin-comidas', createAdherenceWidgetProps('planWithoutMeals')],
    ['progreso-actualizando', createAdherenceWidgetProps('refreshing')],
    ['progreso-error-actualizacion', createAdherenceWidgetProps('staleWithError')],
    ['progreso-desactualizado', createAdherenceWidgetStateProps('stalePlan')],
    ['progreso-inconsistente', createAdherenceWidgetStateProps('inconsistent')],
  ])('%s uses the matching widget fixture with the injected onRetry', (key, expected) => {
    const onRetry = vi.fn();
    const { adherence } = selectValid(key, 'María José', onRetry);

    expect({ ...adherence, onRetry: undefined }).toEqual({ ...expected, onRetry: undefined });
    expect(adherence.onRetry).toBe(onRetry);
  });

  it.each<DashboardFixtureKey>([
    'progreso-sin-registros',
    'progreso-sin-comidas',
    'progreso-actualizando',
    'progreso-error-actualizacion',
    'progreso-desactualizado',
    'progreso-inconsistente',
  ])('%s keeps the mixed meals card so only the progress changes', (key) => {
    expect(selectValid(key, 'María José').todayMeals).toEqual(selectValid('comidas', 'María José').todayMeals);
  });
});

describe('selectDashboardFixture', () => {
  it.each(FIXTURE_KEYS.filter((key) => key !== 'sin-nombre'))(
    'returns the %s fixture with the session userName',
    (key) => {
      const onRetry = vi.fn();
      const viewModel = selectValid(key, 'María José', onRetry);
      const other = selectValid(key, 'Otra Persona', onRetry);

      expect(viewModel.userName).toBe('María José');
      expect(viewModel.todayMeals).toEqual(other.todayMeals);
      expect(viewModel.adherence).toEqual(other.adherence);
    },
  );

  it('forces userName to null for sin-nombre', () => {
    const viewModel = selectValid('sin-nombre', 'María José');

    expect(viewModel.userName).toBeNull();
    expect(viewModel.todayMeals).toEqual(selectValid('comidas', 'María José').todayMeals);
  });

  it.each([
    ['unknown', 'no-existe'],
    ['empty', ''],
    ['missing', null],
    ['inherited object property', 'toString'],
  ])('returns null (no fallback to comidas) for a %s key', (_label, key) => {
    expect(selectDashboardFixture(key, 'María José', vi.fn())).toBeNull();
  });

  it('keeps a null session userName', () => {
    expect(selectValid('comidas', null).userName).toBeNull();
  });
});
