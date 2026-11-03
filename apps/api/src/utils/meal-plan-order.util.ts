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

const MEAL_TYPE_ORDER: Record<string, number> = {
  BREAKFAST: 0,
  LUNCH: 1,
  SNACK: 2,
  DINNER: 3,
};

export function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareMealsByDomainOrder<T extends MealOrderFields>(left: T, right: T): number {
  return (MEAL_TYPE_ORDER[left.mealType] - MEAL_TYPE_ORDER[right.mealType]) || compareIds(left.id, right.id);
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
