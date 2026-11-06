import { AdherenceResponse, AdherenceSnapshot, AdherenceMealStatus, AdherenceCounts } from './adherence.types';
import { effectiveMealStatus } from './effective-meal-status';
import { compareMealsByDomainOrder, comparePlanDaysByDate } from '../../utils/meal-plan-order.util';

export function calculateAdherencePercent(completedMeals: number, plannedMeals: number): number | null {
  if (plannedMeals === 0) return null;
  return Math.round(completedMeals * 1000 / plannedMeals) / 10;
}

function emptyCounts(): AdherenceCounts {
  return {
    plannedMeals: 0,
    completedMeals: 0,
    skippedMeals: 0,
    notLoggedMeals: 0,
    adherencePercent: null,
  };
}

function civilDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function transformAdherence(
  weekStart: string,
  snapshot: AdherenceSnapshot,
  today: string,
): AdherenceResponse {
  const completionByMealId = new Map(snapshot.completions.map((completion) => [completion.plannedMealId, completion]));
  const mealsByDayId = new Map<string, AdherenceSnapshot['meals']>();
  for (const meal of snapshot.meals) {
    const dayMeals = mealsByDayId.get(meal.dayId) ?? [];
    dayMeals.push(meal);
    mealsByDayId.set(meal.dayId, dayMeals);
  }

  const days = [...snapshot.days]
    .sort(comparePlanDaysByDate)
    .map((day) => {
      const date = civilDate(day.date);
      const meals = [...(mealsByDayId.get(day.id) ?? [])]
        .sort(compareMealsByDomainOrder)
        .map((meal) => {
          const completion = completionByMealId.get(meal.id);
          let status: AdherenceMealStatus = effectiveMealStatus(completion ?? null, meal);
          if (date > today) status = 'NOT_LOGGED';

          return {
            plannedMealId: meal.id,
            mealUpdatedAt: meal.updatedAt.toISOString(),
            recipeId: meal.recipeId,
            mealType: meal.mealType,
            title: meal.title,
            status,
            canEdit: date <= today,
          };
        });

      const counts = emptyCounts();
      counts.plannedMeals = meals.length;
      for (const meal of meals) {
        if (meal.status === 'COMPLETED') counts.completedMeals += 1;
        else if (meal.status === 'SKIPPED') counts.skippedMeals += 1;
        else counts.notLoggedMeals += 1;
      }
      counts.adherencePercent = calculateAdherencePercent(counts.completedMeals, counts.plannedMeals);

      return { date, ...counts, meals };
    });

  const summary = days.reduce((totals, day) => {
    totals.plannedMeals += day.plannedMeals;
    totals.completedMeals += day.completedMeals;
    totals.skippedMeals += day.skippedMeals;
    totals.notLoggedMeals += day.notLoggedMeals;
    return totals;
  }, { plannedMeals: 0, completedMeals: 0, skippedMeals: 0, notLoggedMeals: 0 });
  const summaryWithPercent = {
    ...summary,
    adherencePercent: calculateAdherencePercent(summary.completedMeals, summary.plannedMeals),
  };

  return {
    weekStart,
    timezone: 'America/Argentina/Buenos_Aires',
    today,
    plan: snapshot.plan ? {
      id: snapshot.plan.id,
      version: snapshot.plan.version,
      updatedAt: snapshot.plan.updatedAt.toISOString(),
    } : null,
    days,
    summary: summaryWithPercent,
  };
}
