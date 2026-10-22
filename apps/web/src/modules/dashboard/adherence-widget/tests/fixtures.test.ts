import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { AdherenceWidgetProps } from '@/modules/dashboard/adherence-widget/types';
import {
  ADHERENCE_WIDGET_ERROR_MESSAGE,
  adherenceNoPlanFixture,
  adherencePartialProgressFixture,
  adherencePlanWithoutMealsFixture,
  createAdherenceWidgetProps,
} from '@/modules/dashboard/adherence-widget/fixtures';
import type { AdherenceWidgetFixtureState } from '@/modules/dashboard/adherence-widget/fixtures';
import type {
  AdherenceDay,
  AdherenceMeal,
  AdherenceResponse,
  MealCompletionStatus,
} from '@/modules/dashboard/types';

const WEEK_START = '2026-10-19';
const TODAY = '2026-10-21';
const TIMEZONE = 'America/Argentina/Buenos_Aires';

const allFixtures: ReadonlyArray<[string, AdherenceResponse]> = [
  ['noPlan', adherenceNoPlanFixture],
  ['planWithoutMeals', adherencePlanWithoutMealsFixture],
  ['partial', adherencePartialProgressFixture],
];

const ALL_STATES: ReadonlyArray<AdherenceWidgetFixtureState> = [
  'noPlan',
  'planWithoutMeals',
  'partial',
  'loading',
  'error',
  'refreshing',
  'staleWithError',
  'unavailable',
  'retrying',
];

const fixturesWithPlan: ReadonlyArray<[string, AdherenceResponse]> = [
  ['planWithoutMeals', adherencePlanWithoutMealsFixture],
  ['partial', adherencePartialProgressFixture],
];

