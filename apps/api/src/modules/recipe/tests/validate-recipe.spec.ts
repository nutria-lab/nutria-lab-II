import {
  reusableDuplicate,
  reusableRecipeId,
  summarizeParseFailure,
  summarizeResults,
  validateRecipe,
  validateRecipes,
} from '../validation/validate-recipe';
import type { RecipeValidationContext, ValidationResult } from '../validation/recipe-validation.types';
import { generatedMeal, generatedRecipe, NO_RESTRICTIONS, recipeWithIngredient } from './recipe-validation.fixtures';

const errorsOf = (result: ValidationResult) => (result.valid ? [] : result.errors);
const codesOf = (result: ValidationResult) => errorsOf(result).map(error => error.code);
const fieldsOf = (result: ValidationResult) => errorsOf(result).map(error => error.field);
const warningsOf = (result: ValidationResult) => (result.valid ? result.warnings.map(warning => warning.code) : []);
const normalized = (result: ValidationResult) => {
  if (!result.valid) throw new Error(`expected a valid recipe, got ${JSON.stringify(result.errors)}`);
  return result.normalizedRecipe;
};
const withNuts: RecipeValidationContext = { excludedIngredients: ['NUTS'] };

describe('validateRecipe - receta válida', () => {
  it('devuelve la receta normalizada, sin warnings', () => {
    const result = validateRecipe(generatedRecipe(), NO_RESTRICTIONS);

    expect(result).toEqual({
      valid: true,
      warnings: [],
      normalizedRecipe: {
        title: 'Ensalada de quinoa',
        description: 'Quinoa con vegetales frescos',
        prepMinutes: 15,
        cookMinutes: 10,
        ingredients: [
          { name: 'Quinoa', quantity: 150, unit: 'g' },
          { name: 'Tomate', quantity: 2, unit: 'unidad' },
        ],
        instructions: ['Cocinar la quinoa', 'Mezclar con los vegetales'],
        categories: ['VEGAN'],
        properties: ['Alto en fibra'],
        nutritionalValues: { calories: 410, protein: 14, carbs: 62, fat: 12 },
      },
    });
  });

  it('descarta los campos de más sin rechazar', () => {
    const recipe = generatedRecipe({
      secret: 'no debería persistirse',
      ingredients: [{ name: 'Quinoa', quantity: 150, unit: 'g', brand: 'X' }],
      nutritionalValues: { calories: 410, protein: 14, carbs: 62, fat: 12, sodium: 3 },
    });

    const recipeOut = normalized(validateRecipe(recipe, NO_RESTRICTIONS));

    expect(recipeOut).not.toHaveProperty('secret');
    expect(recipeOut.ingredients[0]).toEqual({ name: 'Quinoa', quantity: 150, unit: 'g' });
    expect(recipeOut.nutritionalValues).not.toHaveProperty('sodium');
  });

  it('acepta los macros de una comida de Gemini (Protein/Fiber/Calories/Description) y conserva el título de la comida', () => {
    const meal = generatedMeal();
    const recipeOut = normalized(validateRecipe(
      { ...meal.recipe, nutritionalValues: meal.nutritionalValues, mealTitle: meal.title },
      NO_RESTRICTIONS,
    ));

    expect(recipeOut.nutritionalValues).toEqual({ calories: 420, protein: 18, fiber: 7, description: 'Cena liviana' });
    expect(recipeOut.mealTitle).toBe('Wok de verduras');
    expect(recipeOut.categories).toEqual([]);
    expect(recipeOut.properties).toEqual([]);
  });

  it('acepta instructions como un único string (igual que el DTO del plan)', () => {
    expect(normalized(validateRecipe(generatedRecipe({ instructions: '  Mezclar todo ' }), NO_RESTRICTIONS)).instructions)
      .toEqual(['Mezclar todo']);
  });

  it('no puede recibir un input que no es objeto', () => {
    expect(codesOf(validateRecipe(null, NO_RESTRICTIONS))).toEqual(['MISSING_FIELD']);
    expect(codesOf(validateRecipe('receta', NO_RESTRICTIONS))).toEqual(['MISSING_FIELD']);
  });
});

