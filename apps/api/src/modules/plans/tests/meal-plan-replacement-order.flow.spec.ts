import 'reflect-metadata';
import { MealReplacementService } from '../meal-replacement.service';
import { PlansService } from '../plans.service';
import { RecipeValidationService } from '../recipe-validation.service';

const USER = 'user-1';
const PLAN = 'plan-1';
const WEEK = '2026-09-14';
const KEY = '33333333-3333-4333-8333-333333333333';
const MEAL_TYPES = ['BREAKFAST', 'LUNCH', 'SNACK', 'DINNER'] as const;

function catalogRecipe(id: string, title = `Receta ${id}`) {
  return {
    id,
    title,
    description: 'Receta del catálogo',
    prepMinutes: 10,
    cookMinutes: 10,
    ingredients: [{ name: 'Quinoa', quantity: 100, unit: 'g' }],
    instructions: ['Mezclar'],
    categories: [],
    properties: [],
    nutritionalValues: { calories: 350, protein: 20 },
  };
}

function createFlow() {
  const recipes = new Map<string, any>();
  const meals = MEAL_TYPES.map(mealType => {
    const recipe = catalogRecipe(`original-${mealType.toLowerCase()}`, `Original ${mealType.toLowerCase()}`);
    recipes.set(recipe.id, recipe);
    return {
      id: `meal-${mealType.toLowerCase()}`,
      mealType,
      title: recipe.title,
      recipeId: recipe.id,
      recipe,
      updatedAt: new Date('2026-09-14T10:00:00.000Z'),
    };
  });
  const state: any = {
    plan: {
      id: PLAN,
      userId: USER,
      startDate: new Date(`${WEEK}T00:00:00.000Z`),
      version: 1,
      isCurrent: true,
      updatedAt: new Date('2026-09-14T10:00:00.000Z'),
      days: [
        {
          id: 'day-tuesday', day: 'TUESDAY', date: new Date('2026-09-15T00:00:00.000Z'),
          meals: [{ id: 'meal-tuesday-snack', mealType: 'SNACK', title: 'Merienda', recipeId: 'recipe-tuesday' }],
        },
        { id: 'day-wednesday', day: 'WEDNESDAY', date: new Date('2026-09-16T00:00:00.000Z'), meals: [] },
        {
          id: 'day-monday', day: 'MONDAY', date: new Date('2026-09-14T00:00:00.000Z'),
          meals: [meals[3], meals[1], meals[0], meals[2]],
        },
      ],
    },
  };

  let readCount = 0;
  let writeCount = 0;
  let runCount = 0;
  let replacementCount = 0;
  const readPlan = () => {
    const reverseDays = readCount % 2 === 0;
    readCount += 1;
    const days = reverseDays ? [...state.plan.days].reverse() : [...state.plan.days];
    return {
      ...state.plan,
      days: days.map((day: any) => ({
        ...day,
        meals: reverseDays ? [...day.meals].reverse() : [...day.meals],
      })),
    };
  };

  const repository: any = {
    findPlanByWeek: jest.fn(async () => readPlan()),
    findPlanWithMeals: jest.fn(async () => readPlan()),
    getUserWithProfile: jest.fn().mockResolvedValue({
      id: USER,
      nutritionProfile: { goal: 'MAINTAIN', diet: 'ALL', excludedIngredients: [], cookTimePreference: 'QUICK' },
    }),
    createOrRecoverGenerationRun: jest.fn(async () => ({
      run: { id: `run-${++runCount}`, status: 'PENDING' },
      wasCreated: true,
    })),
    replaceMealTransaction: jest.fn(async (input: any) => {
      const recipe = recipes.get(input.existingRecipeId);
      const plannedMeal = state.plan.days.flatMap((day: any) => day.meals)
        .find((meal: any) => meal.id === input.plannedMealId);
      Object.assign(plannedMeal, {
        title: input.title ?? recipe.title,
        recipeId: recipe.id,
        recipe,
        updatedAt: new Date(`2026-09-14T10:0${++writeCount}:00.000Z`),
      });
      state.plan.updatedAt = new Date(`2026-09-14T10:0${writeCount}:00.000Z`);
      return { recipe, plannedMeal };
    }),
    transitionGenerationRun: jest.fn().mockResolvedValue(1),
    findRecipeById: jest.fn(async (id: string) => recipes.get(id) ?? null),
    updateRecipeImageTracking: jest.fn().mockResolvedValue(undefined),
  };
  const coverage: any = {
    evaluate: jest.fn(async () => {
      const recipe = catalogRecipe(`replacement-${++replacementCount}`);
      recipes.set(recipe.id, recipe);
      return { result: { compatibleRecipes: [{ recipe }] } };
    }),
  };
  const config: any = { get: jest.fn().mockReturnValue(undefined) };
  const unsplash: any = { searchAndSelectCandidate: jest.fn().mockResolvedValue(null), trackDownload: jest.fn() };
  const openai: any = { generateReplacementMeal: jest.fn() };
  const validation = new RecipeValidationService({ findByNormalizedTitles: jest.fn().mockResolvedValue([]) } as any, repository);
  const replacement = new MealReplacementService(repository, openai, coverage, config, unsplash, validation);
  const plans = new PlansService(repository, {} as any, config, {} as any);
  return { repository, coverage, replacement, plans };
}

