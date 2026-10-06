import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlansService } from '../plans.service';
import { CreateMealPlanDto } from '../dto';
import { DayOfWeek, MealType } from '../../../generated/prisma/client';
import { UnsplashService } from '../../unsplash/unsplash.service';
import {
  pendingPersistedImage,
  unsplashPhoto,
  unsplashResponse,
  unsplashSearchBody,
} from '../../unsplash/unsplash-search.fixture';

// PUT /meal-plans y creación de planes con el UnsplashService real (sólo fetch mockeado), así
// "0 búsquedas / 0 tracking" cuenta llamadas de red reales. El mock del repositorio se comporta como el real.
const MOCK_API_KEY = 'test-unsplash-key-plan-update';
const userId = 'user-1';
const weekStart = '2026-09-14';
const DAYS = [
  [DayOfWeek.MONDAY, '2026-09-14'],
  [DayOfWeek.TUESDAY, '2026-09-15'],
  [DayOfWeek.WEDNESDAY, '2026-09-16'],
  [DayOfWeek.THURSDAY, '2026-09-17'],
  [DayOfWeek.FRIDAY, '2026-09-18'],
  [DayOfWeek.SATURDAY, '2026-09-19'],
  [DayOfWeek.SUNDAY, '2026-09-20'],
] as const;

const EXISTING_RECIPE_ID = '7f8a1c2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b';
const OTHER_USER_RECIPE_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const OLD_VERSION_RECIPE_ID = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';
const UNKNOWN_RECIPE_ID = '00000000-0000-4000-8000-000000000000';

function recipe(title: string, extra: Record<string, unknown> = {}) {
  return {
    title,
    description: 'Receta de prueba',
    prepMinutes: 10,
    cookMinutes: 15,
    ingredients: [{ name: 'Ingrediente', quantity: 100, unit: 'g' }],
    instructions: ['Paso unico'],
    ...extra,
  };
}

// Una comida por día: la del lunes es la que cambia cada test; las demás son recetas nuevas
// con el mismo título, así entre todas cuestan una sola búsqueda.
function weekWith(mondayRecipe: Record<string, unknown>) {
  return DAYS.map(([day, date], index) => ({
    day,
    date,
    meals: [
      {
        mealType: MealType.LUNCH,
        title: index === 0 ? (mondayRecipe.title as string) : 'Tacos de Pollo',
        nutritionalValues: { Protein: 20, Fiber: 8, Calories: 350, Description: 'Almuerzo' },
        recipe: index === 0 ? mondayRecipe : recipe('Tacos de Pollo'),
      },
    ],
  }));
}