describe('validateRecipe - MISSING_FIELD (etapa schema)', () => {
  it.each([
    ['título vacío', { title: '   ' }, 'title'],
    ['sin descripción', { description: undefined }, 'description'],
    ['sin prepMinutes', { prepMinutes: undefined }, 'prepMinutes'],
    ['sin ingredientes', { ingredients: [] }, 'ingredients'],
    ['ingredientes que no son lista', { ingredients: 'quinoa' }, 'ingredients'],
    ['ingrediente sin nombre', { ingredients: [{ name: ' ', quantity: 1, unit: 'g' }] }, 'ingredients[0].name'],
    ['ingrediente sin unidad', { ingredients: [{ name: 'Quinoa', quantity: 1, unit: '' }] }, 'ingredients[0].unit'],
    ['ingrediente sin cantidad', { ingredients: [{ name: 'Quinoa', unit: 'g' }] }, 'ingredients[0].quantity'],
    ['sin pasos', { instructions: [] }, 'instructions'],
    ['un paso vacío', { instructions: ['Cocinar', '  '] }, 'instructions[1]'],
    ['sin macros', { nutritionalValues: undefined }, 'nutritionalValues'],
    ['sin calorías', { nutritionalValues: { protein: 10 } }, 'nutritionalValues.calories'],
    ['categories que no es lista', { categories: 'VEGAN' }, 'categories'],
  ])('%s', (_label, overrides, field) => {
    const result = validateRecipe(generatedRecipe(overrides), NO_RESTRICTIONS);

    expect(codesOf(result)).toEqual(['MISSING_FIELD']);
    expect(fieldsOf(result)).toEqual([field]);
  });

  it('junta todos los errores de la etapa', () => {
    const result = validateRecipe(generatedRecipe({ title: '', description: '' }), NO_RESTRICTIONS);

    expect(fieldsOf(result)).toEqual(['title', 'description']);
  });

  it('la primera etapa que falla corta el pipeline (no informa errores de rango)', () => {
    const result = validateRecipe(generatedRecipe({ title: '', prepMinutes: -5 }), NO_RESTRICTIONS);

    expect(codesOf(result)).toEqual(['MISSING_FIELD']);
  });
});

describe('validateRecipe - normalización', () => {
  it('normaliza texto: trim y espacios repetidos', () => {
    const recipeOut = normalized(validateRecipe(generatedRecipe({
      title: '  Ensalada   de quinoa ',
      ingredients: [{ name: '  Quinoa  real ', quantity: 150, unit: ' g ' }],
      instructions: ['  Cocinar   la quinoa '],
    }), NO_RESTRICTIONS));

    expect(recipeOut.title).toBe('Ensalada de quinoa');
    expect(recipeOut.ingredients[0]).toEqual({ name: 'Quinoa real', quantity: 150, unit: 'g' });
    expect(recipeOut.instructions).toEqual(['Cocinar la quinoa']);
  });

  it('categorías en mayúsculas y sin repetir', () => {
    expect(normalized(validateRecipe(generatedRecipe({ categories: [' vegan ', 'VEGAN', 'high_protein'] }), NO_RESTRICTIONS)).categories)
      .toEqual(['VEGAN', 'HIGH_PROTEIN']);
  });

  it('UNSUPPORTED_CATEGORY si una categoría no es del enum', () => {
    const result = validateRecipe(generatedRecipe({ categories: ['VEGAN', 'PIZZA'] }), NO_RESTRICTIONS);

    expect(codesOf(result)).toEqual(['UNSUPPORTED_CATEGORY']);
    expect(fieldsOf(result)).toEqual(['categories[1]']);
  });

  it('properties normalizadas, sin vacíos ni duplicados', () => {
    expect(normalized(validateRecipe(generatedRecipe({ properties: [' Alto en  fibra ', 'alto en fibra', '', 3] }), NO_RESTRICTIONS)).properties)
      .toEqual(['Alto en fibra']);
  });

  it.each([
    ['gr', 'g'],
    ['GRS', 'g'],
    ['cc', 'ml'],
    ['Taza', 'taza'],
  ])('unidad "%s" → "%s"', (unit, expected) => {
    const recipeOut = normalized(validateRecipe(generatedRecipe({ ingredients: [{ name: 'Quinoa', quantity: 1, unit }] }), NO_RESTRICTIONS));
    expect(recipeOut.ingredients[0].unit).toBe(expected);
  });

  it.each([
    ['200', 200],
    ['0,5', 0.5],
    ['1/2', 0.5],
    ['1 1/2', 1.5],
    ['1/3', 0.33],
    ['0.125', 0.13],
    ['0,125', 0.13],
    ['1,5', 1.5],
    [2 / 3, 0.67],
  ])('cantidad "%s" → %p (redondeada a 2 decimales)', (quantity, expected) => {
    const recipeOut = normalized(validateRecipe(generatedRecipe({ ingredients: [{ name: 'Quinoa', quantity, unit: 'g' }] }), NO_RESTRICTIONS));
    expect(recipeOut.ingredients[0].quantity).toBe(expected);
  });

  it('números como string en minutos y macros se convierten', () => {
    const recipeOut = normalized(validateRecipe(generatedRecipe({
      prepMinutes: '15',
      nutritionalValues: { calories: '410', protein: '14', carbs: 62, fat: 12 },
    }), NO_RESTRICTIONS));

    expect(recipeOut.prepMinutes).toBe(15);
    expect(recipeOut.nutritionalValues.calories).toBe(410);
  });
});

