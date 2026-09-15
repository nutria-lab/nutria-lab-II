import type { MealPlan } from '../../services/mealPlanService';

// NUT-10: fixture alineado a la forma REAL del backend (ver
// .plans/nut-10-integrar-plan-de-comidas/plan.md sección 3). No se usa desde los tests del
// módulo (usan fixtures inline), se mantiene como ejemplo de referencia de la forma del contrato.
export const mealPlanFixture: MealPlan = {
  id: 'plan-1',
  userId: 'user-1',
  startDate: '2026-08-24T00:00:00.000Z',
  endDate: '2026-08-30T00:00:00.000Z',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
  days: [
    {
      id: 'day-1',
      mealPlanId: 'plan-1',
      day: 'MONDAY',
      date: '2026-08-24',
      meals: [
        {
          id: 'meal-1',
          dayId: 'day-1',
          mealType: 'BREAKFAST',
          title: 'Avena con frutos rojos',
          nutritionalValues: { Protein: 12, Fiber: 5, Calories: 320, Description: 'Rica en fibra' },
          recipeId: 'recipe-1',
          recipe: {
            id: 'recipe-1',
            title: 'Avena con frutos rojos',
            ingredients: [{ name: 'Avena', quantity: 1, unit: 'taza' }],
            instructions: ['Mezclar todo'],
          },
        },
        {
          id: 'meal-2',
          dayId: 'day-1',
          mealType: 'LUNCH',
          title: 'Bowl de quinoa y vegetales',
          nutritionalValues: { Protein: 18, Fiber: 6, Calories: 400, Description: 'Balanceada' },
          recipeId: 'recipe-2',
          recipe: {
            id: 'recipe-2',
            title: 'Bowl de quinoa y vegetales',
            ingredients: [{ name: 'Quinoa', quantity: 1, unit: 'taza' }],
            instructions: ['Cocinar la quinoa'],
          },
        },
      ],
    },
    {
      id: 'day-2',
      mealPlanId: 'plan-1',
      day: 'TUESDAY',
      date: '2026-08-25',
      meals: [],
    },
  ],
};
