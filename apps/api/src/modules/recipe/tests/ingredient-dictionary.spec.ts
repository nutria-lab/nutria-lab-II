import { findExcludedIngredient, findIngredientGroup, forbiddenRestrictions, restrictionTexts } from '../validation/ingredient-dictionary';

// Casos que antes cubría meal-restrictions.util.spec.ts (el diccionario se movió al validador de NUT-74).
const ALL = forbiddenRestrictions({ excludedIngredients: ['NUTS', 'DAIRY', 'GLUTEN', 'SHELLFISH', 'SOY'] });
const only = (restriction: string) => [restriction];
const excluded = (text: string, restrictions: string[]) => findExcludedIngredient([text], restrictions);

describe('forbiddenRestrictions', () => {
  it('devuelve las restricciones del perfil en minúsculas', () => {
    expect(forbiddenRestrictions({ excludedIngredients: ['GLUTEN', 'NUTS'] })).toEqual(['gluten', 'nuts']);
  });

  it('devuelve [] si el perfil no tiene restricciones', () => {
    expect(forbiddenRestrictions({ excludedIngredients: undefined })).toEqual([]);
  });
});

describe('findExcludedIngredient - restricción directa y derivados', () => {
  it.each([
    ['Budín de nueces', 'nuts'],
    ['Fideos con queso y leche', 'dairy'],
    ['Pan de trigo', 'gluten'],
    ['Arroz con camarones', 'shellfish'],
    ['Salteado con salsa de soja', 'soy'],
  ])('"%s" viola %s', (text, restriction) => {
    expect(excluded(text, only(restriction))).toBe(restriction);
  });

  it.each([
    ['nuts', ['Salsa de maní', 'Almendras tostadas', 'Pesto de pistachos', 'Turrón', 'Nutella', 'Mazapán', 'Peanut butter cookies']],
    ['dairy', ['Tarta con ricota', 'Yogur con frutas', 'Puré con manteca', 'Helado de vainilla', 'Arroz con ghee', 'Mac and cheese']],
    ['gluten', ['Milanesa al horno', 'Ñoquis de papa', 'Galletitas de avena', 'Sémola con leche', 'Whole wheat bread']],
    ['shellfish', ['Paella de mariscos', 'Langostinos al ajillo', 'Calamares fritos', 'Mejillones a la provenzal', 'Shrimp tacos']],
    ['soy', ['Tofu salteado', 'Sopa miso', 'Tempeh grillado', 'Edamame con sal', 'Soy glazed salmon']],
  ])('%s: detecta %p', (restriction, texts) => {
    for (const text of texts as string[]) {
      expect(excluded(text, only(restriction))).toBe(restriction);
    }
  });

  it('acepta la restricción en cualquier capitalización (como viene del perfil)', () => {
    expect(excluded('Almendras', ['NUTS'])).toBe('nuts');
  });

  it('ignora acentos y mayúsculas', () => {
    expect(excluded('MANÍ CON CHOCOLATE', only('nuts'))).toBe('nuts');
    expect(excluded('camarón grillado', only('shellfish'))).toBe('shellfish');
  });

  it('revisa todos los textos recibidos', () => {
    expect(findExcludedIngredient(['Bowl verde', 'Cena liviana', 'Espinaca', 'Queso rallado'], only('dairy'))).toBe('dairy');
  });

  it('una restricción desconocida se busca por su propio nombre', () => {
    expect(excluded('Ensalada con apio', only('apio'))).toBe('apio');
  });
});

describe('findExcludedIngredient - sin falsos positivos', () => {
  it('"leche de almendras" es NUTS pero no DAIRY', () => {
    expect(excluded('Licuado con leche de almendras', only('nuts'))).toBe('nuts');
    expect(excluded('Licuado con leche de almendras', only('dairy'))).toBeNull();
  });

  it('"crema" sola no es NUTS (sí es DAIRY)', () => {
    expect(excluded('Crema de calabaza', only('nuts'))).toBeNull();
    expect(excluded('Crema de calabaza', only('dairy'))).toBe('dairy');
  });

  it.each([
    ['Pan sin gluten', 'gluten'],
    ['Fideos de arroz salteados', 'gluten'],
    ['Pasta de maní casera', 'gluten'],
    ['Leche de coco con mango', 'dairy'],
    ['Torta sin lácteos', 'dairy'],
    ['Nuez moscada en el puré', 'nuts'],
    ['Coconut curry', 'nuts'],
    // Palabra parcial: "pan" dentro de otra palabra no es gluten, "nut" dentro de "nutmeg" no es nuts.
    ['Panceta crocante', 'gluten'],
    ['Pancita a la parrilla', 'gluten'],
    ['Nutmeg spiced squash', 'nuts'],
  ])('"%s" no viola %s', (text, restriction) => {
    expect(excluded(text, only(restriction))).toBeNull();
  });

  it.each([
    ['Servir sin maní', 'nuts'],
    ['Torta sin nueces', 'nuts'],
    ['Ensalada sin queso', 'dairy'],
    ['Libre de mariscos', 'shellfish'],
  ])('una negación explícita "%s" no viola %s', (text, restriction) => {
    expect(excluded(text, only(restriction))).toBeNull();
  });

  it('la negación sólo borra esa mención: "sin queso, con crema" sigue siendo DAIRY', () => {
    expect(excluded('Ensalada sin queso, con crema', only('dairy'))).toBe('dairy');
  });

  it('"Ensalada de quinoa" no viola ninguna', () => {
    expect(excluded('Ensalada de quinoa', ALL)).toBeNull();
  });
});

describe('findIngredientGroup - grupos que usa CONTRADICTORY_PREFERENCE', () => {
  it.each([
    ['meat', ['Pollo al horno', 'Caldo de pollo', 'Jamón cocido', 'Panceta crocante', 'Bife de chorizo', 'Beef stew']],
    ['fish', ['Atún a la plancha', 'Salmón grillado', 'Merluza al horno', 'Tuna salad']],
    ['egg', ['Huevos revueltos', 'Mayonesa casera', 'Fried egg']],
    ['honey', ['Yogur con miel', 'Honey glazed carrots']],
  ])('%s: detecta %p', (group, texts) => {
    for (const text of texts as string[]) {
      expect(findIngredientGroup([text], [group])).toBe(group);
    }
  });

  it.each([
    ['Ensalada de repollo', 'meat'],
    ['Carne de soja con verduras', 'meat'],
    ['Torta sin huevo', 'egg'],
    ['Miel de agave', 'honey'],
  ])('"%s" no es %s', (text, group) => {
    expect(findIngredientGroup([text], [group])).toBeNull();
  });
});

describe('restrictionTexts - qué textos se revisan (único lugar, NUT-74)', () => {
  it('junta título de la comida, título, descripción, macros, ingredientes y pasos', () => {
    expect(restrictionTexts({
      mealTitle: 'Cena',
      title: 'Wok',
      description: 'Salteado',
      nutritionDescription: 'Liviana',
      ingredients: [{ name: 'Arroz' }, { quantity: 1 }, null],
      instructions: ['Saltear', 3],
    })).toEqual(['Cena', 'Wok', 'Salteado', 'Liviana', 'Arroz', 'Saltear']);
  });

  it('acepta instructions como string y campos ausentes', () => {
    expect(restrictionTexts({ title: 'Wok', instructions: 'Saltear todo', ingredients: 'x' })).toEqual(['Wok', 'Saltear todo']);
  });
});