describe('validateRecipe - cantidades sin número (lista fija)', () => {
  it.each(['al gusto', 'A gusto', 'c/n', 'Cantidad necesaria'])('"%s" se guarda sin cantidad, con warning', (quantity) => {
    const result = validateRecipe(generatedRecipe({ ingredients: [{ name: 'Sal', quantity, unit: 'pizca' }] }), NO_RESTRICTIONS);

    expect(normalized(result).ingredients[0]).toEqual({ name: 'Sal', quantity: null, unit: 'pizca' });
    expect(warningsOf(result)).toEqual(['NON_NUMERIC_QUANTITY']);
  });

  it('si la unidad viene vacía, la expresión pasa a ser la unidad', () => {
    const result = validateRecipe(generatedRecipe({ ingredients: [{ name: 'Sal', quantity: 'al gusto', unit: '' }] }), NO_RESTRICTIONS);

    expect(normalized(result).ingredients[0]).toEqual({ name: 'Sal', quantity: null, unit: 'al gusto' });
  });

  it('también si la expresión viene en la unidad y la cantidad vacía', () => {
    const result = validateRecipe(generatedRecipe({ ingredients: [{ name: 'Sal', quantity: '', unit: 'a gusto' }] }), NO_RESTRICTIONS);

    expect(normalized(result).ingredients[0]).toEqual({ name: 'Sal', quantity: null, unit: 'a gusto' });
  });
});

describe('validateRecipe - INVALID_RANGE (etapa ranges)', () => {
  it.each([
    ['prepMinutes negativo', { prepMinutes: -1 }, 'prepMinutes'],
    ['prepMinutes > 1440', { prepMinutes: 1441 }, 'prepMinutes'],
    ['prepMinutes no entero', { prepMinutes: 12.5 }, 'prepMinutes'],
    ['prepMinutes NaN', { prepMinutes: Number.NaN }, 'prepMinutes'],
    ['cookMinutes Infinity', { cookMinutes: Number.POSITIVE_INFINITY }, 'cookMinutes'],
    ['cookMinutes texto', { cookMinutes: 'un rato' }, 'cookMinutes'],
    ['cantidad 0', { ingredients: [{ name: 'Quinoa', quantity: 0, unit: 'g' }] }, 'ingredients[0].quantity'],
    ['cantidad negativa', { ingredients: [{ name: 'Quinoa', quantity: -2, unit: 'g' }] }, 'ingredients[0].quantity'],
    ['cantidad texto libre', { ingredients: [{ name: 'Quinoa', quantity: 'mucha', unit: 'g' }] }, 'ingredients[0].quantity'],
    ['cantidad NaN', { ingredients: [{ name: 'Quinoa', quantity: Number.NaN, unit: 'g' }] }, 'ingredients[0].quantity'],
    ['cantidad ambigua "1.000" (¿mil o uno?)', { ingredients: [{ name: 'Harina de arroz', quantity: '1.000', unit: 'g' }] }, 'ingredients[0].quantity'],
    ['cantidad ambigua "2.500"', { ingredients: [{ name: 'Quinoa', quantity: '2.500', unit: 'g' }] }, 'ingredients[0].quantity'],
    ['cantidad ambigua "1,000" (coma + 3 dígitos)', { ingredients: [{ name: 'Quinoa', quantity: '1,000', unit: 'g' }] }, 'ingredients[0].quantity'],
    ['cantidad ambigua "2,500"', { ingredients: [{ name: 'Quinoa', quantity: '2,500', unit: 'g' }] }, 'ingredients[0].quantity'],
    ['proteína negativa', { nutritionalValues: { calories: 410, protein: -1, carbs: 62, fat: 12 } }, 'nutritionalValues.protein'],
    ['calorías Infinity', { nutritionalValues: { calories: Number.POSITIVE_INFINITY, protein: 14 } }, 'nutritionalValues.calories'],
    ['fibra NaN', { nutritionalValues: { calories: 410, protein: 14, fiber: Number.NaN } }, 'nutritionalValues.fiber'],
  ])('%s', (_label, overrides, field) => {
    const result = validateRecipe(generatedRecipe(overrides), NO_RESTRICTIONS);

    expect(codesOf(result)).toEqual(['INVALID_RANGE']);
    expect(fieldsOf(result)).toEqual([field]);
  });

  it('acepta los límites 0 y 1440', () => {
    expect(validateRecipe(generatedRecipe({ prepMinutes: 0, cookMinutes: 1440 }), NO_RESTRICTIONS).valid).toBe(true);
  });
});

