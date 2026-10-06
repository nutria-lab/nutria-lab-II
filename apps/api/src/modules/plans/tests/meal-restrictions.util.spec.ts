import { findRestrictionViolation, forbiddenRestrictions } from '../meal-restrictions.util';

const ALL = forbiddenRestrictions({ excludedIngredients: ['NUTS', 'DAIRY', 'GLUTEN', 'SHELLFISH', 'SOY'] });
const only = (restriction: string) => [restriction];
const titled = (title: string) => ({ title });

describe('forbiddenRestrictions', () => {
  it('devuelve las restricciones del perfil en minúsculas', () => {
    expect(forbiddenRestrictions({ excludedIngredients: ['GLUTEN', 'NUTS'] })).toEqual(['gluten', 'nuts']);
  });

  it('devuelve [] si el perfil no tiene restricciones', () => {
    expect(forbiddenRestrictions({ excludedIngredients: undefined })).toEqual([]);
  });
});

describe('findRestrictionViolation - casos de la revisión (antes pasaban sin detectarse)', () => {
  it.each([
    ['Budín de nueces', 'nuts'],
    ['Fideos con queso y leche', 'dairy'],
    ['Pan de trigo', 'gluten'],
    ['Arroz con camarones', 'shellfish'],
    ['Salteado con salsa de soja', 'soy'],
  ])('"%s" viola %s', (title, restriction) => {
    expect(findRestrictionViolation(titled(title), only(restriction))).toBe(restriction);
  });

  it('"Ensalada de quinoa" no viola ninguna', () => {
    expect(findRestrictionViolation(titled('Ensalada de quinoa'), ALL)).toBeNull();
  });
});

describe('findRestrictionViolation - palabras en español y en inglés', () => {
  it.each([
    ['nuts', ['Salsa de maní', 'Almendras tostadas', 'Pesto de pistachos', 'Turrón', 'Peanut butter cookies']],
    ['dairy', ['Tarta con ricota', 'Yogur con frutas', 'Puré con manteca', 'Helado de vainilla', 'Mac and cheese']],
    ['gluten', ['Milanesa al horno', 'Ñoquis de papa', 'Galletitas de avena', 'Sémola con leche', 'Whole wheat bread']],
    ['shellfish', ['Paella de mariscos', 'Langostinos al ajillo', 'Calamares fritos', 'Mejillones a la provenzal', 'Shrimp tacos']],
    ['soy', ['Tofu salteado', 'Sopa miso', 'Tempeh grillado', 'Edamame con sal', 'Soy glazed salmon']],
  ])('%s: detecta %p', (restriction, titles) => {
    for (const title of titles as string[]) {
      expect(findRestrictionViolation(titled(title), only(restriction))).toBe(restriction);
    }
  });

  it('ignora acentos y mayúsculas', () => {
    expect(findRestrictionViolation(titled('MANÍ CON CHOCOLATE'), only('nuts'))).toBe('nuts');
    expect(findRestrictionViolation(titled('camarón grillado'), only('shellfish'))).toBe('shellfish');
  });

  it('revisa también la descripción y los ingredientes', () => {
    const meal = {
      title: 'Bowl verde',
      nutritionalValues: { Description: 'Cena liviana' },
      recipe: { ingredients: [{ name: 'Espinaca' }, { name: 'Queso rallado' }] },
    };
    expect(findRestrictionViolation(meal, only('dairy'))).toBe('dairy');
  });
});

describe('findRestrictionViolation - sin falsos positivos evidentes', () => {
  it('"leche de almendras" es NUTS pero no DAIRY', () => {
    expect(findRestrictionViolation(titled('Licuado con leche de almendras'), only('nuts'))).toBe('nuts');
    expect(findRestrictionViolation(titled('Licuado con leche de almendras'), only('dairy'))).toBeNull();
  });

  it('"crema" sola no es NUTS (sí es DAIRY)', () => {
    expect(findRestrictionViolation(titled('Crema de calabaza'), only('nuts'))).toBeNull();
    expect(findRestrictionViolation(titled('Crema de calabaza'), only('dairy'))).toBe('dairy');
  });

  it.each([
    ['Pan sin gluten', 'gluten'],
    ['Fideos de arroz salteados', 'gluten'],
    ['Pasta de maní casera', 'gluten'],
    ['Leche de coco con mango', 'dairy'],
    ['Torta sin lácteos', 'dairy'],
    ['Nuez moscada en el puré', 'nuts'],
    ['Panceta crocante', 'gluten'],
    ['Coconut curry', 'nuts'],
  ])('"%s" no viola %s', (title, restriction) => {
    expect(findRestrictionViolation(titled(title), only(restriction))).toBeNull();
  });
});
