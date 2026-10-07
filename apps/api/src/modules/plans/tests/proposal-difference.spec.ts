import { firstDifferentProposal, hasMaterialChange } from '../proposal-difference';

// Una semana mínima: cada día con sus comidas (tipo + receta). Las recetas sólo necesitan título e ingredientes.
const meal = (mealType: string, title: string, ingredients = ['Quinoa']) => ({
  mealType,
  title,
  recipe: { title, ingredients: ingredients.map(name => ({ name })) },
});
const week = (overrides: Record<number, any[]> = {}) =>
  ['MONDAY', 'TUESDAY'].map((day, index) => ({
    day,
    meals: overrides[index] ?? [meal('LUNCH', `Almuerzo ${index}`), meal('DINNER', `Cena ${index}`)],
  }));

describe('hasMaterialChange (NUT-78: al menos una franja distinta)', () => {
  it('la misma semana no es una propuesta nueva', () => {
    expect(hasMaterialChange(week(), week())).toBe(false);
  });

  it('una sola comida distinta alcanza', () => {
    const proposed = week({ 1: [meal('LUNCH', 'Almuerzo 1'), meal('DINNER', 'Wok de verduras')] });
    expect(hasMaterialChange(week(), proposed)).toBe(true);
  });

  it('mismo título con otros ingredientes es otra receta (huella de NUT-72)', () => {
    const proposed = week({ 0: [meal('LUNCH', 'Almuerzo 0', ['Arroz']), meal('DINNER', 'Cena 0')] });
    expect(hasMaterialChange(week(), proposed)).toBe(true);
  });

  it('acentos, mayúsculas y signos no cuentan como cambio', () => {
    const proposed = week({ 0: [meal('LUNCH', '¡ALMUERZO 0!', ['QUÍNOA']), meal('DINNER', 'cena 0')] });
    expect(hasMaterialChange(week(), proposed)).toBe(false);
  });

  it('el orden de las comidas dentro del día no cuenta como cambio', () => {
    const proposed = week({ 0: [meal('DINNER', 'Cena 0'), meal('LUNCH', 'Almuerzo 0')] });
    expect(hasMaterialChange(week(), proposed)).toBe(false);
  });

  it('la misma receta en otra franja (otro día o tipo de comida) sí es un cambio', () => {
    const proposed = week({ 0: [meal('LUNCH', 'Cena 0'), meal('DINNER', 'Almuerzo 0')] });
    expect(hasMaterialChange(week(), proposed)).toBe(true);
  });

  it('una comida de más o de menos es un cambio', () => {
    expect(hasMaterialChange(week(), week({ 0: [meal('LUNCH', 'Almuerzo 0')] }))).toBe(true);
    expect(hasMaterialChange(week(), week({ 0: [meal('LUNCH', 'Almuerzo 0'), meal('DINNER', 'Cena 0'), meal('SNACK', 'Fruta')] }))).toBe(true);
  });

  it('una comida anterior sin receta se compara por su título', () => {
    const previous = week({ 0: [{ mealType: 'LUNCH', title: 'Almuerzo 0', recipe: null }, meal('DINNER', 'Cena 0')] });
    expect(hasMaterialChange(previous, week({ 0: [{ mealType: 'LUNCH', title: 'almuerzo 0', recipe: null }, meal('DINNER', 'Cena 0')] }))).toBe(false);
    expect(hasMaterialChange(previous, week())).toBe(true);
  });
});

describe('firstDifferentProposal (máximo 2 generaciones)', () => {
  it('si la primera propuesta ya es distinta, no genera otra', async () => {
    const compose = jest.fn().mockResolvedValue('p1');

    await expect(firstDifferentProposal(compose, proposal => proposal === 'p1')).resolves.toBe('p1');
    expect(compose).toHaveBeenCalledTimes(1);
  });

  it('si la primera es igual, reintenta una vez y devuelve la segunda', async () => {
    const compose = jest.fn().mockResolvedValueOnce('igual').mockResolvedValueOnce('distinta');

    await expect(firstDifferentProposal(compose, proposal => proposal === 'distinta')).resolves.toBe('distinta');
    expect(compose).toHaveBeenCalledTimes(2);
  });

  it('si las 2 son iguales devuelve null (el que llama responde 422) sin un tercer intento', async () => {
    const compose = jest.fn().mockResolvedValue('igual');

    await expect(firstDifferentProposal(compose, () => false)).resolves.toBeNull();
    expect(compose).toHaveBeenCalledTimes(2);
  });

  it('un error de la composición (422 de validación, 503 de proveedor) corta sin reintentar', async () => {
    const compose = jest.fn().mockRejectedValue(new Error('422'));

    await expect(firstDifferentProposal(compose, () => false)).rejects.toThrow('422');
    expect(compose).toHaveBeenCalledTimes(1);
  });
});
