import type { MealType } from '../generated/prisma/client';

interface MealOrderFields {
  id: string;
  mealType: string;
}

interface PlanDayOrderFields {
  id: string;
  date: Date | string;
}

interface PlanDayWithMeals<TMeal extends MealOrderFields> extends PlanDayOrderFields {
  meals?: TMeal[] | null;
}

const MEAL_TYPE_ORDER = {
  BREAKFAST: 0,
  LUNCH: 1,
  SNACK: 2,
  DINNER: 3,
} satisfies Record<MealType, number>;

function getMealTypeRank(mealType: string): number {
  return Object.prototype.hasOwnProperty.call(MEAL_TYPE_ORDER, mealType)
    ? (MEAL_TYPE_ORDER as Record<string, number>)[mealType]
    : Number.MAX_SAFE_INTEGER;
}

export function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareMealsByDomainOrder<T extends MealOrderFields>(left: T, right: T): number {
  const leftRank = getMealTypeRank(left.mealType);
  const rightRank = getMealTypeRank(right.mealType);

  if (leftRank < rightRank) return -1;
  if (leftRank > rightRank) return 1;

  const leftIsUnknown = !Object.prototype.hasOwnProperty.call(MEAL_TYPE_ORDER, left.mealType);
  const rightIsUnknown = !Object.prototype.hasOwnProperty.call(MEAL_TYPE_ORDER, right.mealType);

  if (leftIsUnknown && rightIsUnknown) {
    const mealTypeComparison = compareIds(left.mealType, right.mealType);
    if (mealTypeComparison !== 0) return mealTypeComparison;
  }

  return compareIds(left.id, right.id);
}

export function comparePlanDaysByDate<T extends PlanDayOrderFields>(left: T, right: T): number {
  const leftDate = left.date instanceof Date ? left.date.toISOString().slice(0, 10) : left.date.slice(0, 10);
  const rightDate = right.date instanceof Date ? right.date.toISOString().slice(0, 10) : right.date.slice(0, 10);
  return leftDate.localeCompare(rightDate) || compareIds(left.id, right.id);
}

export function orderMealPlanDays<TDay extends PlanDayWithMeals<TMeal>, TMeal extends MealOrderFields>(
  days: readonly TDay[],
): Array<TDay & { meals: TMeal[] }> {
  return [...days]
    .sort(comparePlanDaysByDate)
    .map((day) => ({
      ...day,
      meals: [...(day.meals ?? [])].sort(compareMealsByDomainOrder),
    }));
}
