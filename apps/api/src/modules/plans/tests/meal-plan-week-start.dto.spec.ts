import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { DayOfWeek, MealType } from '../../../generated/prisma/client';
import { CreateMealPlanDto } from '../dto/create-meal-plan.dto';
import { GenerateMealPlanDto } from '../dto/generate-meal-plan.dto';
import { MealPlanQueryDto } from '../dto/meal-plan-query.dto';

const validIngredient = { name: 'Avena', quantity: 100, unit: 'g' };
const validRecipe = {
  title: 'Avena con frutas',
  description: 'Receta de prueba',
  prepMinutes: 10,
  cookMinutes: 0,
  ingredients: [validIngredient],
  instructions: ['Mezclar'],
};
const validMeal = {
  mealType: MealType.BREAKFAST,
  title: 'Avena con frutas',
  nutritionalValues: { Protein: 10, Fiber: 8, Calories: 300, Description: 'Desayuno' },
  recipe: validRecipe,
};
const validDays = [
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
  DayOfWeek.SUNDAY,
].map((day, index) => ({
  day,
  date: `2026-10-${String(19 + index).padStart(2, '0')}`,
  meals: [validMeal],
}));

const dtoCases = [
  {
    name: 'GenerateMealPlanDto',
    metatype: GenerateMealPlanDto,
    payload: (weekStart: string) => ({ weekStart }),
    type: 'body' as const,
  },
  {
    name: 'CreateMealPlanDto',
    metatype: CreateMealPlanDto,
    payload: (weekStart: string) => ({ weekStart, days: validDays }),
    type: 'body' as const,
  },
  {
    name: 'MealPlanQueryDto',
    metatype: MealPlanQueryDto,
    payload: (weekStart: string) => ({ weekStart }),
    type: 'query' as const,
  },
];

describe.each(dtoCases)('$name weekStart validation', ({ metatype, payload, type }) => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  async function transform(weekStart: string) {
    return pipe.transform(payload(weekStart), { type, metatype });
  }

  it('accepts an exact real Monday', async () => {
    await expect(transform('2026-10-19')).resolves.toMatchObject({ weekStart: '2026-10-19' });
  });

  it.each([
    ['a real Tuesday', '2026-10-20'],
    ['an impossible calendar date', '2026-02-30'],
    ['a malformed date', '2026-1-19'],
    ['a timestamp', '2026-10-19T00:00:00.000Z'],
  ])('rejects %s with HTTP 400', async (_description, weekStart) => {
    await expect(transform(weekStart)).rejects.toMatchObject({ status: 400 });
  });
});
