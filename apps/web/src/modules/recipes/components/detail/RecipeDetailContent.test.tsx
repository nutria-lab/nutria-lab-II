import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DesktopIngredientsAndSteps, RecipeDetailSections } from './RecipeDetailContent';
import type { Recipe } from '../../../../services/recipeService';

// NUT-74: el backend guarda los ingredientes sin cantidad ("al gusto") como { quantity: null, unit: 'al gusto' }.
const recipe: Recipe = {
  id: 'recipe-1',
  title: 'Ensalada de quinoa',
  description: 'Quinoa con vegetales',
  categories: [],
  prepMinutes: 10,
  cookMinutes: 15,
  ingredients: [
    { name: 'Quinoa', quantity: 150, unit: 'g' },
    { name: 'Sal', quantity: null, unit: 'al gusto' },
  ],
  instructions: ['Cocinar la quinoa'],
  nutritionalValues: null,
  properties: [],
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
};

describe.each([
  ['mobile', RecipeDetailSections],
  ['desktop', DesktopIngredientsAndSteps],
])('Detalle de receta (%s) - ingredientes sin cantidad', (_label, Component) => {
  it('muestra sólo la unidad, nunca "null"', () => {
    render(<Component recipe={recipe} />);

    expect(screen.getByText('al gusto')).toBeInTheDocument();
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
  });

  it('con cantidad sigue mostrando "cantidad unidad"', () => {
    render(<Component recipe={recipe} />);

    expect(screen.getByText('150 g')).toBeInTheDocument();
  });
});
