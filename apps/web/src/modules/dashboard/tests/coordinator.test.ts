import { describe, expect, it, vi } from 'vitest';

import type { MealPlan, MealType } from '@/services/mealPlanService';
import {
  buildDashboardViewModel,
  createLoadingResources,
  hasPlanConflict,
  isUsableMealPlan,
  type DashboardResources,
} from '../coordinator';
import type { AdherenceResponse, ShoppingProgress } from '../types';

const WEEK = '2026-10-19';
const TODAY = '2026-10-21';

function plan(mealTypes: string[], id = 'plan-1'): MealPlan {
  return {
    id,
    userId: 'u1',
    startDate: WEEK,
    endDate: '2026-10-25',
    createdAt: '',
    updatedAt: '',
    days: [
      {
        id: 'd',
        mealPlanId: id,
        day: 'WEDNESDAY',
        date: TODAY,
        meals: mealTypes.map((mealType, index) => ({
          id: `pm-${index}`,
          dayId: 'd',
          mealType: mealType as MealType,
          title: `Comida ${index}`,
          nutritionalValues: { Protein: 0, Fiber: 0, Calories: 0, Description: '' },
          recipeId: null,
          recipe: null,
        })),
      },
    ],
  };
}

function resources(patch: Partial<DashboardResources>): DashboardResources {
  return { ...createLoadingResources(WEEK, TODAY), ...patch };
}

const SHOPPING: ShoppingProgress = {
  weekStart: WEEK,
  plan: { id: 'plan-1', version: 1, updatedAt: '' },
  summary: { totalItems: 4, checkedItems: 1 },
};

const NO_PLAN_ADHERENCE: AdherenceResponse = {
  weekStart: WEEK,
  timezone: 'America/Argentina/Buenos_Aires',
  today: TODAY,
  plan: null,
  days: [],
  summary: { plannedMeals: 0, completedMeals: 0, skippedMeals: 0, notLoggedMeals: 0, adherencePercent: null },
};

describe('hasPlanConflict', () => {
  it('ignores resources without data and treats "no plan" as a value', () => {
    expect(hasPlanConflict({})).toBe(false);
    expect(hasPlanConflict({ mealPlan: plan([]), shopping: SHOPPING })).toBe(false);
    expect(hasPlanConflict({ mealPlan: null, shopping: SHOPPING })).toBe(true);
    expect(hasPlanConflict({ mealPlan: null, adherence: NO_PLAN_ADHERENCE })).toBe(false);
  });
});

describe('isUsableMealPlan', () => {
  it('accepts a plan of the requested week, with ISO or calendar startDate', () => {
    expect(isUsableMealPlan(plan(['LUNCH']), WEEK)).toBe(true);
    expect(isUsableMealPlan({ ...plan(['LUNCH']), startDate: `${WEEK}T00:00:00.000Z` }, WEEK)).toBe(true);
  });

  it('rejects a plan of another week', () => {
    expect(isUsableMealPlan({ ...plan(['LUNCH']), startDate: '2026-10-12' }, WEEK)).toBe(false);
  });

  it.each([
    ['a null meal', null],
    ['a meal without title', { id: 'x', mealType: 'LUNCH', recipeId: null, recipe: null }],
    ['a meal with a numeric id', { id: 1, mealType: 'LUNCH', title: 't', recipeId: null, recipe: null }],
  ])('rejects %s next to a valid meal', (_label, meal) => {
    const valid = plan(['LUNCH']);
    const broken = { ...valid, days: [{ ...valid.days[0], meals: [valid.days[0].meals[0], meal] }] } as unknown as MealPlan;

    expect(isUsableMealPlan(broken, WEEK)).toBe(false);
  });
});

describe('buildDashboardViewModel — today meals (design §2.1)', () => {
  const retry = vi.fn();

  it('plan loaded and adherence still loading → loading, never the partial list', () => {
    const model = buildDashboardViewModel(
      resources({ mealPlan: { status: 'success', data: plan(['LUNCH']) } }),
      null,
      retry,
    );

    expect(model.todayMeals).toEqual({ kind: 'loading' });
  });

  it('partial list from the plan with one unknown mealType (the other is valid) → error with retry', () => {
    const model = buildDashboardViewModel(
      resources({ mealPlan: { status: 'success', data: plan(['LUNCH', 'BRUNCH']) }, adherence: { status: 'error' } }),
      null,
      retry,
    );

    expect(model.todayMeals).toEqual({ kind: 'error', retry });
  });

  it('partial list from the plan with no meals today → noMealsToday', () => {
    const model = buildDashboardViewModel(
      resources({ mealPlan: { status: 'success', data: plan([]) }, adherence: { status: 'error' } }),
      null,
      retry,
    );

    expect(model.todayMeals).toEqual({ kind: 'ready', data: { kind: 'noMealsToday' } });
  });

  it('a 401 on adherence with the plan loaded → partial list without status', () => {
    const model = buildDashboardViewModel(
      resources({ mealPlan: { status: 'success', data: plan(['LUNCH']) }, adherence: { status: 'unauthorized' } }),
      null,
      retry,
    );

    expect(model.todayMeals.kind === 'ready' && model.todayMeals.data).toMatchObject({
      kind: 'meals',
      meals: [{ status: null }],
    });
  });
});

describe('buildDashboardViewModel — shopping (design §2.3)', () => {
  const retry = vi.fn();

  it('a failed refresh hides the retained counter and shows the error', () => {
    const model = buildDashboardViewModel(resources({ shopping: { status: 'error', data: SHOPPING } }), null, retry);

    expect(model.shopping).toEqual({ kind: 'error', retry });
  });

  it('a refresh in flight keeps the retained counter', () => {
    const model = buildDashboardViewModel(resources({ shopping: { status: 'loading', data: SHOPPING } }), null, retry);

    expect(model.shopping).toEqual({ kind: 'ready', data: SHOPPING });
  });
});

describe('buildDashboardViewModel — conflict', () => {
  it('every data card errors with the same retry and the widget gets no data', () => {
    const retry = vi.fn();
    const model = buildDashboardViewModel(
      resources({
        conflict: true,
        mealPlan: { status: 'error' },
        adherence: { status: 'error' },
        shopping: { status: 'error' },
      }),
      'Ana',
      retry,
    );

    expect(model.todayMeals).toEqual({ kind: 'error', retry });
    expect(model.shopping).toEqual({ kind: 'error', retry });
    expect(model.adherence).toMatchObject({ data: null, loading: false, onRetry: retry });
    expect(model.adherence.error).not.toBeNull();
    expect(model.userName).toBe('Ana');
  });
});
