import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { MealPlanRegenerationService } from '../meal-plan-regeneration.service';
import { RecipeValidationService } from '../recipe-validation.service';

const USER = 'user-1';
const PLAN = 'plan-1';
const KEY = '33333333-3333-4333-8333-333333333333';
const WEEK = new Date('2026-09-14T00:00:00.000Z');
const body = { reason: 'USER_REQUESTED' as const };
const READ_AT = new Date('2026-09-14T10:00:00.000Z');

// Comida con receta, como la guarda el plan (la anterior) o como la propone la composición (la nueva).
const meal = (title: string, extra: Record<string, unknown> = {}) => ({
  mealType: 'LUNCH',
  title,
  nutritionalValues: { Protein: 20, Fiber: 8, Calories: 350, Description: 'Almuerzo' },
  recipe: { title, description: 'Receta', prepMinutes: 10, cookMinutes: 10, ingredients: [{ name: 'Quinoa', quantity: 100, unit: 'g' }], instructions: ['Cocinar'] },
  ...extra,
});

function currentPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: PLAN, userId: USER, startDate: WEEK, updatedAt: READ_AT, version: 1, isCurrent: true,
    days: [{ id: 'day-1', day: 'MONDAY', meals: [{ id: 'meal-1', ...meal('Ensalada de quinoa'), recipeId: 'recipe-v1' }] }],
    ...overrides,
  };
}

const SUMMARY = { stage: 'passed', codes: [], warnings: ['CALORIE_CHECK_SKIPPED'] };

// Propuesta de la composición (WeeklyProposalComposer): lunes con la comida dada.
function proposal(mondayMeal: Record<string, unknown> = meal('Wok de verduras')) {
  const days = [{ day: 'MONDAY', date: '2026-09-14', meals: [mondayMeal] }];
  return { dto: { weekStart: '2026-09-14', days }, comparableDays: days, summary: SUMMARY };
}

// Versión creada por una regeneración anterior, como la devuelve el repositorio (con la imagen privada).
function regeneratedVersion() {
  return {
    id: 'plan-2', userId: USER, startDate: WEEK, version: 2, isCurrent: false, supersedesId: PLAN, generationRunId: 'run-1',
    days: [{ id: 'day-1', meals: [{ id: 'meal-1', recipe: { id: 'recipe-1', image: { imageUrl: 'x', tracking: { status: 'SUCCEEDED' } } } }] }],
  };
}

function setup() {
  const repository = {
    findPlanWithMeals: jest.fn().mockResolvedValue(currentPlan()),
    getUserWithProfile: jest.fn().mockResolvedValue({
      id: USER,
      nutritionProfile: { goal: 'MAINTAIN', diet: 'ALL', excludedIngredients: ['NUTS'], cookTimePreference: 'QUICK' },
    }),
    createOrRecoverGenerationRun: jest.fn().mockResolvedValue({ run: { id: 'run-1', status: 'PENDING' }, wasCreated: true }),
    transitionGenerationRun: jest.fn().mockResolvedValue(1),
    findPlanByGenerationRunId: jest.fn().mockResolvedValue(regeneratedVersion()),
    updatePlanTransaction: jest.fn().mockResolvedValue({ planId: 'plan-2', recipesForTracking: [] }),
  };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const composer = { composeWeeklyProposal: jest.fn().mockResolvedValue(proposal()) };
  // Imágenes de NUT-83 (RecipeImagesService).
  const images = {
    resolveImagesOrDegrade: jest.fn(async (days: unknown) => days),
    trackNewRecipeImages: jest.fn().mockResolvedValue(undefined),
  };
  const validation = new RecipeValidationService({ findByNormalizedTitles: jest.fn() } as any, repository as any);
  const service = new MealPlanRegenerationService(repository as any, config as any, composer as any, images as any, validation);
  const regenerate = (planId = PLAN, key = KEY, dto: any = body) => service.regenerate(USER, planId, key, dto);
  // requestSnapshot que arma el servicio (para simular runs ya existentes con la misma clave).
  const snapshotFor = async (planId = PLAN) => {
    const probe = setup();
    await probe.regenerate(planId).catch(() => undefined);
    return probe.repository.createOrRecoverGenerationRun.mock.calls[0][6];
  };
  return { repository, config, composer, images, regenerate, snapshotFor };
}

