import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MealReplacementService } from '../meal-replacement.service';
import { MealReplacementConflictError } from '../plans.repository';
import { AiProviderUnavailableError } from '../gemini/gemini.service';
import { InsufficientCoverageProfileError } from '../../recipe/recipe-coverage.types';
import { pendingPersistedImage } from '../../unsplash/unsplash-search.fixture';

const USER = 'user-1';
const PLAN = 'plan-1';
const MEAL = 'meal-1';
const KEY = '33333333-3333-4333-8333-333333333333';
const PLAN_UPDATED_AT = new Date('2026-10-01T10:00:00.000Z');

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

function generatedMeal(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Wok de verduras',
    nutritionalValues: { Protein: 18, Fiber: 7, Calories: 420, Description: 'Cena liviana' },
    recipe: {
      title: 'Wok de verduras',
      description: 'Verduras salteadas',
      prepMinutes: 15,
      cookMinutes: 10,
      ingredients: [{ name: 'Brócoli', quantity: 200, unit: 'g' }],
      instructions: ['Saltear las verduras'],
    },
    ...overrides,
  };
}

function setupProbe() {
  return setup();
}

function setup(): any {
  const plan = {
    id: PLAN,
    userId: USER,
    version: 1,
    isCurrent: true,
    updatedAt: PLAN_UPDATED_AT,
    days: [
      { id: 'day-1', meals: [{ id: MEAL, mealType: 'DINNER', title: 'Cena vieja', recipeId: 'recipe-old' }] },
      { id: 'day-2', meals: [{ id: 'meal-2', mealType: 'LUNCH', title: 'Almuerzo', recipeId: 'recipe-used' }] },
    ],
  };
  const repository = {
    findPlanWithMeals: jest.fn().mockResolvedValue(plan),
    getUserWithProfile: jest.fn().mockResolvedValue({
      id: USER,
      nutritionProfile: { diet: 'ALL', goal: 'MAINTAIN', excludedIngredients: ['NUTS'], cookTimePreference: 'QUICK' },
    }),
    createOrRecoverGenerationRun: jest.fn().mockResolvedValue({ run: { id: 'run-1', status: 'PENDING' }, wasCreated: true }),
    replaceMealTransaction: jest.fn(async (input: any) => ({
      recipe: input.newRecipe ? { id: 'recipe-new', ...input.newRecipe } : catalogRecipe(input.existingRecipeId),
      plannedMeal: { id: MEAL, mealType: 'DINNER', title: input.title ?? 'Título de la receta' },
    })),
    transitionGenerationRun: jest.fn().mockResolvedValue(1),
    findRecipeById: jest.fn(),
    updateRecipeImageTracking: jest.fn().mockResolvedValue(undefined),
  };
  const gemini = { generateReplacementMeal: jest.fn().mockResolvedValue(generatedMeal()) };
  const coverage = { evaluate: jest.fn().mockResolvedValue({ result: { compatibleRecipes: [] } }) };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  // NUT-83: por defecto Unsplash no encuentra foto; los tests de imágenes lo cambian.
  const unsplash = {
    searchAndSelectCandidate: jest.fn().mockResolvedValue(null),
    trackDownload: jest.fn(async (image: any) => ({
      ...image,
      tracking: { ...image.tracking, status: 'SUCCEEDED', lastAttemptAt: '2026-10-06T12:00:00.000Z' },
    })),
  };
  const service = new MealReplacementService(repository as any, gemini as any, coverage as any, config as any, unsplash as any);
  const replace = (dto: Record<string, unknown> = {}, key = KEY) => service.replaceMeal(USER, PLAN, MEAL, key, dto);
  const catalogReturns = (...recipes: any[]) =>
    coverage.evaluate.mockResolvedValueOnce({ result: { compatibleRecipes: recipes.map(recipe => ({ recipe })) } });
  // requestSnapshot que arma el servicio para un body dado (para simular runs ya existentes).
  const snapshotFor = async (dto: Record<string, unknown> = {}) => {
    const probe = setupProbe();
    await probe.replace(dto);
    return probe.repository.createOrRecoverGenerationRun.mock.calls[0][6];
  };
  return { plan, repository, gemini, coverage, config, unsplash, replace, catalogReturns, snapshotFor };
}

