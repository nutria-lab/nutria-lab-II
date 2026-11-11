import { AxiosError, AxiosHeaders, CanceledError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdherenceResponse } from '@/modules/adherence/types';
import { apiClient } from '@/services/apiClient';
import { dashboardAdherenceService, isAdherenceResponse } from '../dashboardAdherenceService';

vi.mock('@/services/apiClient', () => ({
  apiClient: { get: vi.fn() },
}));

const WEEK = '2026-10-19';

function validResponse(): AdherenceResponse {
  return {
    weekStart: WEEK,
    timezone: 'America/Argentina/Buenos_Aires',
    today: '2026-10-21',
    plan: { id: 'plan-1', version: 2, updatedAt: '2026-10-19T09:00:00.000Z' },
    days: [
      {
        date: '2026-10-21',
        plannedMeals: 2,
        completedMeals: 1,
        skippedMeals: 0,
        notLoggedMeals: 1,
        adherencePercent: 50,
        meals: [
          {
            plannedMealId: 'pm-1',
            mealUpdatedAt: '2026-10-19T09:00:00.000Z',
            recipeId: 'r-1',
            mealType: 'BREAKFAST',
            title: 'Avena',
            status: 'COMPLETED',
            canEdit: true,
          },
          {
            plannedMealId: 'pm-2',
            mealUpdatedAt: '2026-10-19T09:00:00.000Z',
            recipeId: null,
            mealType: 'LUNCH',
            title: 'Ensalada',
            status: 'NOT_LOGGED',
            canEdit: true,
          },
        ],
      },
    ],
    summary: { plannedMeals: 2, completedMeals: 1, skippedMeals: 0, notLoggedMeals: 1, adherencePercent: 50 },
  };
}

function httpError(status: number) {
  return new AxiosError('fail', String(status), undefined, undefined, {
    status,
    statusText: '',
    data: {},
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

const get = vi.mocked(apiClient.get);

beforeEach(() => {
  get.mockReset();
});

describe('dashboardAdherenceService.getForWeek', () => {
  it('requests GET /adherence with the week and the abort signal, and returns the contract unchanged', async () => {
    const body = validResponse();
    get.mockResolvedValue({ data: body });
    const controller = new AbortController();

    const result = await dashboardAdherenceService.getForWeek(WEEK, controller.signal);

    expect(get).toHaveBeenCalledWith(
      '/adherence',
      expect.objectContaining({ params: { weekStart: WEEK }, signal: controller.signal }),
    );
    expect(result).toEqual(body);
  });

  it('never sends a userId: the server derives it from the session', async () => {
    get.mockResolvedValue({ data: validResponse() });

    await dashboardAdherenceService.getForWeek(WEEK, new AbortController().signal);

    const [, config] = get.mock.calls[0];
    expect(JSON.stringify(config?.params)).not.toMatch(/user/i);
  });

  it('rejects a response for another week', async () => {
    get.mockResolvedValue({ data: { ...validResponse(), weekStart: '2026-10-26' } });

    await expect(dashboardAdherenceService.getForWeek(WEEK, new AbortController().signal)).rejects.toThrow();
  });

  it('rejects a malformed response', async () => {
    get.mockResolvedValue({ data: { weekStart: WEEK } });

    await expect(dashboardAdherenceService.getForWeek(WEEK, new AbortController().signal)).rejects.toThrow();
  });

  it.each([401, 404, 500])('propagates HTTP %s as the original axios error', async (status) => {
    const error = httpError(status);
    get.mockRejectedValue(error);

    await expect(dashboardAdherenceService.getForWeek(WEEK, new AbortController().signal)).rejects.toBe(error);
  });

  it('propagates a cancellation unchanged so callers can ignore it', async () => {
    const canceled = new CanceledError();
    get.mockRejectedValue(canceled);

    await expect(dashboardAdherenceService.getForWeek(WEEK, new AbortController().signal)).rejects.toBe(canceled);
  });
});

describe('isAdherenceResponse', () => {
  it('accepts the contract A shape, including plan: null with no days', () => {
    expect(isAdherenceResponse(validResponse())).toBe(true);
    expect(
      isAdherenceResponse({
        ...validResponse(),
        plan: null,
        days: [],
        summary: { plannedMeals: 0, completedMeals: 0, skippedMeals: 0, notLoggedMeals: 0, adherencePercent: null },
      }),
    ).toBe(true);
  });

  it('rejects a timezone other than America/Argentina/Buenos_Aires', () => {
    expect(isAdherenceResponse({ ...validResponse(), timezone: 'UTC' })).toBe(false);
  });

  it('rejects a single unknown mealType (the other meal is valid)', () => {
    const response = validResponse();
    const meals = response.days[0].meals;
    const withUnknown = { ...response, days: [{ ...response.days[0], meals: [meals[0], { ...meals[1], mealType: 'BRUNCH' }] }] };

    expect(isAdherenceResponse(withUnknown)).toBe(false);
  });

  it('keeps a response whose only unknown value is a meal status (the UI shows it as unknown)', () => {
    const response = validResponse();
    const meal = { ...response.days[0].meals[1], status: 'PARTIAL' };
    const withUnknownStatus = { ...response, days: [{ ...response.days[0], meals: [meal] }] };

    expect(isAdherenceResponse(withUnknownStatus)).toBe(true);
  });

  it.each([
    ['plan without id', (r: AdherenceResponse) => ({ ...r, plan: { version: 1, updatedAt: 'x' } })],
    ['summary percent as string', (r: AdherenceResponse) => ({ ...r, summary: { ...r.summary, adherencePercent: '50' } })],
    ['days not an array', (r: AdherenceResponse) => ({ ...r, days: null })],
    ['meal without canEdit', (r: AdherenceResponse) => {
      const { canEdit: _canEdit, ...meal } = r.days[0].meals[0];
      return { ...r, days: [{ ...r.days[0], meals: [meal] }] };
    }],
    ['missing today', (r: AdherenceResponse) => ({ ...r, today: undefined })],
    ['today before the week', (r: AdherenceResponse) => ({ ...r, today: '2026-10-18' })],
    ['today after the week', (r: AdherenceResponse) => ({ ...r, today: '2026-10-26' })],
    ['weekStart that is not a calendar date', (r: AdherenceResponse) => ({ ...r, weekStart: 'semana-1' })],
  ])('rejects %s', (_label, mutate) => {
    expect(isAdherenceResponse(mutate(validResponse()))).toBe(false);
  });
});