describe('MealPlanRegenerationService - dueño, perfil y plan current (NUT-78)', () => {
  it('404 si el plan no existe, sin crear un run', async () => {
    const { repository, regenerate } = setup();
    repository.findPlanWithMeals.mockResolvedValue(null);

    await expect(regenerate()).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.createOrRecoverGenerationRun).not.toHaveBeenCalled();
  });

  it('403 si el plan es de otro usuario, sin crear un run', async () => {
    const { repository, regenerate } = setup();
    repository.findPlanWithMeals.mockResolvedValue(currentPlan({ userId: 'otro' }));

    await expect(regenerate()).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.createOrRecoverGenerationRun).not.toHaveBeenCalled();
  });

  it('400 si el usuario no tiene perfil nutricional', async () => {
    const { repository, regenerate } = setup();
    repository.getUserWithProfile.mockResolvedValue({ id: USER, nutritionProfile: null });

    await expect(regenerate()).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createOrRecoverGenerationRun).not.toHaveBeenCalled();
  });

  it('409 si el plan no es la versión current: el run queda REJECTED (PLAN_NOT_CURRENT)', async () => {
    const { repository, regenerate } = setup();
    repository.findPlanWithMeals.mockResolvedValue(currentPlan({ isCurrent: false }));

    await expect(regenerate()).rejects.toBeInstanceOf(ConflictException);
    expect(repository.transitionGenerationRun).toHaveBeenCalledWith('run-1', USER, ['PENDING'], 'REJECTED', { errorCode: 'PLAN_NOT_CURRENT' });
  });
});

