import { describe, expect, it } from 'vitest';

import {
  adherenceNoPlanFixture,
  adherencePartialProgressFixture,
  adherencePlanWithoutMealsFixture,
} from '@/modules/dashboard/adherence-widget/fixtures';
import {
  formatAdherencePercent,
  hasNoRecords,
  isConsistentAdherence,
  isStaleAdherence,
} from '@/modules/dashboard/adherence-widget/utils';
import type { AdherenceResponse } from '@/modules/dashboard/types';

function withSummary(overrides: Partial<AdherenceResponse['summary']>): AdherenceResponse {
  const data = structuredClone(adherencePartialProgressFixture);
  data.summary = { ...data.summary, ...overrides };
  return data;
}

describe('formatAdherencePercent', () => {
  it.each([
    [32.1, '32,1 %'],
    [0, '0 %'],
    [100, '100 %'],
    [50, '50 %'],
  ])('formats %s as %s with the es-AR decimal comma and no added decimals', (value, expected) => {
    expect(formatAdherencePercent(value)).toBe(expected);
  });
});

describe('hasNoRecords', () => {
  it('is true when meals are planned but none is completed or skipped', () => {
    expect(hasNoRecords(withSummary({ completedMeals: 0, skippedMeals: 0, notLoggedMeals: 28 }).summary)).toBe(true);
  });

  it.each([
    ['a completed meal', { completedMeals: 1, skippedMeals: 0, notLoggedMeals: 27 }],
    ['a skipped meal', { completedMeals: 0, skippedMeals: 1, notLoggedMeals: 27 }],
  ])('is false with %s', (_label, overrides) => {
    expect(hasNoRecords(withSummary(overrides).summary)).toBe(false);
  });

  it('is false without planned meals (that is the "no data" state)', () => {
    expect(hasNoRecords(adherencePlanWithoutMealsFixture.summary)).toBe(false);
  });
});

describe('isStaleAdherence', () => {
  const data = adherencePartialProgressFixture;

  it('is false when nothing is expected', () => {
    expect(isStaleAdherence(data, {})).toBe(false);
  });

  it('is false when week and plan match', () => {
    expect(isStaleAdherence(data, { expectedWeekStart: data.weekStart, expectedPlanId: data.plan!.id })).toBe(false);
  });

  it('is true when only the week differs', () => {
    expect(isStaleAdherence(data, { expectedWeekStart: '2026-10-26', expectedPlanId: data.plan!.id })).toBe(true);
  });

  it('is true when only the plan differs (concurrent regeneration)', () => {
    expect(isStaleAdherence(data, { expectedWeekStart: data.weekStart, expectedPlanId: 'another-plan' })).toBe(true);
  });

  it('expecting no plan (null) is stale against a response with a plan, and vice versa', () => {
    expect(isStaleAdherence(data, { expectedPlanId: null })).toBe(true);
    expect(isStaleAdherence(adherenceNoPlanFixture, { expectedPlanId: 'fixture-plan-partial' })).toBe(true);
    expect(isStaleAdherence(adherenceNoPlanFixture, { expectedPlanId: null })).toBe(false);
  });
});

describe('isConsistentAdherence', () => {
  it.each<[string, AdherenceResponse]>([
    ['partial progress', adherencePartialProgressFixture],
    ['plan without meals (null percent)', adherencePlanWithoutMealsFixture],
    ['no plan', adherenceNoPlanFixture],
    ['0 and 100 bounds', withSummary({ completedMeals: 28, skippedMeals: 0, notLoggedMeals: 0, adherencePercent: 100 })],
  ])('accepts %s', (_label, data) => {
    expect(isConsistentAdherence(data)).toBe(true);
  });

  // Cada caso rompe una sola regla para que ninguna otra lo enmascare.
  it.each<[string, AdherenceResponse]>([
    ['percent null with planned meals', withSummary({ adherencePercent: null })],
    ['percent above 100', withSummary({ adherencePercent: 100.1 })],
    ['negative percent', withSummary({ adherencePercent: -1 })],
    ['NaN percent', withSummary({ adherencePercent: Number.NaN })],
    ['counters that do not add up', withSummary({ notLoggedMeals: 17 })],
    ['negative counter', withSummary({ completedMeals: -1, notLoggedMeals: 28 })],
    ['fractional counters', withSummary({ completedMeals: 9.5, notLoggedMeals: 17.5 })],
  ])('rejects %s', (_label, data) => {
    expect(isConsistentAdherence(data)).toBe(false);
  });

  it('rejects a percent when there are no planned meals', () => {
    const data = structuredClone(adherencePlanWithoutMealsFixture);
    data.summary.adherencePercent = 0;
    expect(isConsistentAdherence(data)).toBe(false);
  });

  it('rejects planned meals without a plan', () => {
    const data = structuredClone(adherenceNoPlanFixture);
    data.summary = { plannedMeals: 1, completedMeals: 0, skippedMeals: 0, notLoggedMeals: 1, adherencePercent: 0 };
    expect(isConsistentAdherence(data)).toBe(false);
  });
});
