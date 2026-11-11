import type { AdherenceResponse } from '../types';

export const adherenceFixture: AdherenceResponse = {
  weekStart: '2026-10-19',
  timezone: 'America/Argentina/Buenos_Aires',
  today: '2026-10-22',
  plan: { id: 'e87646ae-65fe-4ffb-b241-424fd7889ab7', version: 1, updatedAt: '2026-10-19T12:00:00Z' },
  days: [
    {
      date: '2026-10-22', plannedMeals: 3, completedMeals: 1, skippedMeals: 1, notLoggedMeals: 1, adherencePercent: 33.3,
      meals: [
        { plannedMealId: '30e0066a-a1a4-4829-9157-914e71f2d3f1', mealUpdatedAt: '2026-10-19T12:00:00Z', recipeId: null, mealType: 'BREAKFAST', title: 'Tostadas con palta y huevo', status: 'NOT_LOGGED', canEdit: true },
        { plannedMealId: '30e0066a-a1a4-4829-9157-914e71f2d3f2', mealUpdatedAt: '2026-10-19T12:00:00Z', recipeId: 'cb085392-68b2-47ca-acb8-902f70320420', mealType: 'LUNCH', title: 'Ensalada de lentejas', status: 'COMPLETED', canEdit: true },
        { plannedMealId: '30e0066a-a1a4-4829-9157-914e71f2d3f3', mealUpdatedAt: '2026-10-19T12:00:00Z', recipeId: null, mealType: 'DINNER', title: 'Sopa de verduras', status: 'SKIPPED', canEdit: true },
      ],
    },
    {
      date: '2026-10-23', plannedMeals: 1, completedMeals: 0, skippedMeals: 0, notLoggedMeals: 1, adherencePercent: 0,
      meals: [{ plannedMealId: '30e0066a-a1a4-4829-9157-914e71f2d3f4', mealUpdatedAt: '2026-10-19T12:00:00Z', recipeId: null, mealType: 'SNACK', title: 'Yogur con frutas', status: 'NOT_LOGGED', canEdit: false }],
    },
  ],
  summary: { plannedMeals: 4, completedMeals: 1, skippedMeals: 1, notLoggedMeals: 2, adherencePercent: 25 },
};

export const noPlanAdherenceFixture: AdherenceResponse = {
  weekStart: '2026-10-19', timezone: 'America/Argentina/Buenos_Aires', today: '2026-10-22',
  plan: null, days: [],
  summary: { plannedMeals: 0, completedMeals: 0, skippedMeals: 0, notLoggedMeals: 0, adherencePercent: null },
};

export const emptyPlanAdherenceFixture: AdherenceResponse = {
  ...noPlanAdherenceFixture,
  plan: adherenceFixture.plan ? { ...adherenceFixture.plan } : null,
  summary: { ...noPlanAdherenceFixture.summary },
};

export const pastWeekAdherenceFixture: AdherenceResponse = {
  weekStart: '2026-10-12', timezone: 'America/Argentina/Buenos_Aires', today: '2026-10-22',
  plan: adherenceFixture.plan ? { ...adherenceFixture.plan } : null,
  days: [{
    date: '2026-10-15', plannedMeals: 1, completedMeals: 0, skippedMeals: 0, notLoggedMeals: 1, adherencePercent: 0,
    meals: [{ plannedMealId: '30e0066a-a1a4-4829-9157-914e71f2d3f5', mealUpdatedAt: '2026-10-12T12:00:00Z', recipeId: null, mealType: 'LUNCH', title: 'Arroz con vegetales', status: 'NOT_LOGGED', canEdit: true }],
  }],
  summary: { plannedMeals: 1, completedMeals: 0, skippedMeals: 0, notLoggedMeals: 1, adherencePercent: 0 },
};