function mealSequence(plan: any) {
  return plan.days.map((day: any) => day.meals.map((meal: any) => ({
    id: meal.id,
    mealType: meal.mealType,
    title: meal.title,
  })));
}

function expectCanonicalPlan(plan: any) {
  expect(plan.days.map((day: any) => day.id)).toEqual(['day-monday', 'day-tuesday', 'day-wednesday']);
  expect(plan.days.map((day: any) => day.meals.map((meal: any) => meal.mealType))).toEqual([
    ['BREAKFAST', 'LUNCH', 'SNACK', 'DINNER'],
    ['SNACK'],
    [],
  ]);
}

describe('GET → replacement → GET — orden de plan estable (NUT-106)', () => {
  it.each(MEAL_TYPES)('reemplazar %s conserva identidad, tipo y posición tras recargar', async mealType => {
    const { repository, replacement, plans } = createFlow();
    const plannedMealId = `meal-${mealType.toLowerCase()}`;
    const before = await plans.getPlanByWeek(USER, WEEK);
    expectCanonicalPlan(before);

    const response: any = await replacement.replaceMeal(USER, PLAN, plannedMealId, KEY, {} as any);

    expect(response.plannedMeal).toEqual(expect.objectContaining({ id: plannedMealId, mealType }));
    expect(repository.replaceMealTransaction).toHaveBeenCalledWith(expect.objectContaining({ plannedMealId }));
    const after = await plans.getPlanByWeek(USER, WEEK);
    expectCanonicalPlan(after);
    expect(mealSequence(after).map((day: any[]) => day.map(meal => meal.id))).toEqual(
      mealSequence(before).map((day: any[]) => day.map(meal => meal.id)),
    );
    expect(after.days[0].meals.find((meal: any) => meal.id === plannedMealId)?.title).toBe('Receta replacement-1');
    expect(after.days[0].meals.filter((meal: any) => meal.id !== plannedMealId).map((meal: any) => meal.title)).toEqual(
      before.days[0].meals.filter((meal: any) => meal.id !== plannedMealId).map((meal: any) => meal.title),
    );

    const reloaded = await plans.getPlanByWeek(USER, WEEK);
    expectCanonicalPlan(reloaded);
    expect(mealSequence(reloaded)).toEqual(mealSequence(after));
  });

  it('el replay idempotente devuelve el mismo resultado y no cambia orden ni comidas vecinas', async () => {
    const { repository, coverage, replacement, plans } = createFlow();
    const plannedMealId = 'meal-breakfast';
    const first: any = await replacement.replaceMeal(USER, PLAN, plannedMealId, KEY, {} as any);
    const firstRequestSnapshot = repository.createOrRecoverGenerationRun.mock.calls[0][6];
    const writesBeforeReplay = repository.replaceMealTransaction.mock.calls.length;
    repository.createOrRecoverGenerationRun.mockResolvedValueOnce({
      run: {
        id: 'run-1',
        status: 'SUCCEEDED',
        requestSnapshot: firstRequestSnapshot,
        outputSnapshot: { recipeId: first.plannedMeal.recipeId, title: first.plannedMeal.title },
      },
      wasCreated: false,
    });

    const replay: any = await replacement.replaceMeal(USER, PLAN, plannedMealId, KEY, {} as any);

    expect(replay.plannedMeal).toEqual(first.plannedMeal);
    expect(repository.replaceMealTransaction).toHaveBeenCalledTimes(writesBeforeReplay);
    expect(coverage.evaluate).toHaveBeenCalledTimes(1);
    const afterReplay = await plans.getPlanByWeek(USER, WEEK);
    expectCanonicalPlan(afterReplay);
    expect(mealSequence(afterReplay)[0].map((meal: any) => meal.id)).toEqual([
      'meal-breakfast', 'meal-lunch', 'meal-snack', 'meal-dinner',
    ]);
    expect(afterReplay.days[0].meals[0].title).toBe(first.plannedMeal.title);
  });
});
