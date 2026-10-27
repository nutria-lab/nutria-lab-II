import type { MealCompletionStatus } from '@/generated/prisma/client';

export type MealCompletionSnapshot = {
  status: MealCompletionStatus;
  recipeIdSnapshot: string | null;
  mealUpdatedAtSnapshot: Date;
};

export type CurrentPlannedMealSnapshot = {
  recipeId: string | null;
  updatedAt: Date;
};

export function mealCompletionSnapshotsMatch(
  completion: Pick<MealCompletionSnapshot, 'recipeIdSnapshot' | 'mealUpdatedAtSnapshot'>,
  meal: CurrentPlannedMealSnapshot,
): boolean {
  return completion.recipeIdSnapshot === meal.recipeId
    && completion.mealUpdatedAtSnapshot.getTime() === meal.updatedAt.getTime();
}

export function effectiveMealStatus(
  completion: MealCompletionSnapshot | null,
  meal: CurrentPlannedMealSnapshot,
): MealCompletionStatus {
  if (!completion || !mealCompletionSnapshotsMatch(completion, meal)) return 'NOT_LOGGED';

  return completion.status;
}