describe('MealReplacementService - plan y comida del usuario', () => {
  it('404 si el plan no existe', async () => {
    const { repository, replace } = setup();
    repository.findPlanWithMeals.mockResolvedValue(null);

    await expect(replace()).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.createOrRecoverGenerationRun).not.toHaveBeenCalled();
  });

  it('403 si el plan es de otro usuario', async () => {
    const { plan, repository, replace } = setup();
    repository.findPlanWithMeals.mockResolvedValue({ ...plan, userId: 'otro-usuario' });

    await expect(replace()).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.createOrRecoverGenerationRun).not.toHaveBeenCalled();
  });

  it('404 si la comida no pertenece a ese plan', async () => {
    const { plan, repository, replace } = setup();
    repository.findPlanWithMeals.mockResolvedValue({ ...plan, days: [plan.days[1]] });

    await expect(replace()).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.createOrRecoverGenerationRun).not.toHaveBeenCalled();
  });

  it('409 si el plan no es la versión actual', async () => {
    const { plan, repository, replace } = setup();
    repository.findPlanWithMeals.mockResolvedValue({ ...plan, isCurrent: false });

    await expect(replace()).rejects.toBeInstanceOf(ConflictException);
    expect(repository.createOrRecoverGenerationRun).not.toHaveBeenCalled();
  });

  it('400 si el usuario no tiene perfil nutricional', async () => {
    const { repository, replace } = setup();
    repository.getUserWithProfile.mockResolvedValue({ id: USER, nutritionProfile: null });

    await expect(replace()).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('MealReplacementService - receta del catálogo (NUT-72, sin IA)', () => {
  it('reutiliza la receta del catálogo sin llamar a la IA y sólo envía la comida objetivo a la transacción', async () => {
    const { repository, gemini, catalogReturns, replace } = setup();
    catalogReturns(catalogRecipe('recipe-cat', 'Ensalada César'));

    const response = await replace();

    expect(gemini.generateReplacementMeal).not.toHaveBeenCalled();
    expect(repository.replaceMealTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        planId: PLAN,
        plannedMealId: MEAL,
        existingRecipeId: 'recipe-cat',
        expectedPlanUpdatedAt: PLAN_UPDATED_AT,
        generationRunId: 'run-1',
        nutritionalValues: { Protein: 20, Fiber: 0, Calories: 350, Description: 'Receta del catálogo' },
        outputSnapshot: { path: 'REUSED_EXISTING_RECIPE' },
      }),
    );
    expect(repository.replaceMealTransaction.mock.calls[0][0]).not.toHaveProperty('newRecipe');
    expect(response).toEqual({
      planId: PLAN,
      version: 1,
      dayId: 'day-1',
      plannedMeal: { id: MEAL, mealType: 'DINNER', title: 'Título de la receta', recipeId: 'recipe-cat', recipe: expect.objectContaining({ id: 'recipe-cat' }) },
      generationRunId: 'run-1',
    });
  });

  it('excluye la receta actual y las ya usadas en la semana', async () => {
    const { coverage, catalogReturns, replace } = setup();
    catalogReturns(catalogRecipe('recipe-cat'));

    await replace();

    expect(coverage.evaluate.mock.calls[0][0].excludeRecipeIds.sort()).toEqual(['recipe-old', 'recipe-used']);
  });

  it('si sólo queda una receta ya usada en la semana, la acepta (pero nunca la actual)', async () => {
    const { coverage, repository, catalogReturns, replace } = setup();
    catalogReturns();
    catalogReturns(catalogRecipe('recipe-used'));

    await replace();

    expect(coverage.evaluate.mock.calls[1][0].excludeRecipeIds).toEqual(['recipe-old']);
    expect(repository.replaceMealTransaction.mock.calls[0][0].existingRecipeId).toBe('recipe-used');
  });

  it('descarta una receta del catálogo que viola una restricción del perfil y usa la siguiente', async () => {
    const { repository, catalogReturns, replace } = setup();
    catalogReturns(catalogRecipe('recipe-nuts', 'Budín de nueces'), catalogRecipe('recipe-ok'));

    await replace();

    expect(repository.replaceMealTransaction.mock.calls[0][0].existingRecipeId).toBe('recipe-ok');
  });

  it('pasa los criterios del body a NUT-72 (refinan; las restricciones del perfil las agrega NUT-72)', async () => {
    const { coverage, catalogReturns, replace } = setup();
    catalogReturns(catalogRecipe('recipe-cat'));

    await replace({ topic: '  cena liviana ', categories: ['VEGETARIAN', 'VEGETARIAN'], properties: [' Sin Gluten '], maxPrepMinutes: 30 });

    expect(coverage.evaluate.mock.calls[0][0]).toEqual(
      expect.objectContaining({ userId: USER, topic: 'cena liviana', categories: ['VEGETARIAN'], properties: ['sin gluten'], maxPrepMinutes: 30 }),
    );
  });

  it('con body vacío no agrega ningún filtro extra', async () => {
    const { coverage, catalogReturns, replace } = setup();
    catalogReturns(catalogRecipe('recipe-cat'));

    await replace({});

    const request = coverage.evaluate.mock.calls[0][0];
    expect(request).toEqual(expect.objectContaining({ categories: [], properties: [] }));
    expect(request).not.toHaveProperty('topic');
    expect(request).not.toHaveProperty('maxPrepMinutes');
  });
});

