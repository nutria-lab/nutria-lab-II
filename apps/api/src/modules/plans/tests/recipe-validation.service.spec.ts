import { Logger } from '@nestjs/common';
import { RecipeValidationService, mealToDraftInput } from '../recipe-validation.service';
import { generatedMeal, generatedRecipe } from '../../recipe/tests/recipe-validation.fixtures';

const RUN = { id: 'run-1', userId: 'user-1', provider: 'google-generative-ai', model: 'gemini-3.5-flash' };
const NO_RESTRICTIONS = { excludedIngredients: [] };

function setup() {
  const recipes = { findByNormalizedTitles: jest.fn().mockResolvedValue([]) };
  const plans = { transitionGenerationRun: jest.fn().mockResolvedValue(1) };
  const service = new RecipeValidationService(recipes as any, plans as any);
  return { recipes, plans, service };
}

describe('RecipeValidationService.validateDrafts (NUT-74)', () => {
  it('busca en el catálogo sólo los títulos normalizados de los drafts, sin repetir, en una consulta', async () => {
    const { recipes, service } = setup();

    await service.validateDrafts(
      [generatedRecipe({ title: 'Ensalada de Quínoa!' }), generatedRecipe({ title: '  ensalada de quinoa ' }), { title: 42 }],
      NO_RESTRICTIONS,
    );

    expect(recipes.findByNormalizedTitles).toHaveBeenCalledTimes(1);
    expect(recipes.findByNormalizedTitles).toHaveBeenCalledWith(['ensalada de quinoa']);
  });

  it('sin títulos para buscar no consulta la base', async () => {
    const { recipes, service } = setup();

    await service.validateDrafts([{ title: '' }], NO_RESTRICTIONS);

    expect(recipes.findByNormalizedTitles).not.toHaveBeenCalled();
  });

  it('un duplicado exacto del catálogo vuelve como DUPLICATE_RECIPE con el id existente', async () => {
    const { recipes, service } = setup();
    recipes.findByNormalizedTitles.mockResolvedValue([
      { id: 'recipe-cat', title: 'Ensalada de quinoa', description: 'Del catálogo', ingredients: [{ name: 'Quinoa' }, { name: 'Tomate' }] },
    ]);

    const [result] = await service.validateDrafts([generatedRecipe()], NO_RESTRICTIONS);

    expect(result).toEqual({ valid: false, errors: [expect.objectContaining({ code: 'DUPLICATE_RECIPE', existingRecipeId: 'recipe-cat' })] });
  });

  it('nunca ofrece para reutilizar una receta del catálogo que viola las restricciones del perfil', async () => {
    const { recipes, service } = setup();
    recipes.findByNormalizedTitles.mockResolvedValue([
      { id: 'recipe-nuts', title: 'Ensalada de quinoa', description: 'Con salsa de maní', ingredients: [{ name: 'Quinoa' }, { name: 'Tomate' }] },
    ]);

    const [result] = await service.validateDrafts([generatedRecipe()], { excludedIngredients: ['NUTS'] });

    expect(result.valid).toBe(true);
  });

  it('pasa las restricciones del perfil al validador', async () => {
    const { service } = setup();

    const [result] = await service.validateDrafts([generatedRecipe({ title: 'Budín de nueces' })], { excludedIngredients: ['NUTS'] });

    expect(result).toEqual({ valid: false, errors: [expect.objectContaining({ code: 'EXCLUDED_INGREDIENT' })] });
  });

  it('el filtro de seguridad del catálogo también revisa los pasos de la receta', async () => {
    const { recipes, service } = setup();
    recipes.findByNormalizedTitles.mockResolvedValue([{
      id: 'recipe-steps', title: 'Ensalada de quinoa', description: 'Del catálogo',
      ingredients: [{ name: 'Quinoa' }, { name: 'Tomate' }], instructions: ['Agregar maní picado'],
    }]);

    const [result] = await service.validateDrafts([generatedRecipe()], { excludedIngredients: ['NUTS'] });

    expect(result.valid).toBe(true);
  });

  it('cada draft se valida por separado (repetir una comida en el plan no es duplicado)', async () => {
    const { service } = setup();

    const results = await service.validateDrafts([generatedRecipe(), generatedRecipe()], NO_RESTRICTIONS);

    expect(results.map(result => result.valid)).toEqual([true, true]);
  });
});

