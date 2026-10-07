import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { PlansRepository } from '../plans.repository';
import { PlansService } from '../plans.service';
import { MealPlanRegenerationService } from '../meal-plan-regeneration.service';
import { RecipeValidationService } from '../recipe-validation.service';
import { RecipeImagesService } from '../recipe-images.service';

// Flujo completo de NUT-78 con el PlansRepository real sobre una base en memoria. Su $transaction
// restaura el estado si algo falla (como Prisma) y respeta el índice único parcial de versión current.

const USER = 'user-1';
const WEEK = new Date('2026-09-14T00:00:00.000Z');
const KEY = '33333333-3333-4333-8333-333333333333';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value), (key, v) => (key === 'startDate' || key === 'date' ? new Date(v) : v));

function createDb() {
  let state = {
    plans: [] as any[],
    days: [] as any[],
    meals: [] as any[],
    recipes: [] as any[],
    runs: [] as any[],
  };
  let ids = 0;
  let clock = Date.UTC(2026, 8, 14);
  let queue: Promise<unknown> = Promise.resolve();
  const id = (prefix: string) => `${prefix}-${++ids}`;
  const sameDate = (a: Date, b: Date) => new Date(a).getTime() === new Date(b).getTime();
  const withDays = (plan: any) => plan && {
    ...plan,
    days: state.days.filter(day => day.mealPlanId === plan.id).map(day => ({
      ...day,
      meals: state.meals.filter(meal => meal.dayId === day.id).map(meal => ({
        ...meal,
        recipe: state.recipes.find(recipe => recipe.id === meal.recipeId) ?? null,
      })),
    })),
  };
  const matches = (plan: any, where: any) => Object.entries(where).every(([key, value]) =>
    value instanceof Date ? sameDate(plan[key], value) : plan[key] === value);

  const client: any = {
    mealPlan: {
      findFirst: async ({ where }: any) => withDays(state.plans.find(plan => matches(plan, where)) ?? null),
      findUnique: async ({ where }: any) => withDays(state.plans.find(plan => plan.id === where.id) ?? null),
      updateMany: async ({ where, data }: any) => {
        const found = state.plans.filter(plan => matches(plan, where));
        // Como @updatedAt de Prisma: toda escritura actualiza updatedAt.
        found.forEach(plan => Object.assign(plan, { updatedAt: new Date(++clock) }, data));
        return { count: found.length };
      },
      create: async ({ data }: any) => {
        // Índice único parcial meal_plans_user_week_current_key.
        if (data.isCurrent !== false && state.plans.some(plan => plan.isCurrent && plan.userId === data.userId && sameDate(plan.startDate, data.startDate))) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        const plan = { id: id('plan'), version: 1, isCurrent: true, supersedesId: null, generationRunId: null, updatedAt: new Date(++clock), ...data };
        state.plans.push(plan);
        return plan;
      },
      delete: async ({ where }: any) => {
        // Como Prisma: el where (id + filtros extra) tiene que coincidir; si no, P2025.
        const plan = state.plans.find(p => matches(p, where));
        if (!plan) throw Object.assign(new Error('Record to delete does not exist'), { code: 'P2025' });
        const dayIds = state.days.filter(day => day.mealPlanId === where.id).map(day => day.id);
        state.meals = state.meals.filter(meal => !dayIds.includes(meal.dayId));
        state.days = state.days.filter(day => day.mealPlanId !== where.id);
        state.plans = state.plans.filter(p => p.id !== where.id);
        return plan;
      },
    },
    mealPlanDay: { create: async ({ data }: any) => { const day = { id: id('day'), ...data }; state.days.push(day); return day; } },
    plannedMeal: { create: async ({ data }: any) => { const meal = { id: id('meal'), ...data }; state.meals.push(meal); return meal; } },
    recipe: { create: async ({ data }: any) => { const recipe = { id: id('recipe'), ...data }; state.recipes.push(recipe); return recipe; } },
    generationRun: {
      updateMany: async ({ where, data }: any) => {
        const found = state.runs.filter(run => run.id === where.id && run.userId === where.userId && where.status.in.includes(run.status));
        found.forEach(run => Object.assign(run, data));
        return { count: found.length };
      },
    },
    // Como Postgres con los locks de fila: las transacciones se ejecutan de a una, y un error revierte todo.
    $transaction: (callback: (tx: any) => Promise<unknown>) => {
      const run = queue.then(async () => {
        const snapshot = clone(state);
        try {
          return await callback(client);
        } catch (error) {
          state = snapshot; // rollback completo
          throw error;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
  return { client, get state() { return state; } };
}

const nutritionalValues = { Protein: 20, Fiber: 8, Calories: 350, Description: 'Almuerzo' };
const recipe = (title: string) => ({
  title, description: 'Receta', prepMinutes: 10, cookMinutes: 10,
  ingredients: [{ name: 'Quinoa', quantity: 100, unit: 'g' }], instructions: ['Cocinar'],
});

async function seedVersionOne(db: ReturnType<typeof createDb>) {
  const repository = new PlansRepository(db.client);
  db.state.runs.push({ id: 'run-v1', userId: USER, status: 'PENDING' });
  await repository.createPlanTransaction(USER, WEEK, [
    { day: 'MONDAY', date: '2026-09-14', meals: [
      { mealType: 'LUNCH', title: 'Ensalada de quinoa', nutritionalValues, recipe: recipe('Ensalada de quinoa') },
      { mealType: 'DINNER', title: 'Sopa de calabaza', nutritionalValues, recipe: recipe('Sopa de calabaza') },
    ] },
  ] as any, 'run-v1');
  return db.state.plans[0];
}

function setup() {
  const db = createDb();
  const repository = new PlansRepository(db.client);
  // Lo que no es parte del flujo de planes se mockea: el perfil y la creación del run.
  repository.getUserWithProfile = jest.fn().mockResolvedValue({
    id: USER, nutritionProfile: { goal: 'MAINTAIN', diet: 'ALL', excludedIngredients: [], cookTimePreference: 'QUICK' },
  }) as any;
  let runs = 0;
  repository.createOrRecoverGenerationRun = jest.fn().mockImplementation(async () => {
    const run = { id: runs++ === 0 ? 'run-new' : `run-new-${runs}`, userId: USER, status: 'PENDING' };
    db.state.runs.push(run);
    return { run, wasCreated: true };
  }) as any;
  const unsplash: any = { searchAndSelectImages: jest.fn(async (days: unknown) => days), trackDownload: jest.fn() };
  const config: any = { get: () => undefined };
  const composer = { composeWeeklyProposal: jest.fn() };
  const images = new RecipeImagesService(repository, unsplash);
  const plansService = new PlansService(repository, images, config, composer as any);
  const validation = new RecipeValidationService({ findByNormalizedTitles: jest.fn() } as any, repository);
  const regeneration = new MealPlanRegenerationService(repository, config, composer as any, images, validation);
  return { db, repository, plansService, regeneration, composer };
}

// Propuesta nueva: el almuerzo reutiliza la receta de la versión anterior y la cena cambia.
function proposalReusing(previousRecipeId: string) {
  const lunch = { mealType: 'LUNCH', title: 'Ensalada de quinoa', nutritionalValues, reuseRecipeId: previousRecipeId };
  const dinner = { mealType: 'DINNER', title: 'Wok de verduras', nutritionalValues, recipe: recipe('Wok de verduras') };
  return {
    dto: { weekStart: '2026-09-14', days: [{ day: 'MONDAY', date: '2026-09-14', meals: [lunch, dinner] }] },
    comparableDays: [{ day: 'MONDAY', date: '2026-09-14', meals: [{ ...lunch, recipe: recipe('Ensalada de quinoa') }, dinner] }],
    summary: { stage: 'passed', codes: [], warnings: [] },
  };
}

describe('Regenerar la semana - flujo completo (NUT-78)', () => {
  it('crea la versión 2, la anterior queda intacta y no current, y GET current devuelve sólo la nueva', async () => {
    const { db, plansService, regeneration, composer } = setup();
    const v1 = await seedVersionOne(db);
    const v1Snapshot = clone(db.state.days.concat(db.state.meals));
    const lunchRecipeId = db.state.meals.find(meal => meal.mealType === 'LUNCH').recipeId;
    composer.composeWeeklyProposal.mockResolvedValue(proposalReusing(lunchRecipeId));

    const response: any = await regeneration.regenerate(USER, v1.id, KEY, { reason: 'USER_REQUESTED' } as any);

    // Versión nueva completa.
    expect(response).toEqual(expect.objectContaining({
      version: 2, isCurrent: true, supersedesId: v1.id, generationRunId: 'run-new', userId: USER,
    }));
    expect(response.id).not.toBe(v1.id);
    expect(response.days[0].meals).toHaveLength(2);

    // La anterior: no current, no borrada, sin cambios en sus días ni comidas.
    const previous = db.state.plans.find(plan => plan.id === v1.id);
    expect(previous).toEqual(expect.objectContaining({ isCurrent: false, version: 1 }));
    expect(db.state.days.concat(db.state.meals).filter(row => v1Snapshot.some((old: any) => old.id === row.id))).toEqual(v1Snapshot);

    // GET current: sólo la versión nueva.
    const current: any = await plansService.getPlanByWeek(USER, '2026-09-14');
    expect(current.id).toBe(response.id);
    expect(current.version).toBe(2);

    // Recetas reutilizadas no se duplican: el almuerzo nuevo apunta a la receta de la v1; sólo se creó la del wok.
    const newLunch = current.days[0].meals.find((meal: any) => meal.mealType === 'LUNCH');
    expect(newLunch.recipeId).toBe(lunchRecipeId);
    expect(db.state.recipes).toHaveLength(3);

    // El run quedó SUCCEEDED en la misma transacción.
    expect(db.state.runs.find(run => run.id === 'run-new').status).toBe('SUCCEEDED');
  });

  it('si falla un paso de la transacción, se revierte todo: la anterior sigue current y no quedan planes ni recetas parciales', async () => {
    const { db, regeneration, composer, plansService } = setup();
    const v1 = await seedVersionOne(db);
    const before = clone(db.state);
    composer.composeWeeklyProposal.mockResolvedValue(proposalReusing(db.state.meals[0].recipeId));
    const createMeal = db.client.plannedMeal.create;
    let calls = 0;
    db.client.plannedMeal.create = async (args: any) => {
      if (++calls === 2) throw new Error('db down');
      return createMeal(args);
    };

    await expect(regeneration.regenerate(USER, v1.id, KEY, { reason: 'USER_REQUESTED' } as any)).rejects.toThrow('db down');

    expect(db.state.plans).toEqual(before.plans);
    expect(db.state.days).toEqual(before.days);
    expect(db.state.meals).toEqual(before.meals);
    expect(db.state.recipes).toEqual(before.recipes);
    expect((await plansService.getPlanByWeek(USER, '2026-09-14')).id).toBe(v1.id);
  });

  it('dos regeneraciones simultáneas del mismo plan con distinta key: una gana (201) y la otra recibe 409', async () => {
    const { db, regeneration, composer } = setup();
    const v1 = await seedVersionOne(db);
    composer.composeWeeklyProposal.mockResolvedValue(proposalReusing(db.state.meals[0].recipeId));

    const outcomes = await Promise.allSettled([
      regeneration.regenerate(USER, v1.id, KEY, { reason: 'USER_REQUESTED' } as any),
      regeneration.regenerate(USER, v1.id, '44444444-4444-4444-8444-444444444444', { reason: 'USER_REQUESTED' } as any),
    ]);

    expect(outcomes.map(outcome => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(outcomes.find(outcome => outcome.status === 'rejected')).toEqual(
      expect.objectContaining({ reason: expect.any(ConflictException) }),
    );
    expect(db.state.plans.filter(plan => plan.isCurrent)).toHaveLength(1);
    expect(db.state.plans).toHaveLength(2);
  });

  it('si un reemplazo de comida (NUT-77) cambia el plan mientras se regenera, 409 y nada se escribe', async () => {
    const { db, regeneration, composer, plansService } = setup();
    const v1 = await seedVersionOne(db);
    const proposal = proposalReusing(db.state.meals[0].recipeId);
    composer.composeWeeklyProposal.mockImplementation(async () => {
      // Mientras Gemini genera, otro request reemplaza una comida de v1 (actualiza su updatedAt).
      await db.client.mealPlan.updateMany({ where: { id: v1.id }, data: {} });
      return proposal;
    });
    const before = clone(db.state);

    await expect(regeneration.regenerate(USER, v1.id, KEY, { reason: 'USER_REQUESTED' } as any)).rejects.toBeInstanceOf(ConflictException);

    expect(db.state.plans.map(plan => plan.id)).toEqual(before.plans.map((plan: any) => plan.id));
    expect(db.state.recipes).toHaveLength(before.recipes.length);
    expect((await plansService.getPlanByWeek(USER, '2026-09-14')).id).toBe(v1.id);
  });

  it('borrar la versión current no borra recetas: la anterior y sus recetas quedan intactas', async () => {
    const { db, regeneration, composer, plansService } = setup();
    const v1 = await seedVersionOne(db);
    composer.composeWeeklyProposal.mockResolvedValue(proposalReusing(db.state.meals[0].recipeId));
    await regeneration.regenerate(USER, v1.id, KEY, { reason: 'USER_REQUESTED' } as any);
    const recipesBefore = clone(db.state.recipes);

    await plansService.deletePlan(USER, '2026-09-14');

    expect(db.state.recipes).toEqual(recipesBefore);
    expect(db.state.plans).toEqual([expect.objectContaining({ id: v1.id, isCurrent: false })]);
    expect(db.state.meals.every((meal: any) => db.state.recipes.some((r: any) => r.id === meal.recipeId))).toBe(true);
  });
});