describe('MealReplacementService - generación con IA (NUT-73/74)', () => {
  it('genera exactamente una receta cuando el catálogo no tiene ninguna compatible', async () => {
    const { repository, gemini, replace } = setup();

    const response = await replace({ topic: 'cena liviana' });

    expect(gemini.generateReplacementMeal).toHaveBeenCalledTimes(1);
    expect(gemini.generateReplacementMeal).toHaveBeenCalledWith(
      expect.objectContaining({ excludedIngredients: ['NUTS'] }),
      'DINNER',
      expect.objectContaining({ topic: 'cena liviana' }),
    );
    const write = repository.replaceMealTransaction.mock.calls[0][0];
    expect(write.newRecipe).toEqual(expect.objectContaining({ title: 'Wok de verduras', prepMinutes: 15 }));
    expect(write.title).toBe('Wok de verduras');
    expect(write.outputSnapshot).toEqual({ path: 'AI_GENERATED' });
    expect(response.plannedMeal.recipeId).toBe('recipe-new');
  });

  it('si NUT-72 no puede evaluar el perfil (ej. KETO), sigue con la IA', async () => {
    const { coverage, gemini, replace } = setup();
    coverage.evaluate.mockRejectedValue(new InsufficientCoverageProfileError());

    await replace();

    expect(gemini.generateReplacementMeal).toHaveBeenCalledTimes(1);
  });

  it('503 si la IA no responde: el run queda FAILED y no se toca el plan', async () => {
    const { repository, gemini, replace } = setup();
    gemini.generateReplacementMeal.mockRejectedValue(new AiProviderUnavailableError('AI_TIMEOUT'));

    await expect(replace()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repository.transitionGenerationRun).toHaveBeenCalledWith('run-1', USER, ['PENDING'], 'FAILED', { errorCode: 'AI_TIMEOUT' });
    expect(repository.replaceMealTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['una respuesta que no es JSON', null, 'AI_INVALID_SCHEMA'],
    ['una comida sin receta', generatedMeal({ recipe: undefined }), 'AI_INVALID_SCHEMA'],
    ['una comida con un ingrediente excluido', generatedMeal({ title: 'Pollo con salsa de maní' }), 'RESTRICTION_VIOLATION'],
  ])('422 si la IA devuelve %s: el run queda REJECTED y no se toca el plan', async (_label, generated, errorCode) => {
    const { repository, gemini, replace } = setup();
    gemini.generateReplacementMeal.mockResolvedValue(generated);

    await expect(replace()).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repository.transitionGenerationRun).toHaveBeenCalledWith('run-1', USER, ['PENDING'], 'REJECTED', { errorCode });
    expect(repository.replaceMealTransaction).not.toHaveBeenCalled();
  });

  it('acepta la receta de la IA si cumple las categorías y propiedades pedidas, y la guarda con ellas', async () => {
    const { repository, gemini, replace } = setup();
    gemini.generateReplacementMeal.mockResolvedValue(generatedMeal({
      recipe: { ...generatedMeal().recipe, categories: ['VEGAN', 'VEGETARIAN', 'PIZZA'], properties: ['Sin Gluten', 'Alto en Fibra'] },
    }));

    await replace({ categories: ['VEGETARIAN'], properties: [' sin gluten '] });

    expect(repository.replaceMealTransaction.mock.calls[0][0].newRecipe).toEqual(
      expect.objectContaining({ categories: ['VEGAN', 'VEGETARIAN'], properties: ['Sin Gluten', 'Alto en Fibra'] }),
    );
  });

  it.each([
    ['ninguna categoría pedida', { categories: ['VEGETARIAN'] }, { categories: ['HIGH_PROTEIN'], properties: [] }],
    ['la IA no clasificó la receta', { categories: ['VEGETARIAN'] }, {}],
    ['falta una propiedad pedida', { properties: ['Sin Gluten', 'Alto en Fibra'] }, { categories: [], properties: ['Sin Gluten'] }],
  ])('422 si la receta de la IA no cumple el body (%s)', async (_label, body, tags) => {
    const { repository, gemini, replace } = setup();
    gemini.generateReplacementMeal.mockResolvedValue(generatedMeal({ recipe: { ...generatedMeal().recipe, ...tags } }));

    await expect(replace(body)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repository.transitionGenerationRun).toHaveBeenCalledWith('run-1', USER, ['PENDING'], 'REJECTED', { errorCode: 'CRITERIA_NOT_MET' });
    expect(repository.replaceMealTransaction).not.toHaveBeenCalled();
  });

  it('422 si la receta generada supera maxPrepMinutes del body', async () => {
    const { repository, replace } = setup();

    await expect(replace({ maxPrepMinutes: 5 })).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repository.transitionGenerationRun).toHaveBeenCalledWith('run-1', USER, ['PENDING'], 'REJECTED', { errorCode: 'CRITERIA_NOT_MET' });
  });
});

