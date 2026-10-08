import 'reflect-metadata';
import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { DayOfWeek, MealType } from '../../../generated/prisma/client';
import { AiProviderUnavailableError } from '../gemini/gemini.service';
import { RecipeValidationService } from '../recipe-validation.service';
import { GeminiWeeklyProposalComposer } from '../weekly-proposal.composer';

const DAYS = [
  DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY, DayOfWeek.SATURDAY, DayOfWeek.SUNDAY,
];
const profile: any = { goal: 'MAINTAIN', diet: 'ALL', excludedIngredients: [], cookTimePreference: 'QUICK' };

function week(title = 'Ensalada de quinoa') {
  return DAYS.map((day, index) => ({
    day,
    date: `2026-09-${14 + index}`,
    meals: [{
      mealType: MealType.LUNCH,
      title,
      nutritionalValues: { Protein: 20, Fiber: 8, Calories: 350, Description: 'Almuerzo' },
      recipe: {
        title,
        description: 'Receta de prueba',
        prepMinutes: 10,
        cookMinutes: 15,
        ingredients: [{ name: 'Quinoa', quantity: 150, unit: 'gr' }],
        instructions: ['Cocinar'],
      },
    }],
  }));
}

function setup(raw: string | Error = JSON.stringify({ days: week() })) {
  const repository = { transitionGenerationRun: jest.fn().mockResolvedValue(1) };
  const recipes = { findByNormalizedTitles: jest.fn().mockResolvedValue([]) };
  const gemini = { generateMealPlan: raw instanceof Error ? jest.fn().mockRejectedValue(raw) : jest.fn().mockResolvedValue(raw) };
  const validation = new RecipeValidationService(recipes as any, repository as any);
  const composer = new GeminiWeeklyProposalComposer(repository as any, gemini as any, validation);
  const compose = () => composer.composeWeeklyProposal({
    userId: 'user-1', runId: 'run-1', profile, weekStart: new Date('2026-09-14T00:00:00Z'), weekStartStr: '2026-09-14',
  });
  return { repository, recipes, gemini, compose };
}

describe('GeminiWeeklyProposalComposer.composeWeeklyProposal (NUT-78, generación semanal de NUT-74)', () => {
  it('devuelve el plan validado y normalizado, las comidas para comparar y el resumen de validación', async () => {
    const { compose } = setup();

    const proposal = await compose();

    expect(proposal.dto.weekStart).toBe('2026-09-14');
    expect(proposal.dto.days).toHaveLength(7);
    expect(proposal.dto.days[0].meals[0].recipe.ingredients).toEqual([{ name: 'Quinoa', quantity: 150, unit: 'g' }]);
    expect(proposal.comparableDays[0].meals[0].recipe).toEqual(expect.objectContaining({ title: 'Ensalada de quinoa' }));
    expect(proposal.summary).toEqual({ stage: 'passed', codes: [], warnings: ['CALORIE_CHECK_SKIPPED'] });
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
