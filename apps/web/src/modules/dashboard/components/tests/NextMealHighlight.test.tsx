import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { NextMealHighlight } from '@/modules/dashboard/components/NextMealHighlight';
import type { CardState, TodayMeal, TodayMealsData } from '@/modules/dashboard/types';
import type { RecipeImage } from '@/services/recipeService';

afterEach(cleanup);

const NEXT_MEAL_TITLE = 'Siguiente comida por registrar';

const IMAGE: RecipeImage = {
  provider: 'UNSPLASH',
  imageUrl: 'https://images.example.test/quinoa.jpg',
  alt: 'Ensalada de quinoa en un bol',
  photographer: 'Fotógrafa de prueba',
  photographerUrl: 'https://example.test/fotografa',
  sourceUrl: 'https://example.test/foto',
};

function readyMeals(meals: TodayMeal[]): CardState<TodayMealsData> {
  return { kind: 'ready', data: { kind: 'meals', meals } };
}

function renderHighlight(state: CardState<TodayMealsData>) {
  render(
    <MemoryRouter>
      <NextMealHighlight state={state} />
    </MemoryRouter>,
  );
  return screen.getByRole('region', { name: NEXT_MEAL_TITLE });
}

function expectNoImage(highlight: HTMLElement) {
  expect(within(highlight).queryByRole('img')).not.toBeInTheDocument();
  expect(highlight.querySelector('img')).toBeNull();
  expect(within(highlight).queryByLabelText(/Imagen no disponible/)).not.toBeInTheDocument();
}

describe('NextMealHighlight image from the next meal data (§15)', () => {
  it('renders the next meal image with its alt inside the region when the meal carries an image', () => {
    const highlight = renderHighlight(
      readyMeals([
        { plannedMealId: 'breakfast', mealType: 'BREAKFAST', title: 'Avena', recipeId: 'recipe-b', status: 'COMPLETED' },
        {
          plannedMealId: 'lunch',
          mealType: 'LUNCH',
          title: 'Ensalada de quinoa',
          recipeId: 'recipe-lunch',
          status: 'NOT_LOGGED',
          image: IMAGE,
        },
      ]),
    );

    expect(within(highlight).getByText('Ensalada de quinoa')).toBeInTheDocument();
    const img = within(highlight).getByRole('img', { name: IMAGE.alt });
    expect(img).toHaveAttribute('src', IMAGE.imageUrl);
  });

  it.each([
    ['absent', {}],
    ['null', { image: null }],
  ])('renders no image nor placeholder when the next meal image is %s', (_label, imageField) => {
    const highlight = renderHighlight(
      readyMeals([
        {
          plannedMealId: 'lunch',
          mealType: 'LUNCH',
          title: 'Ensalada de quinoa',
          recipeId: 'recipe-lunch',
          status: 'NOT_LOGGED',
          ...imageField,
        },
      ]),
    );

    expect(within(highlight).getByText('Ensalada de quinoa')).toBeInTheDocument();
    expectNoImage(highlight);
  });

  it('does not borrow the image of a meal other than the next one', () => {
    const highlight = renderHighlight(
      readyMeals([
        {
          plannedMealId: 'breakfast',
          mealType: 'BREAKFAST',
          title: 'Avena',
          recipeId: 'recipe-b',
          status: 'COMPLETED',
          image: IMAGE,
        },
        { plannedMealId: 'lunch', mealType: 'LUNCH', title: 'Ensalada de quinoa', recipeId: 'recipe-l', status: 'NOT_LOGGED' },
        {
          plannedMealId: 'dinner',
          mealType: 'DINNER',
          title: 'Sopa',
          recipeId: 'recipe-d',
          status: 'NOT_LOGGED',
          image: { ...IMAGE, alt: 'Sopa caliente' },
        },
      ]),
    );

    expect(within(highlight).getByText('Ensalada de quinoa')).toBeInTheDocument();
    expectNoImage(highlight);
  });
});