describe('MealReplacementService - idempotencia y concurrencia', () => {
  it('la misma Idempotency-Key produce el mismo hash; otra clave, otro hash', async () => {
    const { repository, catalogReturns, replace } = setup();
    catalogReturns(catalogRecipe('a'));
    catalogReturns(catalogRecipe('b'));
    catalogReturns(catalogRecipe('c'));

    await replace({});
    await replace({ topic: 'otro body' });
    await replace({}, '44444444-4444-4444-8444-444444444444');

    const hashes = repository.createOrRecoverGenerationRun.mock.calls.map((call: any[]) => call[8]);
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[2]).not.toBe(hashes[0]);
  });

  it('repetir el mismo pedido con la misma clave devuelve el mismo reemplazo sin buscar ni generar de nuevo', async () => {
    const { repository, coverage, gemini, catalogReturns, replace } = setup();
    catalogReturns(catalogRecipe('recipe-cat'));
    await replace({ topic: 'cena' });
    const firstSnapshot = repository.createOrRecoverGenerationRun.mock.calls[0][6];

    repository.createOrRecoverGenerationRun.mockResolvedValue({
      run: { id: 'run-1', status: 'SUCCEEDED', requestSnapshot: firstSnapshot, outputSnapshot: { recipeId: 'recipe-cat', title: 'Ensalada' } },
      wasCreated: false,
    });
    repository.findRecipeById.mockResolvedValue(catalogRecipe('recipe-cat'));
    coverage.evaluate.mockClear();

    const replay = await replace({ topic: 'cena' });

    expect(coverage.evaluate).not.toHaveBeenCalled();
    expect(gemini.generateReplacementMeal).not.toHaveBeenCalled();
    expect(repository.replaceMealTransaction).toHaveBeenCalledTimes(1);
    expect(replay.generationRunId).toBe('run-1');
    expect(replay.plannedMeal).toEqual(expect.objectContaining({ recipeId: 'recipe-cat', title: 'Ensalada' }));
  });

  it('el mismo pedido con categorías y propiedades en otro orden tiene la misma huella', async () => {
    const { repository, catalogReturns, replace } = setup();
    catalogReturns(catalogRecipe('a'));
    catalogReturns(catalogRecipe('b'));

    await replace({ categories: ['VEGETARIAN', 'HIGH_PROTEIN'], properties: ['Sin Gluten', 'Alto en Fibra'] });
    await replace({ categories: ['HIGH_PROTEIN', 'VEGETARIAN', 'VEGETARIAN'], properties: ['alto en fibra', 'Sin Gluten'] });

    const [first, second] = repository.createOrRecoverGenerationRun.mock.calls.map((call: any[]) => call[6]);
    expect(second).toEqual(first);
    expect(first.criteria).toEqual({ categories: ['HIGH_PROTEIN', 'VEGETARIAN'], properties: ['alto en fibra', 'sin gluten'] });
  });

  it('409 si la misma clave se usa con un pedido distinto', async () => {
    const { repository, replace } = setup();
    repository.createOrRecoverGenerationRun.mockResolvedValue({
      run: { id: 'run-1', status: 'SUCCEEDED', requestSnapshot: { kind: 'MEAL_REPLACEMENT', plannedMealId: 'otra' } },
      wasCreated: false,
    });

    await expect(replace()).rejects.toBeInstanceOf(ConflictException);
    expect(repository.replaceMealTransaction).not.toHaveBeenCalled();
  });

  it('409 si otra request con la misma clave todavía está en curso (no hay dos cambios)', async () => {
    const { repository, replace } = setup();
    const firstCall = setup();
    await firstCall.replace();
    const snapshot = firstCall.repository.createOrRecoverGenerationRun.mock.calls[0][6];
    repository.createOrRecoverGenerationRun.mockResolvedValue({ run: { id: 'run-1', status: 'PENDING', requestSnapshot: snapshot }, wasCreated: false });

    await expect(replace()).rejects.toBeInstanceOf(ConflictException);
    expect(repository.replaceMealTransaction).not.toHaveBeenCalled();
  });

  it('409 si el plan cambió durante la operación: el run queda FAILED (la transacción se revirtió)', async () => {
    const { repository, replace } = setup();
    repository.replaceMealTransaction.mockRejectedValue(new MealReplacementConflictError());

    await expect(replace()).rejects.toBeInstanceOf(ConflictException);
    expect(repository.transitionGenerationRun).toHaveBeenCalledWith('run-1', USER, ['PENDING'], 'FAILED', { errorCode: 'CONCURRENT_CONFLICT' });
  });

  it('si la persistencia falla por otro motivo, el run queda FAILED y el error sigue de largo', async () => {
    const { repository, replace } = setup();
    repository.replaceMealTransaction.mockRejectedValue(new Error('db down'));

    await expect(replace()).rejects.toThrow('db down');
    expect(repository.transitionGenerationRun).toHaveBeenCalledWith('run-1', USER, ['PENDING'], 'FAILED', { errorCode: 'PERSISTENCE_FAILED' });
  });
});

