import type { MealPlan } from '../../services/mealPlanService';

export const mealPlanFixture: MealPlan = {
  id: 'plan-1',
  weekStart: '2026-08-24',
  days: [
    {
      date: '2026-08-24',
      meals: [
        {
          mealType: 'BREAKFAST',
          servings: 1,
          recipe: {
            title: 'Avena con frutos rojos',
            ingredients: [{ name: 'Avena', quantity: 1, unit: 'taza' }],
            instructions: ['Mezclar todo'],
          },
        },
        {
          mealType: 'LUNCH',
          servings: 2,
          recipe: {
            title: 'Bowl de quinoa y vegetales',
            ingredients: [{ name: 'Quinoa', quantity: 1, unit: 'taza' }],
            instructions: ['Cocinar la quinoa'],
          },
        },
      ],
    },
    {
      date: '2026-08-25',
      meals: [],
    },
  ],
};
