import { normalizeRecipeText, normalizeRecipeTitle, recipeFingerprint } from '../recipe-fingerprint.util';

// Huella de NUT-72 extraída a un util compartido (NUT-74): mismo resultado que antes.
describe('recipeFingerprint', () => {
  it('título normalizado + nombres de ingredientes normalizados, sin repetir y ordenados', () => {
    const fingerprint = recipeFingerprint({
      title: '  Ensalada   CÉSAR! ',
      ingredients: [{ name: 'Pollo' }, { name: 'Lechuga' }, { name: 'lechuga' }],
    });

    expect(fingerprint).toBe('ensalada cesar|lechuga|pollo');
  });

  it('ignora ingredientes sin nombre o que no son objetos', () => {
    expect(recipeFingerprint({ title: 'Wok', ingredients: [null, 'x', { quantity: 1 }, { name: 'Arroz' }] })).toBe('wok|arroz');
  });

  it('acepta ingredientes que no son array', () => {
    expect(recipeFingerprint({ title: 'Wok', ingredients: null })).toBe('wok');
  });

  it('expande ligaduras igual que unaccent de PostgreSQL', () => {
    expect(normalizeRecipeText('Œufs à la Ærø')).toBe('oeufs a la aero');
  });
});

describe('normalizeRecipeTitle', () => {
  it('es la parte de título de la huella', () => {
    expect(normalizeRecipeTitle('  Ensalada   CÉSAR! ')).toBe('ensalada cesar');
  });
});
