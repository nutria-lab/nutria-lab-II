import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MealCard } from './MealCard';

// NUT-10: fixture inline con la forma REAL de `PlannedMeal`/`Recipe` (ver
// .plans/nut-10-integrar-plan-de-comidas/plan.md sección 3):
//
// PlannedMeal: { id, dayId, mealType, title, nutritionalValues, recipeId, recipe }
// Recipe: { id, title, description, prepMinutes, cookMinutes, ingredients, instructions }
//
// No existe `servings` en ningún nivel del contrato real (confirmado contra los modelos
// Prisma en el plan.md, hallazgo 1). `MealCard` hoy solo lee `meal.mealType` y `meal.recipe`,
// así que los campos adicionales del contrato real (`id`, `dayId`, `title`,
// `nutritionalValues`, `recipeId`) no cambian su comportamiento; se construye vía helper
// (no como literal anotado con el tipo `Meal` de `mealPlanService.ts`) para no acoplar este
// test a un tipo de producción todavía desalineado con el contrato real.

function buildMeal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'meal-1',
    dayId: 'day-1',
    mealType: 'BREAKFAST',
    title: 'Avena con frutos rojos',
    nutritionalValues: { Protein: 12, Fiber: 5, Calories: 320, Description: 'Rica en fibra' },
    recipeId: 'recipe-1',
    recipe: {
      id: 'recipe-1',
      title: 'Avena con frutos rojos',
      description: 'Desayuno rápido',
      prepMinutes: 5,
      cookMinutes: 0,
      ingredients: [{ name: 'Avena', quantity: 1, unit: 'taza' }],
      instructions: ['Mezclar todo'],
    },
    ...overrides,
  };
}

describe('MealCard', () => {
  it('shows ingredients and instructions when expanded', async () => {
    const user = userEvent.setup();
    render(<MealCard meal={buildMeal() as never} />);

    await user.click(screen.getByRole('button', { name: /Avena con frutos rojos/ }));

    expect(screen.getByText('1 taza Avena')).toBeInTheDocument();
    expect(screen.getByText('Mezclar todo')).toBeInTheDocument();
  });

  it('explains missing ingredients and instructions instead of hiding them', async () => {
    const incompleteMeal = buildMeal({
      recipe: {
        id: 'recipe-1',
        title: 'Avena con frutos rojos',
        description: 'Desayuno rápido',
        prepMinutes: 5,
        cookMinutes: 0,
        ingredients: [],
        instructions: [],
      },
    });
    const user = userEvent.setup();
    render(<MealCard meal={incompleteMeal as never} />);

    await user.click(screen.getByRole('button', { name: /Avena con frutos rojos/ }));

    expect(screen.getByText('Ingredientes no disponibles todavía.')).toBeInTheDocument();
    expect(screen.getByText('Instrucciones no disponibles todavía.')).toBeInTheDocument();
  });

  it('shows a fallback state when the meal has no associated recipe (recipe: null)', () => {
    // Decisión 6 del design.md / hallazgo 1 del plan.md: `recipe: null` (con `recipeId: null`)
    // es un valor legítimo del contrato real de `PlannedMeal` (comida sin receta asociada),
    // no una violación de contrato que haya que forzar con un cast "por las dudas".
    const mealWithoutRecipe = buildMeal({ recipeId: null, recipe: null });

    render(<MealCard meal={mealWithoutRecipe as never} />);

    expect(screen.getByText('Receta no disponible')).toBeInTheDocument();
  });
});