describe('MealReplacementService - runs colgados y errores inesperados', () => {
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

  it('un error inesperado de NUT-72 deja el run FAILED (no PENDING)', async () => {
    const { repository, coverage, replace } = setup();
    coverage.evaluate.mockRejectedValue(new Error('db down'));

    await expect(replace()).rejects.toThrow('db down');
    expect(repository.transitionGenerationRun).toHaveBeenCalledWith('run-1', USER, ['PENDING'], 'FAILED', { errorCode: 'UNEXPECTED_ERROR' });
  });

  it('un error inesperado de Gemini (que no es de proveedor) deja el run FAILED', async () => {
    const { repository, gemini, replace } = setup();
    gemini.generateReplacementMeal.mockRejectedValue(new TypeError('bug'));

    await expect(replace()).rejects.toThrow('bug');
    expect(repository.transitionGenerationRun).toHaveBeenCalledWith('run-1', USER, ['PENDING'], 'FAILED', { errorCode: 'UNEXPECTED_ERROR' });
  });

  it('un PENDING más viejo que el TTL (10 min por defecto) pasa a EXPIRED y el reemplazo se hace de cero', async () => {
    const { repository, catalogReturns, replace, snapshotFor } = setup();
    const snapshot = await snapshotFor();
    repository.createOrRecoverGenerationRun
      .mockResolvedValueOnce({ run: { id: 'run-stale', status: 'PENDING', startedAt: minutesAgo(11), requestSnapshot: snapshot }, wasCreated: false })
      .mockResolvedValueOnce({ run: { id: 'run-2', status: 'PENDING' }, wasCreated: true });
    catalogReturns(catalogRecipe('recipe-cat'));

    const response = await replace();

    expect(repository.transitionGenerationRun).toHaveBeenCalledWith('run-stale', USER, ['PENDING'], 'EXPIRED', { errorCode: 'PENDING_TIMEOUT' });
    expect(repository.replaceMealTransaction).toHaveBeenCalledWith(expect.objectContaining({ generationRunId: 'run-2' }));
    expect(response.generationRunId).toBe('run-2');
  });

  it('un PENDING reciente no expira: sigue siendo 409 "en curso"', async () => {
    const { repository, replace, snapshotFor } = setup();
    const snapshot = await snapshotFor();
    repository.createOrRecoverGenerationRun.mockResolvedValue({
      run: { id: 'run-1', status: 'PENDING', startedAt: minutesAgo(2), requestSnapshot: snapshot },
      wasCreated: false,
    });

    await expect(replace()).rejects.toBeInstanceOf(ConflictException);
    expect(repository.transitionGenerationRun).not.toHaveBeenCalled();
  });

  it('el TTL se configura con MEAL_REPLACEMENT_PENDING_TTL_MINUTES', async () => {
    const { repository, config, catalogReturns, replace, snapshotFor } = setup();
    const snapshot = await snapshotFor();
    config.get.mockImplementation((key: string) => (key === 'MEAL_REPLACEMENT_PENDING_TTL_MINUTES' ? '1' : undefined));
    repository.createOrRecoverGenerationRun
      .mockResolvedValueOnce({ run: { id: 'run-stale', status: 'PENDING', startedAt: minutesAgo(2), requestSnapshot: snapshot }, wasCreated: false })
      .mockResolvedValueOnce({ run: { id: 'run-2', status: 'PENDING' }, wasCreated: true });
    catalogReturns(catalogRecipe('recipe-cat'));

    await replace();

    expect(repository.transitionGenerationRun).toHaveBeenCalledWith('run-stale', USER, ['PENDING'], 'EXPIRED', { errorCode: 'PENDING_TIMEOUT' });
  });
});

