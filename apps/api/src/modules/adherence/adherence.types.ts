import { MealCompletion, MealPlan, MealPlanDay, PlannedMeal } from '@/generated/prisma/client';

export type AdherenceSnapshot = {
  plan: Pick<MealPlan, 'id' | 'version' | 'updatedAt'> | null;
  days: Array<Pick<MealPlanDay, 'id' | 'date'>>;
  meals: Array<Pick<PlannedMeal, 'id' | 'dayId' | 'mealType' | 'title' | 'recipeId' | 'updatedAt'>>;
  completions: Array<Pick<MealCompletion, 'userId' | 'plannedMealId' | 'status' | 'recipeIdSnapshot' | 'mealUpdatedAtSnapshot'>>;
};

export type AdherenceMealStatus = 'NOT_LOGGED' | 'COMPLETED' | 'SKIPPED';

export type AdherenceCounts = {
  plannedMeals: number;
  completedMeals: number;
  skippedMeals: number;
  notLoggedMeals: number;
  adherencePercent: number | null;
};

export type AdherenceMeal = {
  plannedMealId: string;
  mealUpdatedAt: string;
  recipeId: string | null;
  mealType: 'BREAKFAST' | 'LUNCH' | 'SNACK' | 'DINNER';
  title: string;
  status: AdherenceMealStatus;
  canEdit: boolean;
};

export type AdherenceDay = AdherenceCounts & {
  date: string;
  meals: AdherenceMeal[];
};

export type AdherenceResponse = {
  weekStart: string;
  timezone: 'America/Argentina/Buenos_Aires';
  today: string;
  plan: { id: string; version: number; updatedAt: string } | null;
  days: AdherenceDay[];
  summary: AdherenceCounts;
};
