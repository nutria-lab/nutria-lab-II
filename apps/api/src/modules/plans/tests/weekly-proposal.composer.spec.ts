import 'reflect-metadata';
import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { DayOfWeek, MealType } from '../../../generated/prisma/client';
import { AiProviderUnavailableError } from '../../openai/openai.service';
import { RecipeValidationService } from '../recipe-validation.service';
import { OpenAIWeeklyProposalComposer } from '../weekly-proposal.composer';

const DAYS = [
  DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY, DayOfWeek.SATURDAY, DayOfWeek.SUNDAY,
];
const profile: any = { goal: 'MAINTAIN', diet: 'ALL', excludedIngredients: [], cookTimePreference: 'QUICK' };

function week(title = 'Ensalada de quinoa') {
  return DAYS.map((day, index) => ({
    day,
    date: `2026-09-${14 + index}`,
    meals: [MealType.LUNCH, MealType.BREAKFAST, MealType.SNACK, MealType.DINNER].map((mealType) => {
      const mealTitle = mealType === MealType.LUNCH ? title : `${title} ${mealType}`;
      return {
        mealType,
        title: mealTitle,
        nutritionalValues: { Protein: 20, Fiber: 8, Calories: 350, Description: mealType },
        recipe: {
          title: mealTitle,
          description: 'Receta de prueba',
          prepMinutes: 10,
          cookMinutes: 15,
          ingredients: [{ name: 'Quinoa', quantity: 150, unit: 'gr' }],
          instructions: ['Cocinar'],
        },
      };
    }),
  }));
}

function setup(raw: string | Error = JSON.stringify({ days: week() }), inputProfile: any = profile) {
  const repository = { transitionGenerationRun: jest.fn().mockResolvedValue(1) };
  const recipes = { findByNormalizedTitles: jest.fn().mockResolvedValue([]) };
  const openai = { generateMealPlan: raw instanceof Error ? jest.fn().mockRejectedValue(raw) : jest.fn().mockResolvedValue(raw) };
  const validation = new RecipeValidationService(recipes as any, repository as any);
  const composer = new OpenAIWeeklyProposalComposer(repository as any, openai as any, validation);
  const compose = () => composer.composeWeeklyProposal({
    userId: 'user-1', runId: 'run-1', profile: inputProfile, weekStart: new Date('2026-09-14T00:00:00Z'), weekStartStr: '2026-09-14',
  } as any);
  return { repository, recipes, openai, compose };
}

