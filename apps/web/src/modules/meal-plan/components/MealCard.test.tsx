import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MealCard } from './MealCard';
import type { Meal } from '../../../services/mealPlanService';

const baseMeal: Meal = {
  mealType: 'BREAKFAST',
  servings: 1,
  recipe: {
    title: 'Avena con frutos rojos',
    ingredients: [{ name: 'Avena', quantity: 1, unit: 'taza' }],
    instructions: ['Mezclar todo'],
  },
};

describe('MealCard', () => {
  it('shows ingredients and instructions when expanded', async () => {
    const user = userEvent.setup();
    render(<MealCard meal={baseMeal} />);

    await user.click(screen.getByRole('button', { name: /Avena con frutos rojos/ }));

    expect(screen.getByText('1 taza Avena')).toBeInTheDocument();
    expect(screen.getByText('Mezclar todo')).toBeInTheDocument();
  });

  it('explains missing ingredients and instructions instead of hiding them', async () => {
    const incompleteMeal: Meal = {
      ...baseMeal,
      recipe: { ...baseMeal.recipe, ingredients: [], instructions: [] },
    };
    const user = userEvent.setup();
    render(<MealCard meal={incompleteMeal} />);

    await user.click(screen.getByRole('button', { name: /Avena con frutos rojos/ }));

    expect(screen.getByText('Ingredientes no disponibles todavía.')).toBeInTheDocument();
    expect(screen.getByText('Instrucciones no disponibles todavía.')).toBeInTheDocument();
  });

  it('shows a fallback state when the recipe is unavailable', () => {
    // La API podría no cumplir el contrato en runtime; se fuerza el caso a propósito.
    const unavailableMeal = { ...baseMeal, recipe: null } as unknown as Meal;

    render(<MealCard meal={unavailableMeal} />);

    expect(screen.getByText('Receta no disponible')).toBeInTheDocument();
  });
});