describe('MealPlanRegenerationService - idempotencia (NUT-78)', () => {
  it('crea el run con kind MEAL_PLAN_REGENERATION y un requestSnapshot con planId, reason y semana', async () => {
    const { repository, regenerate } = setup();

    await regenerate().catch(() => undefined);

    const [userId, kind, , , , , requestSnapshot] = repository.createOrRecoverGenerationRun.mock.calls[0];
    expect(userId).toBe(USER);
    expect(kind).toBe('MEAL_PLAN_REGENERATION');
    expect(requestSnapshot).toEqual(expect.objectContaining({
      kind: 'MEAL_PLAN_REGENERATION', planId: PLAN, reason: 'USER_REQUESTED', weekStart: '2026-09-14',
    }));
  });

  it('la misma Idempotency-Key da el mismo hash; otra clave, otro hash', async () => {
    const { repository, regenerate } = setup();

    await regenerate(PLAN, KEY).catch(() => undefined);
    await regenerate(PLAN, KEY).catch(() => undefined);
    await regenerate(PLAN, '44444444-4444-4444-8444-444444444444').catch(() => undefined);

    const hashes = repository.createOrRecoverGenerationRun.mock.calls.map((call: any[]) => call[8]);
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[2]).not.toBe(hashes[0]);
  });

  it('misma clave + mismo pedido + run SUCCEEDED: devuelve esa misma versión (aunque ya no sea current), sin regenerar', async () => {
    const { repository, regenerate, snapshotFor } = setup();
    const snapshot = await snapshotFor();
    repository.findPlanWithMeals.mockResolvedValue(currentPlan({ isCurrent: false }));
    repository.createOrRecoverGenerationRun.mockResolvedValue({
      run: { id: 'run-1', status: 'SUCCEEDED', requestSnapshot: snapshot }, wasCreated: false,
    });
    repository.findPlanByGenerationRunId.mockResolvedValue(regeneratedVersion());

    const response: any = await regenerate();

    expect(repository.findPlanByGenerationRunId).toHaveBeenCalledWith('run-1', USER);
    expect(response).toEqual(expect.objectContaining({ id: 'plan-2', version: 2, supersedesId: PLAN, generationRunId: 'run-1' }));
    // La metadata privada de tracking de la imagen nunca sale (NUT-83).
    expect(JSON.stringify(response)).not.toContain('tracking');
    expect(repository.transitionGenerationRun).not.toHaveBeenCalled();
  });

  it('la misma clave en otro plan → 409', async () => {
    const { repository, regenerate, snapshotFor } = setup();
    const snapshot = await snapshotFor('otro-plan');
    repository.createOrRecoverGenerationRun.mockResolvedValue({
      run: { id: 'run-1', status: 'SUCCEEDED', requestSnapshot: snapshot }, wasCreated: false,
    });

    await expect(regenerate()).rejects.toBeInstanceOf(ConflictException);
    expect(repository.findPlanByGenerationRunId).not.toHaveBeenCalled();
  });

  it('la misma clave todavía en curso (PENDING reciente) → 409', async () => {
    const { repository, regenerate, snapshotFor } = setup();
    const snapshot = await snapshotFor();
    repository.createOrRecoverGenerationRun.mockResolvedValue({
      run: { id: 'run-1', status: 'PENDING', startedAt: new Date(), requestSnapshot: snapshot }, wasCreated: false,
    });

    await expect(regenerate()).rejects.toBeInstanceOf(ConflictException);
    expect(repository.transitionGenerationRun).not.toHaveBeenCalled();
  });

  it('un PENDING más viejo que el TTL pasa a EXPIRED y la regeneración arranca con un run nuevo', async () => {
    const { repository, regenerate, snapshotFor } = setup();
    const snapshot = await snapshotFor();
    repository.createOrRecoverGenerationRun
      .mockResolvedValueOnce({ run: { id: 'run-stale', status: 'PENDING', startedAt: new Date(Date.now() - 11 * 60_000), requestSnapshot: snapshot }, wasCreated: false })
      .mockResolvedValueOnce({ run: { id: 'run-2', status: 'PENDING' }, wasCreated: true });

    await regenerate().catch(() => undefined);

    expect(repository.transitionGenerationRun).toHaveBeenCalledWith('run-stale', USER, ['PENDING'], 'EXPIRED', { errorCode: 'PENDING_TIMEOUT' });
    expect(repository.createOrRecoverGenerationRun).toHaveBeenCalledTimes(2);
  });

  it('misma clave y run SUCCEEDED, pero la versión ya no existe (se borró) → 409', async () => {
    const { repository, regenerate, snapshotFor } = setup();
    const snapshot = await snapshotFor();
    repository.createOrRecoverGenerationRun.mockResolvedValue({
      run: { id: 'run-1', status: 'SUCCEEDED', requestSnapshot: snapshot }, wasCreated: false,
    });
    repository.findPlanByGenerationRunId.mockResolvedValue(null);

    await expect(regenerate()).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('MealPlanRegenerationService - regeneración (NUT-78)', () => {
  it('201: versión nueva completa (version + 1, isCurrent, supersedesId, generationRunId), en una sola transacción', async () => {
    const { repository, composer, regenerate } = setup();
    repository.findPlanByGenerationRunId.mockResolvedValue({ ...regeneratedVersion(), isCurrent: true });

    const response: any = await regenerate();

    expect(composer.composeWeeklyProposal).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER, runId: 'run-1', weekStart: WEEK, weekStartStr: '2026-09-14',
    }));
    expect(repository.updatePlanTransaction).toHaveBeenCalledTimes(1);
    // Control optimista: la versión leída y su updatedAt (un reemplazo de NUT-77 en el medio → 409).
    expect(repository.updatePlanTransaction).toHaveBeenCalledWith(USER, WEEK, proposal().dto.days, 'run-1', {
      expectedPlanId: PLAN, expectedPlanUpdatedAt: READ_AT, recipeOrigin: 'AI', validationSnapshot: SUMMARY,
    });
    expect(response).toEqual(expect.objectContaining({ id: 'plan-2', version: 2, isCurrent: true, supersedesId: PLAN, generationRunId: 'run-1' }));
    expect(JSON.stringify(response)).not.toContain('tracking');
  });

  it('busca las fotos antes de la transacción y registra su uso después del commit (NUT-83)', async () => {
    const { repository, images, regenerate } = setup();
    const order: string[] = [];
    images.resolveImagesOrDegrade.mockImplementation(async (days: unknown) => { order.push('images'); return days; });
    repository.updatePlanTransaction.mockImplementation(async () => { order.push('tx'); return { planId: 'plan-2', recipesForTracking: ['r'] }; });
    images.trackNewRecipeImages.mockImplementation(async () => { order.push('track'); });

    await regenerate();

    expect(order).toEqual(['images', 'tx', 'track']);
    expect(images.trackNewRecipeImages).toHaveBeenCalledWith(['r']);
  });

  it('si la primera propuesta es igual a la versión anterior, reintenta una vez y usa la segunda', async () => {
    const { repository, composer, regenerate } = setup();
    composer.composeWeeklyProposal
      .mockResolvedValueOnce(proposal(meal('ENSALADA DE QUINOA')))
      .mockResolvedValueOnce(proposal(meal('Wok de verduras')));

    await regenerate();

    expect(composer.composeWeeklyProposal).toHaveBeenCalledTimes(2);
    expect(repository.updatePlanTransaction.mock.calls[0][2]).toEqual(proposal(meal('Wok de verduras')).dto.days);
  });

  it('422 NO_DIFFERENT_PROPOSAL si tras 2 generaciones no cambió ninguna comida: run REJECTED, sin escribir nada', async () => {
    const { repository, composer, images, regenerate } = setup();
    composer.composeWeeklyProposal.mockResolvedValue(proposal(meal('Ensalada de quinoa')));

    await expect(regenerate()).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(composer.composeWeeklyProposal).toHaveBeenCalledTimes(2);
    expect(repository.transitionGenerationRun).toHaveBeenCalledWith('run-1', USER, ['PENDING'], 'REJECTED', {
      errorCode: 'NO_DIFFERENT_PROPOSAL',
      validationSnapshot: { stage: 'difference', codes: ['NO_DIFFERENT_PROPOSAL'], warnings: [] },
    });
    expect(repository.updatePlanTransaction).not.toHaveBeenCalled();
    expect(images.resolveImagesOrDegrade).not.toHaveBeenCalled();
  });

  it('422 de validación (NUT-74): no reintenta ni escribe', async () => {
    const { repository, composer, regenerate } = setup();
    composer.composeWeeklyProposal.mockRejectedValue(new UnprocessableEntityException('EXCLUDED_INGREDIENT'));

    await expect(regenerate()).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(composer.composeWeeklyProposal).toHaveBeenCalledTimes(1);
    expect(repository.updatePlanTransaction).not.toHaveBeenCalled();
  });

  it('503 del proveedor: no reintenta ni escribe', async () => {
    const { repository, composer, regenerate } = setup();
    composer.composeWeeklyProposal.mockRejectedValue(new ServiceUnavailableException());

    await expect(regenerate()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(composer.composeWeeklyProposal).toHaveBeenCalledTimes(1);
    expect(repository.updatePlanTransaction).not.toHaveBeenCalled();
  });

  it('concurrencia: si otra regeneración ganó (409 en la transacción), el run queda FAILED CONCURRENT_CONFLICT', async () => {
    const { repository, images, regenerate } = setup();
    repository.updatePlanTransaction.mockRejectedValue(new ConflictException());

    await expect(regenerate()).rejects.toBeInstanceOf(ConflictException);
    expect(repository.transitionGenerationRun).toHaveBeenCalledWith('run-1', USER, ['PENDING'], 'FAILED', { errorCode: 'CONCURRENT_CONFLICT' });
    expect(images.trackNewRecipeImages).not.toHaveBeenCalled();
  });

  it('si la transacción falla por otro motivo, el run queda FAILED y el error sigue de largo (Prisma revirtió todo)', async () => {
    const { repository, images, regenerate } = setup();
    repository.updatePlanTransaction.mockRejectedValue(new Error('db down'));

    await expect(regenerate()).rejects.toThrow('db down');
    expect(repository.transitionGenerationRun).toHaveBeenCalledWith('run-1', USER, ['PENDING'], 'FAILED', { errorCode: 'DOMAIN_TRANSACTION_FAILED' });
    expect(images.trackNewRecipeImages).not.toHaveBeenCalled();
  });

  it('un error inesperado en la composición deja el run FAILED (nunca PENDING)', async () => {
    const { repository, composer, regenerate } = setup();
    composer.composeWeeklyProposal.mockRejectedValue(new TypeError('bug'));

    await expect(regenerate()).rejects.toThrow('bug');
    expect(repository.transitionGenerationRun).toHaveBeenCalledWith('run-1', USER, ['PENDING'], 'FAILED', { errorCode: 'UNEXPECTED_ERROR' });
  });

  it('una comida que coincide con una receta de la versión anterior llega a la transacción con reuseRecipeId, sin receta', async () => {
    const { repository, composer, regenerate } = setup();
    const reused = { ...meal('Ensalada de quinoa'), reuseRecipeId: 'recipe-v1', recipe: undefined };
    const changed = { ...meal('Wok de verduras'), mealType: 'DINNER' };
    const days = [{ day: 'MONDAY', date: '2026-09-14', meals: [reused, changed] }];
    composer.composeWeeklyProposal.mockResolvedValue({
      dto: { weekStart: '2026-09-14', days },
      comparableDays: [{ day: 'MONDAY', date: '2026-09-14', meals: [meal('Ensalada de quinoa'), changed] }],
      summary: SUMMARY,
    });

    await regenerate();

    const persistedMeals = repository.updatePlanTransaction.mock.calls[0][2][0].meals;
    expect(persistedMeals[0]).toEqual(expect.objectContaining({ reuseRecipeId: 'recipe-v1' }));
    expect(persistedMeals[0].recipe).toBeUndefined();
  });

  it('un HttpException que el compositor no registró igual deja el run FAILED (el catch siempre intenta; sólo afecta runs PENDING)', async () => {
    const { repository, composer, regenerate } = setup();
    composer.composeWeeklyProposal.mockRejectedValue(new ServiceUnavailableException());

    await expect(regenerate()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repository.transitionGenerationRun).toHaveBeenCalledWith('run-1', USER, ['PENDING'], 'FAILED', { errorCode: 'UNEXPECTED_ERROR' });
  });

  it('si no se puede marcar el run, se devuelve el error original y queda un log estructurado sin datos del error', async () => {
    const { repository, regenerate } = setup();
    repository.updatePlanTransaction.mockRejectedValue(new ConflictException());
    repository.transitionGenerationRun.mockRejectedValue(new Error('db down: datos sensibles'));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(regenerate()).rejects.toBeInstanceOf(ConflictException);
    expect(warn).toHaveBeenCalledWith({ event: 'generation_run_fail_persist_failed', generationRunId: 'run-1', errorCode: 'CONCURRENT_CONFLICT' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('datos sensibles');
    warn.mockRestore();
  });

  it('si la versión recién creada no se puede releer (se borró en el medio), 409 explícito en vez de un 500', async () => {
    const { repository, regenerate } = setup();
    repository.findPlanByGenerationRunId.mockResolvedValue(null);

    await expect(regenerate()).rejects.toBeInstanceOf(ConflictException);
  });
});
