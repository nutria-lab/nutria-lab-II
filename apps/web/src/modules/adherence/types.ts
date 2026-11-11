/** Public adherence contract A. Server values remain the source of truth. */
export type MealCompletionStatus = 'NOT_LOGGED' | 'COMPLETED' | 'SKIPPED';

export type AdherenceResponse = {
  weekStart: string;
  timezone: 'America/Argentina/Buenos_Aires';
  today: string;
  plan: { id: string; version: number; updatedAt: string } | null;
  days: Array<{
    date: string;
    plannedMeals: number;
    completedMeals: number;
    skippedMeals: number;
    notLoggedMeals: number;
    adherencePercent: number | null;
    meals: Array<{
      plannedMealId: string;
      mealUpdatedAt: string;
      recipeId: string | null;
      mealType: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';
      title: string;
      status: MealCompletionStatus;
      canEdit: boolean;
    }>;
  }>;
  summary: {
    plannedMeals: number;
    completedMeals: number;
    skippedMeals: number;
    notLoggedMeals: number;
    adherencePercent: number | null;
  };
};

export type AdherenceMeal = AdherenceResponse['days'][number]['meals'][number];
export type AdherenceDay = AdherenceResponse['days'][number];

export type UpdateMealCompletionRequest = {
  planId: string;
  mealUpdatedAt: string;
  status: MealCompletionStatus;
};

export type UpdateMealCompletionResponse = {
  plannedMealId: string;
  status: MealCompletionStatus;
  updatedAt: string;
};
