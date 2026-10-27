import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { TodayMealsCard } from '@/modules/dashboard/components/TodayMealsCard';
import type { CardState, TodayMeal, TodayMealsData } from '@/modules/dashboard/types';
import type { RecipeImage } from '@/services/recipeService';

afterEach(cleanup);

const LONG_TITLE = 'Ensalada tibia de quinoa con garbanzos asados, palta, tomates cherry y aderezo de limón y yogur';

const QUINOA_IMAGE: RecipeImage = {
  provider: 'UNSPLASH',
  imageUrl: 'https://images.example.test/quinoa.jpg',
  alt: 'Ensalada de quinoa en un bol',
  photographer: 'Fotógrafa de prueba',
  photographerUrl: 'https://example.test/fotografa',
  sourceUrl: 'https://example.test/foto',
};

const SOUP_IMAGE: RecipeImage = { ...QUINOA_IMAGE, imageUrl: 'https://images.example.test/sopa.jpg', alt: 'Sopa caliente' };

function readyMeals(meals: TodayMeal[]): CardState<TodayMealsData> {
  return { kind: 'ready', data: { kind: 'meals', meals } };
}

function renderCard(state: CardState<TodayMealsData>) {
  render(
    <MemoryRouter>
      <TodayMealsCard state={state} />
    </MemoryRouter>,
  );
  return screen.getByRole('region', { name: 'Comidas de hoy' });
}

function rowOf(region: HTMLElement, title: string): HTMLElement {
  const row = within(region).getByText(title).closest('li');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

function expectNoThumbnail(row: HTMLElement) {
  expect(within(row).queryByRole('img')).not.toBeInTheDocument();
  expect(row.querySelector('img')).toBeNull();
  expect(within(row).queryByLabelText(/Imagen no disponible/)).not.toBeInTheDocument();
}

describe('TodayMealsCard readable titles', () => {
  const meals: TodayMeal[] = [
    { plannedMealId: 'breakfast', mealType: 'BREAKFAST', title: 'Avena', recipeId: 'r-b', status: 'COMPLETED' },
    { plannedMealId: 'lunch', mealType: 'LUNCH', title: LONG_TITLE, recipeId: 'r-l', status: 'NOT_LOGGED' },
  ];

  it('clamps each meal title to two lines with word breaking instead of truncating to one line', () => {
    const region = renderCard(readyMeals(meals));

    for (const title of ['Avena', LONG_TITLE]) {
      const titleElement = within(region).getByText(title);
      expect(titleElement).toHaveClass('line-clamp-2', 'break-words');
      expect(titleElement).not.toHaveClass('truncate');
    }
  });

  it('lays out the meals list in at most two columns on large screens', () => {
    const region = renderCard(readyMeals(meals));

    const list = within(region).getByRole('list');
    expect(list).toHaveClass('grid-cols-1', 'md:grid-cols-2', 'lg:grid-cols-2');
    expect(list).not.toHaveClass('lg:grid-cols-4');
  });
});

describe('TodayMealsCard conditional thumbnails', () => {
  it.each([
    ['absent', {}],
    ['null', { image: null }],
  ])('renders no thumbnail nor placeholder when the meal image is %s', (_label, imageField) => {
    const region = renderCard(
      readyMeals([
        { plannedMealId: 'lunch', mealType: 'LUNCH', title: 'Ensalada de quinoa', recipeId: 'r-l', status: 'NOT_LOGGED', ...imageField },
      ]),
    );

    expectNoThumbnail(rowOf(region, 'Ensalada de quinoa'));
  });

  it('renders the meal image with its alt inside the row when the meal carries an image', () => {
    const region = renderCard(
      readyMeals([
        {
          plannedMealId: 'lunch',
          mealType: 'LUNCH',
          title: 'Ensalada de quinoa',
          recipeId: 'r-l',
          status: 'NOT_LOGGED',
          image: QUINOA_IMAGE,
        },
      ]),
    );

    const row = rowOf(region, 'Ensalada de quinoa');
    const img = within(row).getByRole('img', { name: QUINOA_IMAGE.alt });
    expect(img).toHaveAttribute('src', QUINOA_IMAGE.imageUrl);
  });

  it('shows a thumbnail only in the rows whose meal has an image', () => {
    const region = renderCard(
      readyMeals([
        { plannedMealId: 'breakfast', mealType: 'BREAKFAST', title: 'Avena', recipeId: 'r-b', status: 'COMPLETED' },
        {
          plannedMealId: 'lunch',
          mealType: 'LUNCH',
          title: 'Ensalada de quinoa',
          recipeId: 'r-l',
          status: 'NOT_LOGGED',
          image: QUINOA_IMAGE,
        },
        { plannedMealId: 'snack', mealType: 'SNACK', title: 'Yogur', recipeId: 'r-s', status: 'NOT_LOGGED', image: null },
        { plannedMealId: 'dinner', mealType: 'DINNER', title: 'Sopa', recipeId: 'r-d', status: 'NOT_LOGGED', image: SOUP_IMAGE },
      ]),
    );

    expectNoThumbnail(rowOf(region, 'Avena'));
    expectNoThumbnail(rowOf(region, 'Yogur'));
    expect(within(rowOf(region, 'Ensalada de quinoa')).getByRole('img', { name: QUINOA_IMAGE.alt })).toBeInTheDocument();
    expect(within(rowOf(region, 'Sopa')).getByRole('img', { name: SOUP_IMAGE.alt })).toBeInTheDocument();
    expect(region.querySelectorAll('img')).toHaveLength(2);
  });
});