describe('RecipeValidationService.reject / record (GenerationRun de NUT-75)', () => {
  const summary = { stage: 'profile' as const, codes: ['EXCLUDED_INGREDIENT' as const, 'MISSING_FIELD' as const], warnings: [] };

  afterEach(() => jest.restoreAllMocks());

  it('reject pasa el run a REJECTED con el primer código como errorCode y el snapshot', async () => {
    const { plans, service } = setup();

    await service.reject(RUN, summary);

    expect(plans.transitionGenerationRun).toHaveBeenCalledWith('run-1', 'user-1', ['PENDING'], 'REJECTED', {
      errorCode: 'EXCLUDED_INGREDIENT',
      validationSnapshot: summary,
    });
  });

  it('reject escribe un log estructurado por código, sin prompt, perfil ni texto generado', async () => {
    const { service } = setup();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await service.reject(RUN, summary);

    expect(warn.mock.calls.map(call => call[0])).toEqual([
      { event: 'recipe_validation_rejected', code: 'EXCLUDED_INGREDIENT', provider: RUN.provider, model: RUN.model, generationRunId: 'run-1' },
      { event: 'recipe_validation_rejected', code: 'MISSING_FIELD', provider: RUN.provider, model: RUN.model, generationRunId: 'run-1' },
    ]);
  });

  it('si no se puede marcar el run, reject no tapa el error original (no lanza) pero lo deja logueado, sin datos', async () => {
    const { plans, service } = setup();
    plans.transitionGenerationRun.mockRejectedValue(new Error('db down: datos sensibles'));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(service.reject(RUN, summary)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith({ event: 'recipe_validation_reject_persist_failed', generationRunId: 'run-1' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('datos sensibles');
  });

  it('si el run ya no estaba PENDING (0 filas), también lo deja logueado', async () => {
    const { plans, service } = setup();
    plans.transitionGenerationRun.mockResolvedValue(0);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await service.reject(RUN, summary);

    expect(warn).toHaveBeenCalledWith({ event: 'recipe_validation_reject_persist_failed', generationRunId: 'run-1' });
  });

  it.each([
    ['AI_INVALID_SCHEMA', 'schema'],
    ['CRITERIA_NOT_MET', 'criteria'],
    ['NO_DIFFERENT_PROPOSAL', 'difference'],
  ] as const)('rejectWithCode(%s) registra snapshot y log como cualquier otro rechazo', async (code, stage) => {
    const { plans, service } = setup();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await service.rejectWithCode(RUN, code);

    expect(plans.transitionGenerationRun).toHaveBeenCalledWith('run-1', 'user-1', ['PENDING'], 'REJECTED', {
      errorCode: code,
      validationSnapshot: { stage, codes: [code], warnings: [] },
    });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'recipe_validation_rejected', code }));
  });
});

describe('mealToDraftInput', () => {
  it('arma el draft con la receta, los macros y el título de la comida', () => {
    const meal = generatedMeal();

    expect(mealToDraftInput(meal)).toEqual({ ...meal.recipe, nutritionalValues: meal.nutritionalValues, mealTitle: meal.title });
  });

  it('una comida sin receta da un draft sin campos de receta (el validador responde MISSING_FIELD)', () => {
    expect(mealToDraftInput({ title: 'Cena', nutritionalValues: { Calories: 1 } })).toEqual({
      nutritionalValues: { Calories: 1 },
      mealTitle: 'Cena',
    });
    expect(mealToDraftInput(null)).toEqual({});
  });
});