describe('validateRecipe - calorías contra macros (aprobado por el TL)', () => {
  // Esperadas: 4·10 + 4·50 + 9·10 = 330 kcal.
  const macros = (calories: number) => ({ nutritionalValues: { calories, protein: 10, carbs: 50, fat: 10 } });

  it('hasta 15 % de desvío está OK', () => {
    const result = validateRecipe(generatedRecipe(macros(370)), NO_RESTRICTIONS);
    expect(result.valid).toBe(true);
    expect(warningsOf(result)).toEqual([]);
  });

  it('entre 15 % y 35 % es válido con warning CALORIE_MACRO_MISMATCH', () => {
    const result = validateRecipe(generatedRecipe(macros(420)), NO_RESTRICTIONS);
    expect(result.valid).toBe(true);
    expect(warningsOf(result)).toEqual(['CALORIE_MACRO_MISMATCH']);
  });

  it('más de 35 % de desvío da INVALID_RANGE', () => {
    const result = validateRecipe(generatedRecipe(macros(600)), NO_RESTRICTIONS);
    expect(codesOf(result)).toEqual(['INVALID_RANGE']);
    expect(fieldsOf(result)).toEqual(['nutritionalValues.calories']);
  });

  // Bordes exactos con 100 kcal esperadas (P0 / C25 / G0).
  it.each([
    [115, true, []],
    [115.0001, true, ['CALORIE_MACRO_MISMATCH']],
    [135, true, ['CALORIE_MACRO_MISMATCH']],
    [135.0001, false, []],
    [85, true, []],
    [65, true, ['CALORIE_MACRO_MISMATCH']],
    [64.9, false, []],
  ])('borde: %p kcal → válido %p, warnings %p', (calories, valid, warnings) => {
    const result = validateRecipe(generatedRecipe({ nutritionalValues: { calories, protein: 0, carbs: 25, fat: 0 } }), NO_RESTRICTIONS);
    expect(result.valid).toBe(valid);
    expect(warningsOf(result)).toEqual(warnings);
    if (!valid) expect(codesOf(result)).toEqual(['INVALID_RANGE']);
  });

  it('macros en 0 con calorías > 0 da INVALID_RANGE', () => {
    const result = validateRecipe(generatedRecipe({ nutritionalValues: { calories: 200, protein: 0, carbs: 0, fat: 0 } }), NO_RESTRICTIONS);
    expect(codesOf(result)).toEqual(['INVALID_RANGE']);
  });

  it('sin carbohidratos o grasas la regla no se aplica y queda CALORIE_CHECK_SKIPPED', () => {
    const result = validateRecipe(generatedRecipe({ nutritionalValues: { calories: 5000, protein: 1 } }), NO_RESTRICTIONS);
    expect(result.valid).toBe(true);
    expect(warningsOf(result)).toEqual(['CALORIE_CHECK_SKIPPED']);
  });
});