describe('OpenAIWeeklyProposalComposer.composeWeeklyProposal (NUT-78, generación semanal de NUT-74)', () => {
  it('passes the original profile to the model and accepts its dietary choice', async () => {
    const inputProfile = { ...profile, excludedIngredients: ['DAIRY'] };
    const originalProfile = structuredClone(inputProfile);
    const raw = JSON.stringify({ days: week('Crema de cacahuate') });
    const { openai, compose } = setup(raw, inputProfile);

    const proposal = await compose();

    expect(proposal.dto.days).toHaveLength(7);
    expect(openai.generateMealPlan).toHaveBeenCalledWith(inputProfile, new Date('2026-09-14T00:00:00Z'), expect.any(Function));
    expect(openai.generateMealPlan.mock.calls[0][0]).toBe(inputProfile);
    expect(inputProfile).toEqual(originalProfile);
  });

  it.each([undefined, true])('accepts the generated recipe with excluded dairy (%p)', async () => {
    const inputProfile = { ...profile, excludedIngredients: ['DAIRY'] };
    const { repository, openai, compose } = setup(JSON.stringify({ days: week('Queso parmesano') }), inputProfile);

    const proposal = await compose();
    expect(proposal.dto.days[0].meals[0].title).toBe('Queso parmesano');
    expect(openai.generateMealPlan).toHaveBeenCalledWith(inputProfile, expect.any(Date), expect.any(Function));
    expect(repository.transitionGenerationRun).not.toHaveBeenCalledWith('run-1', 'user-1', ['PENDING'], 'REJECTED', expect.anything());
  });

  it('devuelve el plan validado y normalizado, las comidas para comparar y el resumen de validación', async () => {
    const { compose } = setup();

    const proposal = await compose();

    expect(proposal.dto.weekStart).toBe('2026-09-14');
    expect(proposal.dto.days).toHaveLength(7);
    expect(proposal.dto.days[0].meals[0].recipe.ingredients).toEqual([{ name: 'Quinoa', quantity: 150, unit: 'g' }]);
    expect(proposal.comparableDays[0].meals[0].recipe).toEqual(expect.objectContaining({ title: 'Ensalada de quinoa' }));
    expect(proposal.summary).toEqual({ stage: 'passed', codes: [], warnings: ['CALORIE_CHECK_SKIPPED'] });
  });

  it('acepta los cuatro tipos una sola vez aunque vengan en otro orden', async () => {
    const shuffled = week().map((day) => ({ ...day, meals: [...day.meals].reverse() }));
    const { compose } = setup(JSON.stringify({ days: shuffled }));

    const proposal = await compose();

    expect(proposal.dto.days).toHaveLength(7);
    expect(proposal.dto.days.every(({ meals }) => meals.length === 4)).toBe(true);
    for (const day of proposal.dto.days) {
      expect(day.meals.map(({ mealType }) => mealType).sort()).toEqual([
        MealType.BREAKFAST, MealType.DINNER, MealType.LUNCH, MealType.SNACK,
      ].sort());
    }
  });

  describe('rechaza semanas que no tengan cada tipo de comida exactamente una vez', () => {
    const invalidMealDays = [
      ...Object.values(MealType).map((missingType) => [
        `falta ${missingType}`,
        (validMeals: any[]) => validMeals.filter((meal) => meal.mealType !== missingType),
      ] as const),
      ['duplicado que deja otro tipo ausente', (validMeals: any[]) => [...validMeals.filter((meal) => meal.mealType !== MealType.SNACK), { ...validMeals[0] }]] as const,
      ['duplicado además de los cuatro tipos', (validMeals: any[]) => [...validMeals, { ...validMeals[0] }]] as const,
      ['tipo desconocido', (validMeals: any[]) => validMeals.map((meal, index) => index === 0 ? { ...meal, mealType: 'BRUNCH' } : meal)] as const,
    ];

    it.each(invalidMealDays)('%s → rechaza antes de validar recetas', async (_label, makeMeals) => {
      const invalid = week().map((day, index) => index === 0 ? { ...day, meals: makeMeals(day.meals) } : day);
      const { repository, recipes, compose } = setup(JSON.stringify({ days: invalid }));

      await expect(compose()).rejects.toBeInstanceOf(UnprocessableEntityException);

      expect(recipes.findByNormalizedTitles).not.toHaveBeenCalled();
      expect(repository.transitionGenerationRun).toHaveBeenCalledWith('run-1', 'user-1', ['PENDING'], 'REJECTED', {
        errorCode: 'AI_INVALID_SCHEMA',
        validationSnapshot: { stage: 'schema', codes: ['AI_INVALID_SCHEMA'], warnings: [] },
      });
    });
  });

  it('una comida duplicada del catálogo se persiste con reuseRecipeId, pero se compara con su receta', async () => {
    const { recipes, compose } = setup();
    recipes.findByNormalizedTitles.mockResolvedValue([
      { id: 'recipe-v1', title: 'Ensalada de quinoa', description: 'x', ingredients: [{ name: 'Quinoa' }], instructions: [] },
    ]);

    const proposal = await compose();

    expect((proposal.dto.days[0].meals[0] as any).reuseRecipeId).toBe('recipe-v1');
    expect(proposal.dto.days[0].meals[0].recipe).toBeUndefined();
    expect(proposal.comparableDays[0].meals[0].recipe).toEqual(expect.objectContaining({ title: 'Ensalada de quinoa' }));
  });

  it('proveedor caído → 503 y run FAILED con el motivo', async () => {
    const { repository, compose } = setup(new AiProviderUnavailableError('AI_TIMEOUT'));

    await expect(compose()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repository.transitionGenerationRun).toHaveBeenCalledWith('run-1', 'user-1', ['PENDING'], 'FAILED', { errorCode: 'AI_TIMEOUT' });
  });

  it('contenido inválido → 422 y run REJECTED con el código de NUT-74', async () => {
    const { repository, compose } = setup('no es json');

    await expect(compose()).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repository.transitionGenerationRun).toHaveBeenCalledWith('run-1', 'user-1', ['PENDING'], 'REJECTED', expect.objectContaining({
      errorCode: 'INVALID_JSON',
    }));
  });
});