function parseIsoDate(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid YYYY-MM-DD date: ${value}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function utcWeekday(value: string): number {
  return new Date(parseIsoDate(value)).getUTCDay();
}

function addDays(value: string, days: number): string {
  const date = new Date(parseIsoDate(value) + days * 24 * 60 * 60 * 1000);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function expectedPercent(completed: number, planned: number): number | null {
  if (planned === 0) return null;
  return Math.round((completed / planned) * 1000) / 10;
}

function countStatus(meals: AdherenceMeal[], status: MealCompletionStatus): number {
  return meals.filter((meal) => meal.status === status).length;
}

function allMeals(fixture: AdherenceResponse): AdherenceMeal[] {
  return fixture.days.flatMap((day: AdherenceDay) => day.meals);
}

describe('AdherenceWidget types', () => {
  it('AdherenceWidgetProps has exactly data, loading, error and onRetry', () => {
    expectTypeOf<AdherenceWidgetProps>().toEqualTypeOf<{
      data: AdherenceResponse | null;
      loading: boolean;
      error: string | null;
      onRetry: () => void;
    }>();
  });

  it('every fixture is typed as AdherenceResponse', () => {
    expectTypeOf(adherenceNoPlanFixture).toEqualTypeOf<AdherenceResponse>();
    expectTypeOf(adherencePlanWithoutMealsFixture).toEqualTypeOf<AdherenceResponse>();
    expectTypeOf(adherencePartialProgressFixture).toEqualTypeOf<AdherenceResponse>();
  });

  it('createAdherenceWidgetProps returns AdherenceWidgetProps', () => {
    expectTypeOf(createAdherenceWidgetProps).returns.toEqualTypeOf<AdherenceWidgetProps>();
  });

  it('AdherenceWidgetFixtureState includes refreshing, staleWithError, unavailable and retrying', () => {
    expectTypeOf<'refreshing'>().toMatchTypeOf<AdherenceWidgetFixtureState>();
    expectTypeOf<'staleWithError'>().toMatchTypeOf<AdherenceWidgetFixtureState>();
    expectTypeOf<'unavailable'>().toMatchTypeOf<AdherenceWidgetFixtureState>();
    expectTypeOf<'retrying'>().toMatchTypeOf<AdherenceWidgetFixtureState>();
    expectTypeOf<AdherenceWidgetFixtureState>().toEqualTypeOf<
      | 'noPlan'
      | 'planWithoutMeals'
      | 'partial'
      | 'loading'
      | 'error'
      | 'refreshing'
      | 'staleWithError'
      | 'unavailable'
      | 'retrying'
    >();
  });
});

describe('Adherence fixtures: week', () => {
  it.each(allFixtures)('%s uses the fixed Monday week, timezone and today', (_name, fixture) => {
    expect(fixture.weekStart).toBe(WEEK_START);
    expect(utcWeekday(fixture.weekStart)).toBe(1);
    expect(fixture.timezone).toBe(TIMEZONE);
    expect(fixture.today).toBe(TODAY);
    const todayTime = parseIsoDate(fixture.today);
    expect(todayTime).toBeGreaterThanOrEqual(parseIsoDate(fixture.weekStart));
    expect(todayTime).toBeLessThanOrEqual(parseIsoDate(addDays(fixture.weekStart, 6)));
  });

  it.each(fixturesWithPlan)('%s has 7 consecutive days Monday to Sunday from weekStart', (_name, fixture) => {
    expect(fixture.days).toHaveLength(7);
    const expectedDates = Array.from({ length: 7 }, (_, index) => addDays(fixture.weekStart, index));
    expect(fixture.days.map((day) => day.date)).toEqual(expectedDates);
    expect(utcWeekday(fixture.days[0].date)).toBe(1);
    expect(utcWeekday(fixture.days[6].date)).toBe(0);
  });
});

describe('Adherence fixtures: per-day consistency', () => {
  it.each(allFixtures)('%s days have counters consistent with their meals', (_name, fixture) => {
    for (const day of fixture.days) {
      expect(day.plannedMeals).toBe(day.meals.length);
      expect(day.completedMeals).toBe(countStatus(day.meals, 'COMPLETED'));
      expect(day.skippedMeals).toBe(countStatus(day.meals, 'SKIPPED'));
      expect(day.notLoggedMeals).toBe(countStatus(day.meals, 'NOT_LOGGED'));
      expect(day.completedMeals + day.skippedMeals + day.notLoggedMeals).toBe(day.plannedMeals);
      expect(day.adherencePercent).toBe(expectedPercent(day.completedMeals, day.plannedMeals));
    }
  });
});

describe('Adherence fixtures: summary', () => {
  it.each(allFixtures)('%s summary is the sum of its days', (_name, fixture) => {
    const sum = (pick: (day: AdherenceDay) => number) =>
      fixture.days.reduce((total, day) => total + pick(day), 0);
    expect(fixture.summary.plannedMeals).toBe(sum((day) => day.plannedMeals));
    expect(fixture.summary.completedMeals).toBe(sum((day) => day.completedMeals));
    expect(fixture.summary.skippedMeals).toBe(sum((day) => day.skippedMeals));
    expect(fixture.summary.notLoggedMeals).toBe(sum((day) => day.notLoggedMeals));
    expect(fixture.summary.adherencePercent).toBe(
      expectedPercent(fixture.summary.completedMeals, fixture.summary.plannedMeals),
    );
  });
});

describe('Adherence fixtures: acceptance cases', () => {
  it('no plan: null plan, no days, zero counters and null percent', () => {
    expect(adherenceNoPlanFixture.plan).toBeNull();
    expect(adherenceNoPlanFixture.days).toEqual([]);
    expect(adherenceNoPlanFixture.summary).toEqual({
      plannedMeals: 0,
      completedMeals: 0,
      skippedMeals: 0,
      notLoggedMeals: 0,
      adherencePercent: null,
    });
  });

  it('plan without meals: plan present, 7 empty days and null percents', () => {
    expect(adherencePlanWithoutMealsFixture.plan).not.toBeNull();
    expect(adherencePlanWithoutMealsFixture.days).toHaveLength(7);
    for (const day of adherencePlanWithoutMealsFixture.days) {
      expect(day.meals).toEqual([]);
      expect(day.adherencePercent).toBeNull();
    }
    expect(adherencePlanWithoutMealsFixture.summary).toEqual({
      plannedMeals: 0,
      completedMeals: 0,
      skippedMeals: 0,
      notLoggedMeals: 0,
      adherencePercent: null,
    });
  });

  describe('partial progress', () => {
    const fixture = adherencePartialProgressFixture;

    it('has a plan and mixes the three statuses on past days and today', () => {
      expect(fixture.plan).not.toBeNull();
      const todayTime = parseIsoDate(fixture.today);
      const statuses = new Set(
        fixture.days
          .filter((day) => parseIsoDate(day.date) <= todayTime)
          .flatMap((day) => day.meals)
          .map((meal) => meal.status),
      );
      expect(statuses).toContain('COMPLETED');
      expect(statuses).toContain('SKIPPED');
      expect(statuses).toContain('NOT_LOGGED');
    });

    it('summary percent is strictly between 0 and 100', () => {
      const percent = fixture.summary.adherencePercent;
      expect(percent).not.toBeNull();
      expect(percent).toBeGreaterThan(0);
      expect(percent).toBeLessThan(100);
    });

    it('future meals are not editable and NOT_LOGGED; today and past are editable', () => {
      const todayTime = parseIsoDate(fixture.today);
      for (const day of fixture.days) {
        const isFuture = parseIsoDate(day.date) > todayTime;
        for (const meal of day.meals) {
          if (isFuture) {
            expect(meal.canEdit).toBe(false);
            expect(meal.status).toBe('NOT_LOGGED');
          } else {
            expect(meal.canEdit).toBe(true);
          }
        }
      }
    });

    it('has meals on future days so the future rule is exercised', () => {
      const todayTime = parseIsoDate(fixture.today);
      const futureMeals = fixture.days
        .filter((day) => parseIsoDate(day.date) > todayTime)
        .flatMap((day) => day.meals);
      expect(futureMeals.length).toBeGreaterThan(0);
    });

    it('uses unique plannedMealIds', () => {
      const ids = allMeals(fixture).map((meal) => meal.plannedMealId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('uses generic titles without personal data', () => {
      for (const meal of allMeals(fixture)) {
        expect(meal.title.startsWith('Comida de ejemplo')).toBe(true);
      }
    });
  });
});

describe('createAdherenceWidgetProps', () => {
  it('loading state has no data and no error', () => {
    const props = createAdherenceWidgetProps('loading');
    expect(props).toMatchObject({ data: null, loading: true, error: null });
  });

  it('error state has null data (never zero progress) and an error message', () => {
    const props = createAdherenceWidgetProps('error');
    expect(props).toMatchObject({
      data: null,
      loading: false,
      error: ADHERENCE_WIDGET_ERROR_MESSAGE,
    });
    expect(props.data).toBeNull();
  });

  it('exports the shared error message', () => {
    expect(ADHERENCE_WIDGET_ERROR_MESSAGE).toBe('fixture: adherence request failed');
  });

  it('error state uses the shared error message constant', () => {
    expect(createAdherenceWidgetProps('error').error).toBe(ADHERENCE_WIDGET_ERROR_MESSAGE);
  });

  describe.each([
    ['noPlan', adherenceNoPlanFixture],
    ['planWithoutMeals', adherencePlanWithoutMealsFixture],
    ['partial', adherencePartialProgressFixture],
  ] as const)('%s state data is a clone of its fixture', (state, fixture) => {
    it('is deep-equal to the fixture but not the same reference', () => {
      const props = createAdherenceWidgetProps(state);
      expect(props.data).toEqual(fixture);
      expect(props.data).not.toBe(fixture);
    });

    it('returns a different data reference on each call', () => {
      expect(createAdherenceWidgetProps(state).data).not.toBe(createAdherenceWidgetProps(state).data);
    });
  });

  it('mutating partial props data leaves the exported fixture unchanged', () => {
    const snapshot = structuredClone(adherencePartialProgressFixture);
    const props = createAdherenceWidgetProps('partial');
    props.data!.days[0].meals[0].status = 'SKIPPED';
    props.data!.days[0].completedMeals = 0;
    props.data!.summary.adherencePercent = 0;
    expect(adherencePartialProgressFixture.days[0].meals[0].status).toBe('COMPLETED');
    expect(adherencePartialProgressFixture).toEqual(snapshot);
  });

  it.each([
    ['noPlan', adherenceNoPlanFixture],
    ['planWithoutMeals', adherencePlanWithoutMealsFixture],
    ['partial', adherencePartialProgressFixture],
  ] as const)('%s state returns its fixture as data', (state, fixture) => {
    const props = createAdherenceWidgetProps(state);
    expect(props.data).toEqual(fixture);
    expect(props.loading).toBe(false);
    expect(props.error).toBeNull();
  });

  it('passes the given onRetry through by reference', () => {
    const onRetry = vi.fn();
    const props = createAdherenceWidgetProps('error', onRetry);
    expect(props.onRetry).toBe(onRetry);
    props.onRetry();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('provides a callable default onRetry', () => {
    const props = createAdherenceWidgetProps('error');
    expect(typeof props.onRetry).toBe('function');
    expect(() => props.onRetry()).not.toThrow();
  });

  it('is deterministic for the same arguments', () => {
    const onRetry = vi.fn();
    for (const state of ALL_STATES) {
      expect(createAdherenceWidgetProps(state, onRetry)).toEqual(
        createAdherenceWidgetProps(state, onRetry),
      );
    }
  });

  it.each(ALL_STATES)('%s state passes onRetry by reference and has a callable default', (state) => {
    const onRetry = vi.fn();
    const props = createAdherenceWidgetProps(state, onRetry);
    expect(props.onRetry).toBe(onRetry);
    props.onRetry();
    expect(onRetry).toHaveBeenCalledTimes(1);

    const defaults = createAdherenceWidgetProps(state);
    expect(typeof defaults.onRetry).toBe('function');
    expect(() => defaults.onRetry()).not.toThrow();
  });

  describe('refreshing state (data + loading)', () => {
    it('keeps the partial data as a clone while loading, without error', () => {
      const props = createAdherenceWidgetProps('refreshing');
      expect(props.data).toEqual(adherencePartialProgressFixture);
      expect(props.data).not.toBe(adherencePartialProgressFixture);
      expect(props.loading).toBe(true);
      expect(props.error).toBeNull();
    });
  });

  describe('staleWithError state (data + error)', () => {
    it('keeps the partial data as a clone with the shared error message, not loading', () => {
      const props = createAdherenceWidgetProps('staleWithError');
      expect(props.data).toEqual(adherencePartialProgressFixture);
      expect(props.data).not.toBe(adherencePartialProgressFixture);
      expect(props.loading).toBe(false);
      expect(props.error).toBe(ADHERENCE_WIDGET_ERROR_MESSAGE);
    });
  });

  describe.each(['refreshing', 'staleWithError'] as const)('%s state data isolation', (state) => {
    it('returns a different data reference on each call', () => {
      expect(createAdherenceWidgetProps(state).data).not.toBe(createAdherenceWidgetProps(state).data);
    });

    it('mutating the returned data leaves the exported fixture unchanged', () => {
      const snapshot = structuredClone(adherencePartialProgressFixture);
      const props = createAdherenceWidgetProps(state);
      expect(props.data).not.toBeNull();
      props.data!.days[0].meals[0].status = 'SKIPPED';
      props.data!.days[0].completedMeals = 0;
      props.data!.summary.adherencePercent = 0;
      expect(adherencePartialProgressFixture.days[0].meals[0].status).toBe('COMPLETED');
      expect(adherencePartialProgressFixture).toEqual(snapshot);
    });
  });

  describe('retrying state (loading + error)', () => {
    it('has no data, is loading and keeps the shared error message', () => {
      const onRetry = vi.fn();
      const props = createAdherenceWidgetProps('retrying', onRetry);
      expect(props).toEqual({
        data: null,
        loading: true,
        error: ADHERENCE_WIDGET_ERROR_MESSAGE,
        onRetry,
      });
      expect(props.onRetry).toBe(onRetry);
    });

    it('loading + error → loading wins: loading and error are set at the same time, without data', () => {
      const retrying = createAdherenceWidgetProps('retrying');
      expect(retrying.data).toBeNull();
      expect(retrying.loading).toBe(true);
      expect(retrying.error).not.toBeNull();
      expect(retrying.error).toBe(ADHERENCE_WIDGET_ERROR_MESSAGE);
    });

    it('is distinct from loading (error: null) and from error (loading: false)', () => {
      const onRetry = vi.fn();
      const retrying = createAdherenceWidgetProps('retrying', onRetry);
      const loading = createAdherenceWidgetProps('loading', onRetry);
      const error = createAdherenceWidgetProps('error', onRetry);
      expect(loading.error).toBeNull();
      expect(error.loading).toBe(false);
      expect(retrying.error).not.toBe(loading.error);
      expect(retrying.loading).not.toBe(error.loading);
      expect(retrying).not.toEqual(loading);
      expect(retrying).not.toEqual(error);
    });

    it('provides a callable default onRetry', () => {
      const props = createAdherenceWidgetProps('retrying');
      expect(typeof props.onRetry).toBe('function');
      expect(() => props.onRetry()).not.toThrow();
    });

    it('is deterministic for the same arguments', () => {
      const onRetry = vi.fn();
      expect(createAdherenceWidgetProps('retrying', onRetry)).toEqual(
        createAdherenceWidgetProps('retrying', onRetry),
      );
    });
  });

  describe('unavailable state', () => {
    it('has no data, is not loading and has no error', () => {
      const props = createAdherenceWidgetProps('unavailable');
      expect(props).toMatchObject({ data: null, loading: false, error: null });
    });

    it('is NOT a loading state', () => {
      expect(createAdherenceWidgetProps('unavailable').loading).toBe(false);
    });

    it('is distinguishable from loading and error', () => {
      const unavailable = createAdherenceWidgetProps('unavailable');
      const loading = createAdherenceWidgetProps('loading');
      const error = createAdherenceWidgetProps('error');
      expect(unavailable.data).toBeNull();
      expect(unavailable.loading).not.toBe(loading.loading);
      expect(unavailable.error).not.toBe(error.error);
      expect(unavailable).not.toEqual(loading);
      expect(unavailable).not.toEqual(error);
    });

    it('mutating returned props never changes any exported fixture', () => {
      const snapshots = allFixtures.map(([, fixture]) => structuredClone(fixture));
      const props = createAdherenceWidgetProps('unavailable');
      props.data = structuredClone(adherencePartialProgressFixture);
      props.data.summary.adherencePercent = 0;
      allFixtures.forEach(([, fixture], index) => {
        expect(fixture).toEqual(snapshots[index]);
      });
    });
  });
});