describe('validateRecipe - EXCLUDED_INGREDIENT (etapa profile)', () => {
  it.each([
    ['restricción directa', 'Almendras'],
    ['derivado', 'Turrón'],
    ['derivado (marca)', 'Nutella'],
    ['acentos y mayúsculas', 'MANÍ TOSTADO'],
  ])('%s: "%s"', (_label, ingredient) => {
    const result = validateRecipe(recipeWithIngredient(ingredient), withNuts);

    expect(codesOf(result)).toEqual(['EXCLUDED_INGREDIENT']);
    expect(errorsOf(result)[0].message).toContain('nuts');
  });

  it('revisa también el título, la descripción y el título de la comida', () => {
    expect(codesOf(validateRecipe(recipeWithIngredient('Arroz', { title: 'Arroz con almendras' }), withNuts))).toEqual(['EXCLUDED_INGREDIENT']);
    expect(codesOf(validateRecipe(recipeWithIngredient('Arroz', { description: 'Con salsa de maní' }), withNuts))).toEqual(['EXCLUDED_INGREDIENT']);
    expect(codesOf(validateRecipe(recipeWithIngredient('Arroz', { mealTitle: 'Budín de nueces' }), withNuts))).toEqual(['EXCLUDED_INGREDIENT']);
  });

  it('revisa también el texto de los pasos', () => {
    const result = validateRecipe(recipeWithIngredient('Arroz', { instructions: ['Cocinar el arroz', 'Agregar maní picado'] }), withNuts);
    expect(codesOf(result)).toEqual(['EXCLUDED_INGREDIENT']);
  });

  it('en los pasos se mantienen las excepciones ("sin maní", "nuez moscada")', () => {
    const result = validateRecipe(recipeWithIngredient('Arroz', {
      instructions: ['Servir sin maní', 'Condimentar con nuez moscada'],
    }), withNuts);
    expect(result.valid).toBe(true);
  });

  it('una negación en los pasos no tapa el ingrediente de la lista', () => {
    const result = validateRecipe(recipeWithIngredient('Maní tostado', { instructions: ['Servir sin maní extra'] }), withNuts);
    expect(codesOf(result)).toEqual(['EXCLUDED_INGREDIENT']);
  });

  it.each([
    ['Panceta', ['GLUTEN']],
    ['Pancita', ['GLUTEN']],
    ['Nutmeg', ['NUTS']],
  ])('palabra parcial sin falso positivo: "%s"', (ingredient, excludedIngredients) => {
    expect(validateRecipe(recipeWithIngredient(ingredient), { excludedIngredients }).valid).toBe(true);
  });
});

describe('validateRecipe - CONTRADICTORY_PREFERENCE (pendiente de confirmar con el TL)', () => {
  it.each([
    ['VEGETARIAN', 'Pechuga de pollo'],
    ['VEGETARIAN', 'Atún'],
    ['VEGAN', 'Queso rallado'],
    ['VEGAN', 'Huevo'],
    ['VEGAN', 'Miel'],
    ['GLUTEN_FREE', 'Harina de trigo'],
    ['DAIRY_FREE', 'Manteca'],
  ])('%s con "%s"', (category, ingredient) => {
    const result = validateRecipe(recipeWithIngredient(ingredient, { categories: [category] }), NO_RESTRICTIONS);

    expect(codesOf(result)).toEqual(['CONTRADICTORY_PREFERENCE']);
    expect(fieldsOf(result)).toEqual(['categories']);
  });

  it.each([
    ['VEGETARIAN', 'Repollo'],
    ['VEGAN', 'Leche de almendras'],
    ['GLUTEN_FREE', 'Harina de arroz'],
    ['HIGH_PROTEIN', 'Pechuga de pollo'],
  ])('%s con "%s" no es contradictorio', (category, ingredient) => {
    expect(validateRecipe(recipeWithIngredient(ingredient, { categories: [category] }), NO_RESTRICTIONS).valid).toBe(true);
  });

  it('junta en la misma etapa el ingrediente excluido y la contradicción', () => {
    const result = validateRecipe(recipeWithIngredient('Queso con nueces', { categories: ['VEGAN'] }), withNuts);

    expect(codesOf(result)).toEqual(['EXCLUDED_INGREDIENT', 'CONTRADICTORY_PREFERENCE']);
  });
});

