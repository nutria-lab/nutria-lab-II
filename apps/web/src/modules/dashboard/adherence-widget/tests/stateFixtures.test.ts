import { describe, expect, it } from 'vitest';

import { adherencePartialProgressFixture } from '@/modules/dashboard/adherence-widget/fixtures';
import {
  EXPECTED_OTHER_PLAN_ID,
  EXPECTED_OTHER_WEEK,
  adherenceInconsistentFixture,
  adherenceNoRecordsFixture,
  createAdherenceWidgetStateProps,
} from '@/modules/dashboard/adherence-widget/stateFixtures';
import { isConsistentAdherence, isStaleAdherence } from '@/modules/dashboard/adherence-widget/utils';

describe('adherenceNoRecordsFixture', () => {
  it('keeps the public contract: every meal NOT_LOGGED and day counters match their meals', () => {
    for (const day of adherenceNoRecordsFixture.days) {
      expect(day.meals.every((meal) => meal.status === 'NOT_LOGGED')).toBe(true);
      expect(day.notLoggedMeals).toBe(day.meals.length);
      expect(day.completedMeals + day.skippedMeals).toBe(0);
    }
    const planned = adherenceNoRecordsFixture.days.reduce((total, day) => total + day.plannedMeals, 0);
    expect(adherenceNoRecordsFixture.summary).toEqual({
      plannedMeals: planned,
      completedMeals: 0,
      skippedMeals: 0,
      notLoggedMeals: planned,
      adherencePercent: 0,
    });
    expect(isConsistentAdherence(adherenceNoRecordsFixture)).toBe(true);
  });

  it('does not mutate the NUT-103 partial fixture', () => {
    expect(adherencePartialProgressFixture.summary.completedMeals).toBe(9);
    expect(adherencePartialProgressFixture.days[0].meals[0].status).toBe('COMPLETED');
  });
});

describe('adherenceInconsistentFixture', () => {
  it('breaks only the counters sum', () => {
    const { summary } = adherenceInconsistentFixture;
    expect(summary.completedMeals + summary.skippedMeals + summary.notLoggedMeals).not.toBe(summary.plannedMeals);
    expect(summary.adherencePercent).toBe(adherencePartialProgressFixture.summary.adherencePercent);
    expect(isConsistentAdherence(adherenceInconsistentFixture)).toBe(false);
  });
});

describe('createAdherenceWidgetStateProps', () => {
  it.each([
    ['staleWeek', { expectedWeekStart: EXPECTED_OTHER_WEEK }],
    ['stalePlan', { expectedPlanId: EXPECTED_OTHER_PLAN_ID }],
  ] as const)('%s carries consistent data that is stale against the expected values', (state, expected) => {
    const props = createAdherenceWidgetStateProps(state);
    expect(props).toMatchObject({ loading: false, error: null, ...expected });
    expect(isConsistentAdherence(props.data!)).toBe(true);
    expect(isStaleAdherence(props.data!, props)).toBe(true);
  });

  it('returns clones so consumers cannot mutate the shared fixtures', () => {
    expect(createAdherenceWidgetStateProps('noRecords').data).not.toBe(adherenceNoRecordsFixture);
    expect(createAdherenceWidgetStateProps('inconsistent').data).not.toBe(adherenceInconsistentFixture);
  });

  it('passes onRetry through by reference', () => {
    const onRetry = () => {};
    expect(createAdherenceWidgetStateProps('stalePlan', onRetry).onRetry).toBe(onRetry);
  });
});
