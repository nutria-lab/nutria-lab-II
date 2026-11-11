import { AdherenceService } from '../adherence.service';

const userId = '00000000-0000-4000-8000-000000000092';
const planId = '00000000-0000-4000-8000-000000000093';
const plannedMealId = '00000000-0000-4000-8000-000000000001';
const mealUpdatedAt = new Date('2026-10-22T08:00:00.000Z');

describe('AdherenceService.getForWeek Buenos Aires clock boundary', () => {
  it('reads the clock once per request and flips a persisted day from future to editable at Buenos Aires midnight', async () => {
    const snapshot = {
      plan: { id: planId, version: 1, updatedAt: new Date('2026-10-19T10:00:00.000Z') },
      days: [{ id: 'day-one', date: new Date('2026-10-22T00:00:00.000Z') }],
      meals: [{
        id: plannedMealId,
        dayId: 'day-one',
        mealType: 'BREAKFAST',
        title: 'Avena',
        recipeId: null,
        updatedAt: mealUpdatedAt,
      }],
      completions: [],
    };
    const repository = { getCurrentSnapshot: jest.fn().mockResolvedValue(snapshot) };
    const clock = jest.fn()
      .mockReturnValueOnce(new Date('2026-10-22T02:59:59.999Z'))
      .mockReturnValueOnce(new Date('2026-10-22T03:00:00.000Z'));
    const service = new AdherenceService(repository as any, clock);

    const beforeMidnight = await service.getForWeek(userId, '2026-10-19');
    const atMidnight = await service.getForWeek(userId, '2026-10-19');

    expect(clock).toHaveBeenCalledTimes(2);
    expect(repository.getCurrentSnapshot).toHaveBeenNthCalledWith(1, userId, '2026-10-19');
    expect(repository.getCurrentSnapshot).toHaveBeenNthCalledWith(2, userId, '2026-10-19');
    expect(beforeMidnight.today).toBe('2026-10-21');
    expect(atMidnight.today).toBe('2026-10-22');
    expect(beforeMidnight.days[0].date).toBe('2026-10-22');
    expect(atMidnight.days[0].date).toBe('2026-10-22');
    expect(beforeMidnight.days[0].meals[0]).toMatchObject({ status: 'NOT_LOGGED', canEdit: false });
    expect(atMidnight.days[0].meals[0]).toMatchObject({ status: 'NOT_LOGGED', canEdit: true });
  });
});