describe('validateRecipe - duplicados (NUT-72)', () => {
  const catalog = [
    { id: 'recipe-same', title: 'ENSALADA DE QUÍNOA', ingredients: [{ name: 'tomate' }, { name: 'Quinoa' }] },
  ];

  it('DUPLICATE_RECIPE con el id existente si la huella coincide con una receta del catálogo', () => {
    const result = validateRecipe(generatedRecipe(), { ...NO_RESTRICTIONS, catalog });

    expect(codesOf(result)).toEqual(['DUPLICATE_RECIPE']);
    expect(errorsOf(result)[0].existingRecipeId).toBe('recipe-same');
    expect(reusableRecipeId(result)).toBe('recipe-same');
  });

  it('el duplicado reutilizable trae la receta ya normalizada (para validar el envoltorio con ella)', () => {
    const result = validateRecipe(
      generatedRecipe({ ingredients: [{ name: 'Quinoa', quantity: '150', unit: 'gr' }, { name: 'Tomate', quantity: 'al gusto', unit: '' }] }),
      { ...NO_RESTRICTIONS, catalog },
    );

    expect(reusableDuplicate(result)).toEqual({
      recipeId: 'recipe-same',
      normalizedRecipe: expect.objectContaining({
        ingredients: [{ name: 'Quinoa', quantity: 150, unit: 'g' }, { name: 'Tomate', quantity: null, unit: 'al gusto' }],
      }),
    });
  });

  it('mismo título con otros ingredientes: válido con warning POTENTIAL_DUPLICATE', () => {
    const potential = [{ id: 'recipe-other', title: 'Ensalada de quinoa', ingredients: [{ name: 'Pepino' }] }];
    const result = validateRecipe(generatedRecipe(), { ...NO_RESTRICTIONS, catalog: potential });

    expect(result.valid).toBe(true);
    expect(result.valid && result.warnings).toEqual([
      expect.objectContaining({ code: 'POTENTIAL_DUPLICATE', recipeIds: ['recipe-other'] }),
    ]);
  });

  it('una receta inválida por otra razón nunca es "reutilizable"', () => {
    const result = validateRecipe(generatedRecipe({ title: '' }), { ...NO_RESTRICTIONS, catalog });
    expect(reusableRecipeId(result)).toBeNull();
    expect(reusableRecipeId(validateRecipe(generatedRecipe(), NO_RESTRICTIONS))).toBeNull();
  });
});

describe('validateRecipes - lotes', () => {
  it('una receta inválida se rechaza sola; el resto del lote sigue', () => {
    const results = validateRecipes(
      [generatedRecipe(), recipeWithIngredient('Almendras'), generatedRecipe({ title: 'Wok de verduras' })],
      withNuts,
    );

    expect(results.map(result => result.valid)).toEqual([true, false, true]);
    expect(codesOf(results[1])).toEqual(['EXCLUDED_INGREDIENT']);
  });

  it('detecta duplicados dentro del mismo lote', () => {
    const results = validateRecipes([generatedRecipe(), generatedRecipe({ title: '  ensalada de QUINOA ' })], NO_RESTRICTIONS);

    expect(results[0].valid).toBe(true);
    expect(codesOf(results[1])).toEqual(['DUPLICATE_RECIPE']);
    expect(errorsOf(results[1])[0].duplicateOfIndex).toBe(0);
    expect(reusableRecipeId(results[1])).toBeNull();
  });

  it('una receta inválida no cuenta como original de un duplicado del lote', () => {
    const results = validateRecipes([generatedRecipe({ prepMinutes: -1 }), generatedRecipe()], NO_RESTRICTIONS);

    expect(results.map(result => result.valid)).toEqual([false, true]);
  });
});

describe('summarizeResults / summarizeParseFailure (validationSnapshot de NUT-75)', () => {
  it('resultado válido con warnings: stage passed y los códigos de warning', () => {
    const results = validateRecipes([generatedRecipe({ nutritionalValues: { calories: 410, protein: 14 } })], NO_RESTRICTIONS);

    expect(summarizeResults(results)).toEqual({ stage: 'passed', codes: [], warnings: ['CALORIE_CHECK_SKIPPED'] });
  });

  it('lote mixto: primera etapa que falló y códigos únicos', () => {
    const results = validateRecipes(
      [recipeWithIngredient('Almendras'), generatedRecipe({ title: '' }), recipeWithIngredient('Nueces')],
      withNuts,
    );

    expect(summarizeResults(results)).toEqual({ stage: 'schema', codes: ['EXCLUDED_INGREDIENT', 'MISSING_FIELD'], warnings: [] });
  });

  it('falla del parseo', () => {
    expect(summarizeParseFailure([{ code: 'INVALID_JSON', message: 'x' }])).toEqual({ stage: 'parse', codes: ['INVALID_JSON'], warnings: [] });
  });
});