function setup(existingImage: unknown = pendingPersistedImage({ tracking: { status: 'SUCCEEDED', lastAttemptAt: '2026-10-01T10:00:00.000Z' } })) {
  const searchPhoto = unsplashPhoto('newSearch001');
  const fetchMock = jest.fn(async (url: unknown) => {
    const target = String(url);
    if (target.startsWith('https://api.unsplash.com/search/photos')) {
      return unsplashResponse(unsplashSearchBody([searchPhoto]), { remaining: 40 });
    }
    return unsplashResponse({ url: 'https://images.unsplash.com/photo-x' });
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  // Versión actual del plan de ESTE usuario para ESTA semana, como la devuelve findPlanByWeek.
  const currentPlan = {
    id: 'plan-v1',
    userId,
    isCurrent: true,
    days: [
      {
        id: 'day-1',
        meals: [{ id: 'meal-1', recipeId: EXISTING_RECIPE_ID, recipe: { id: EXISTING_RECIPE_ID, title: 'Ensalada de Quinoa', image: existingImage } }],
      },
    ],
  };

  const repository: any = {
    getUserWithProfile: jest.fn().mockResolvedValue({ id: userId, nutritionProfile: { diet: 'OMNIVORE', excludedIngredients: [] } }),
    checkPlanExists: jest.fn().mockResolvedValue(false),
    findPlanByWeek: jest.fn().mockResolvedValue(currentPlan),
    createOrRecoverGenerationRun: jest.fn().mockResolvedValue({ run: { id: 'run-1', status: 'PENDING' }, wasCreated: true }),
    transitionGenerationRun: jest.fn().mockResolvedValue(1),
    updateRecipeImageTracking: jest.fn().mockResolvedValue(undefined),
  };
  const persistWithRealContract = jest.fn(async (_userId: string, _weekStart: Date, days: any[]) => {
    const recipesForTracking: Array<{ recipeId: string; image: any }> = [];
    days.forEach((day, dayIndex) =>
      day.meals.forEach((meal: any, mealIndex: number) => {
        const image = meal.recipe?.image;
        if (image && typeof image === 'object' && 'tracking' in image) {
          recipesForTracking.push({ recipeId: `new-recipe-${dayIndex}-${mealIndex}`, image });
        }
      }),
    );
    return { planId: 'plan-v2', recipesForTracking };
  });
  repository.updatePlanTransaction = persistWithRealContract;
  repository.createPlanTransaction = persistWithRealContract;

  const configService = { get: jest.fn((key: string) => (key === 'UNSPLASH_ACCESS_KEY' ? MOCK_API_KEY : undefined)) } as unknown as ConfigService;
  const service = new PlansService(repository, {} as any, new UnsplashService(configService), {} as any, {} as any);

  const searchCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/search/photos'));
  const trackingCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/download'));
  const persistedMonday = () => persistWithRealContract.mock.calls[0][2][0].meals[0].recipe;

  return { service, repository, fetchMock, searchCalls, trackingCalls, persistedMonday, currentPlan, searchPhoto };
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('PUT /meal-plans - a recipe from the current plan version keeps its image', () => {
  it('a valid id keeps the same persisted image (tracking included) with 0 searches and 0 tracking for it', async () => {
    const { service, searchCalls, trackingCalls, persistedMonday, currentPlan, repository } = setup();
    const days = weekWith(recipe('Ensalada de Quinoa', { id: EXISTING_RECIPE_ID }));
    days.forEach((day, index) => {
      if (index > 0) day.meals[0].recipe = recipe('Ensalada de Quinoa', { id: EXISTING_RECIPE_ID });
    });

    await service.updatePlan(userId, { weekStart, days } as any);

    expect(persistedMonday().image).toEqual(currentPlan.days[0].meals[0].recipe.image);
    expect(searchCalls()).toHaveLength(0);
    expect(trackingCalls()).toHaveLength(0);
    expect(repository.updateRecipeImageTracking).not.toHaveBeenCalled();
  });

  it('a preserved image still PENDING is not tracked by the PUT (left to the recovery script)', async () => {
    const pending = pendingPersistedImage();
    const { service, trackingCalls, persistedMonday } = setup(pending);

    await service.updatePlan(userId, { weekStart, days: weekWith(recipe('Ensalada de Quinoa', { id: EXISTING_RECIPE_ID })) } as any);

    expect(persistedMonday().image).toEqual(pending);
    // Sólo se registran las recetas nuevas de "Tacos de Pollo": un evento para su foto compartida.
    expect(trackingCalls()).toHaveLength(1);
    expect(String(trackingCalls()[0][0])).toContain('newSearch001');
  });

  it('a preserved recipe without image keeps image: null and is not searched', async () => {
    const { service, searchCalls, persistedMonday } = setup(null);

    await service.updatePlan(userId, { weekStart, days: weekWith(recipe('Ensalada de Quinoa', { id: EXISTING_RECIPE_ID })) } as any);

    expect(persistedMonday().image).toBeNull();
    expect(searchCalls().every(([url]) => !String(url).includes('quinoa'))).toBe(true);
  });

  it('new recipes in the same PUT are searched once per query and tracked once per photo, after the transaction', async () => {
    const { service, searchCalls, trackingCalls, repository } = setup();

    await service.updatePlan(userId, { weekStart, days: weekWith(recipe('Ensalada de Quinoa', { id: EXISTING_RECIPE_ID })) } as any);

    expect(searchCalls()).toHaveLength(1);
    expect(new URL(String(searchCalls()[0][0])).searchParams.get('query')).toBe('tacos de pollo food recipe');
    expect(trackingCalls()).toHaveLength(1);
    // Las seis recetas nuevas de Tacos comparten foto: un solo evento, guardado en las seis.
    expect(repository.updateRecipeImageTracking).toHaveBeenCalledTimes(6);
    expect(repository.updateRecipeImageTracking.mock.calls.every(([, image]: any) => image.tracking.status === 'SUCCEEDED')).toBe(true);
  });

  it.each([
    ['another user', OTHER_USER_RECIPE_ID],
    ['an older plan version', OLD_VERSION_RECIPE_ID],
    ['a non-existent recipe', UNKNOWN_RECIPE_ID],
  ])('an id from %s is treated as a new recipe: searched and tracked, no error', async (_label, id) => {
    const { service, searchCalls, persistedMonday, searchPhoto } = setup();

    await expect(
      service.updatePlan(userId, { weekStart, days: weekWith(recipe('Ensalada de Quinoa', { id })) } as any),
    ).resolves.toBeDefined();

    expect(persistedMonday().image.providerPhotoId).toBe(searchPhoto.id);
    expect(searchCalls().some(([url]) => new URL(String(url)).searchParams.get('query') === 'ensalada de quinoa food recipe')).toBe(true);
  });

  it('an `image` in the payload is ignored: without id the recipe is searched, with a valid id the persisted image wins', async () => {
    const injected = pendingPersistedImage({ providerPhotoId: 'injected0001', imageUrl: 'https://evil.example.com/x.jpg', tracking: { status: 'SUCCEEDED' } });
    const { service, persistedMonday, currentPlan, searchPhoto } = setup();

    await service.updatePlan(userId, { weekStart, days: weekWith(recipe('Ensalada de Quinoa', { image: injected })) } as any);
    expect(persistedMonday().image.providerPhotoId).toBe(searchPhoto.id);

    const second = setup();
    await second.service.updatePlan(userId, { weekStart, days: weekWith(recipe('Ensalada de Quinoa', { id: EXISTING_RECIPE_ID, image: injected })) } as any);
    expect(second.persistedMonday().image).toEqual(currentPlan.days[0].meals[0].recipe.image);
  });

  it('only looks up existing recipes in findPlanByWeek(userId, weekStart), i.e. the current version of this user\'s plan for this week', async () => {
    const { service, repository } = setup();

    await service.updatePlan(userId, { weekStart, days: weekWith(recipe('Ensalada de Quinoa', { id: EXISTING_RECIPE_ID })) } as any);

    expect(repository.findPlanByWeek).toHaveBeenCalledWith(userId, new Date(`${weekStart}T00:00:00Z`));
  });
});

describe('plan creation never takes `image` from its input', () => {
  it('validateAndPersistPlan drops an injected image (e.g. from the AI output) and searches instead', async () => {
    const injected = pendingPersistedImage({ providerPhotoId: 'injected0001' });
    const { service, persistedMonday, searchPhoto, repository } = setup();
    repository.findPlanByWeek.mockResolvedValue({ id: 'plan-v1', days: [] });

    await service.validateAndPersistPlan(userId, { weekStart, days: weekWith(recipe('Ensalada de Quinoa', { id: EXISTING_RECIPE_ID, image: injected })) } as any);

    expect(persistedMonday().image.providerPhotoId).toBe(searchPhoto.id);
  });
});

describe('PUT /meal-plans payload validation (same ValidationPipe options as main.ts)', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const validate = (days: unknown) => pipe.transform({ weekStart, days }, { type: 'body', metatype: CreateMealPlanDto });

  it('accepts a recipe with a UUID id', async () => {
    await expect(validate(weekWith(recipe('Ensalada de Quinoa', { id: EXISTING_RECIPE_ID })))).resolves.toBeInstanceOf(CreateMealPlanDto);
  });

  it('rejects a recipe carrying `image` with 400', async () => {
    await expect(validate(weekWith(recipe('Ensalada de Quinoa', { image: pendingPersistedImage() })))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a recipe id that is not a UUID with 400', async () => {
    await expect(validate(weekWith(recipe('Ensalada de Quinoa', { id: 'not-a-uuid' })))).rejects.toBeInstanceOf(BadRequestException);
  });
});
