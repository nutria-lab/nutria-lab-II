import { effectiveMealStatus } from '../effective-meal-status';

const currentMealUpdatedAt = new Date('2026-10-20T12:30:45.123Z');

describe('effectiveMealStatus', () => {
  it('returns NOT_LOGGED when there is no completion', () => {
    expect(effectiveMealStatus(null, {
      recipeId: 'recipe-one',
      updatedAt: currentMealUpdatedAt,
    })).toBe('NOT_LOGGED');
  });

  it('returns COMPLETED when both snapshots match the current meal', () => {
    expect(effectiveMealStatus({
      status: 'COMPLETED',
      recipeIdSnapshot: 'recipe-one',
      mealUpdatedAtSnapshot: currentMealUpdatedAt,
    }, {
      recipeId: 'recipe-one',
      updatedAt: currentMealUpdatedAt,
    })).toBe('COMPLETED');
  });

  it('returns SKIPPED when both snapshots match the current meal', () => {
    expect(effectiveMealStatus({
      status: 'SKIPPED',
      recipeIdSnapshot: 'recipe-one',
      mealUpdatedAtSnapshot: currentMealUpdatedAt,
    }, {
      recipeId: 'recipe-one',
      updatedAt: currentMealUpdatedAt,
    })).toBe('SKIPPED');
  });

  it('returns NOT_LOGGED when the recipe snapshot differs', () => {
    expect(effectiveMealStatus({
      status: 'COMPLETED',
      recipeIdSnapshot: 'recipe-old',
      mealUpdatedAtSnapshot: currentMealUpdatedAt,
    }, {
      recipeId: 'recipe-one',
      updatedAt: currentMealUpdatedAt,
    })).toBe('NOT_LOGGED');
  });

  it('returns NOT_LOGGED when the meal update timestamp snapshot differs', () => {
    expect(effectiveMealStatus({
      status: 'COMPLETED',
      recipeIdSnapshot: 'recipe-one',
      mealUpdatedAtSnapshot: new Date('2026-10-20T12:30:45.122Z'),
    }, {
      recipeId: 'recipe-one',
      updatedAt: currentMealUpdatedAt,
    })).toBe('NOT_LOGGED');
  });

  it('accepts matching null recipe identifiers', () => {
    expect(effectiveMealStatus({
      status: 'COMPLETED',
      recipeIdSnapshot: null,
      mealUpdatedAtSnapshot: currentMealUpdatedAt,
    }, {
      recipeId: null,
      updatedAt: currentMealUpdatedAt,
    })).toBe('COMPLETED');
  });

  it('compares timestamps by value instead of Date object identity', () => {
    expect(effectiveMealStatus({
      status: 'SKIPPED',
      recipeIdSnapshot: 'recipe-one',
      mealUpdatedAtSnapshot: new Date(currentMealUpdatedAt.getTime()),
    }, {
      recipeId: 'recipe-one',
      updatedAt: new Date(currentMealUpdatedAt.getTime()),
    })).toBe('SKIPPED');
  });
});