describe('MealReplacementService - imágenes de NUT-83', () => {
  const PUBLIC_IMAGE_KEYS = ['alt', 'imageUrl', 'photographer', 'photographerUrl', 'provider', 'providerPhotoId', 'query', 'retrievedAt', 'sourceUrl'];

  it('una receta del catálogo con foto se devuelve sin la metadata privada de tracking', async () => {
    const { repository, catalogReturns, replace } = setup();
    catalogReturns(catalogRecipe('recipe-cat'));
    repository.replaceMealTransaction.mockResolvedValue({
      recipe: { ...catalogRecipe('recipe-cat'), image: pendingPersistedImage({ tracking: { status: 'SUCCEEDED' } }) },
      plannedMeal: { id: MEAL, mealType: 'DINNER', title: 'Receta recipe-cat' },
    });

    const response: any = await replace();

    expect(Object.keys(response.plannedMeal.recipe.image).sort()).toEqual([...PUBLIC_IMAGE_KEYS].sort());
    expect(JSON.stringify(response)).not.toContain('tracking');
  });

  it('al repetir con la misma clave también se filtra la metadata privada', async () => {
    const { repository, catalogReturns, replace, snapshotFor } = setup();
    const snapshot = await snapshotFor();
    catalogReturns(catalogRecipe('recipe-cat'));
    repository.createOrRecoverGenerationRun.mockResolvedValue({
      run: { id: 'run-1', status: 'SUCCEEDED', requestSnapshot: snapshot, outputSnapshot: { recipeId: 'recipe-cat', title: 'Receta' } },
      wasCreated: false,
    });
    repository.findRecipeById.mockResolvedValue({ ...catalogRecipe('recipe-cat'), image: pendingPersistedImage() });

    const response: any = await replace();

    expect(response.plannedMeal.recipe.image).not.toHaveProperty('tracking');
    expect(JSON.stringify(response)).not.toContain('/download');
  });

  it('la receta de la IA busca foto antes de guardar, se guarda PENDING y el uso se registra después del commit', async () => {
    const { repository, unsplash, replace } = setup();
    const callOrder: string[] = [];
    const image = pendingPersistedImage();
    unsplash.searchAndSelectCandidate.mockImplementation(async (title: string) => {
      callOrder.push(`search:${title}`);
      return image;
    });
    repository.replaceMealTransaction.mockImplementation(async (input: any) => {
      callOrder.push(`tx:image=${input.newRecipe.image.tracking.status}`);
      return { recipe: { id: 'recipe-new', ...input.newRecipe }, plannedMeal: { id: MEAL, mealType: 'DINNER', title: input.title } };
    });
    unsplash.trackDownload.mockImplementation(async (persisted: any) => {
      callOrder.push('trackDownload');
      return { ...persisted, tracking: { ...persisted.tracking, status: 'SUCCEEDED', lastAttemptAt: 'x' } };
    });

    const response: any = await replace();

    expect(callOrder).toEqual(['search:Wok de verduras', 'tx:image=PENDING', 'trackDownload']);
    expect(repository.updateRecipeImageTracking).toHaveBeenCalledWith('recipe-new', expect.objectContaining({
      tracking: expect.objectContaining({ status: 'SUCCEEDED' }),
    }));
    expect(Object.keys(response.plannedMeal.recipe.image).sort()).toEqual([...PUBLIC_IMAGE_KEYS].sort());
  });

  it('si Unsplash no encuentra foto (o falla), la receta de la IA se guarda sin imagen y no se registra uso', async () => {
    const { repository, unsplash, replace } = setup();
    unsplash.searchAndSelectCandidate.mockRejectedValue(new Error('bug'));

    const response: any = await replace();

    expect(repository.replaceMealTransaction.mock.calls[0][0].newRecipe).not.toHaveProperty('image');
    expect(unsplash.trackDownload).not.toHaveBeenCalled();
    expect(response.plannedMeal.recipe.image).toBeNull();
  });

  it('si guardar el resultado del tracking falla, el reemplazo igual responde 200 (queda PENDING para recuperación)', async () => {
    const { repository, unsplash, replace } = setup();
    unsplash.searchAndSelectCandidate.mockResolvedValue(pendingPersistedImage());
    repository.updateRecipeImageTracking.mockRejectedValue(new Error('db down'));

    const response: any = await replace();

    expect(response.plannedMeal.recipeId).toBe('recipe-new');
    expect(response.plannedMeal.recipe.image).not.toBeNull();
    expect(repository.transitionGenerationRun).not.toHaveBeenCalled();
  });

  it('una receta reutilizada del catálogo nunca busca ni registra foto de nuevo', async () => {
    const { unsplash, catalogReturns, replace } = setup();
    catalogReturns(catalogRecipe('recipe-cat'));

    await replace();

    expect(unsplash.searchAndSelectCandidate).not.toHaveBeenCalled();
    expect(unsplash.trackDownload).not.toHaveBeenCalled();
  });
});
