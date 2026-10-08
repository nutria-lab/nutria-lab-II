import { parseGeneratedOutput, parseJsonOutput } from '../validation/parse-generated-output';
import { generatedRecipe } from './recipe-validation.fixtures';

const codes = (outcome: { ok: boolean; errors?: Array<{ code: string }> }) => (outcome.errors ?? []).map(error => error.code);

describe('parseJsonOutput (NUT-74, etapa parse)', () => {
  it.each([
    ['vacío', ''],
    ['sólo espacios', '   \n '],
    ['null', null],
    ['undefined', undefined],
    ['el JSON null', 'null'],
  ])('EMPTY_OUTPUT si el output es %s', (_label, raw) => {
    expect(codes(parseJsonOutput(raw))).toEqual(['EMPTY_OUTPUT']);
  });

  it.each([
    ['texto que no es JSON', 'no es json'],
    ['texto antes del JSON', 'Acá está tu receta: {"title":"Wok"}'],
    ['texto después del JSON', '{"title":"Wok"} ¡Que lo disfrutes!'],
    ['un fence sin "json"', '```\n{"title":"Wok"}\n```'],
    ['un fence "jsonc"', '```jsonc\n{"title":"Wok"}\n```'],
    ['un fence de otro lenguaje', '```js\n{"title":"Wok"}\n```'],
    ['texto fuera del fence json', 'Receta:\n```json\n{"title":"Wok"}\n```'],
    ['JSON cortado', '{"title":"Wok"'],
  ])('INVALID_JSON si hay %s', (_label, raw) => {
    expect(codes(parseJsonOutput(raw))).toEqual(['INVALID_JSON']);
  });

  it('acepta JSON plano', () => {
    expect(parseJsonOutput(' {"title":"Wok"} ')).toEqual({ ok: true, value: { title: 'Wok' } });
  });

  it.each(['json', 'JSON', 'Json'])('acepta un fence ```%s (sin importar mayúsculas)', (tag) => {
    expect(parseJsonOutput('```' + tag + '\n{"title":"Wok"}\n```')).toEqual({ ok: true, value: { title: 'Wok' } });
  });

  it('el mensaje de error nunca repite el texto generado', () => {
    const outcome = parseJsonOutput('texto con datos privados del prompt');
    expect(JSON.stringify(outcome)).not.toContain('datos privados');
  });
});

describe('parseGeneratedOutput (NUT-74, lote de recetas)', () => {
  const two = [generatedRecipe(), generatedRecipe({ title: 'Wok' })];

  it('devuelve las recetas de un array con la cantidad pedida', () => {
    expect(parseGeneratedOutput(JSON.stringify(two), 2)).toEqual({ ok: true, value: two });
  });

  it('acepta también { "recipes": [...] }', () => {
    expect(parseGeneratedOutput(JSON.stringify({ recipes: two }), 2)).toEqual({ ok: true, value: two });
  });

  it.each([
    ['menos', 3],
    ['más', 1],
  ])('COUNT_MISMATCH si llegan %s recetas que las pedidas (rechaza el lote entero)', (_label, expected) => {
    const outcome = parseGeneratedOutput(JSON.stringify(two), expected);
    expect(codes(outcome)).toEqual(['COUNT_MISMATCH']);
  });

  it('INVALID_JSON si el JSON no es una lista de recetas', () => {
    expect(codes(parseGeneratedOutput(JSON.stringify(generatedRecipe()), 1))).toEqual(['INVALID_JSON']);
  });

  it('propaga EMPTY_OUTPUT e INVALID_JSON', () => {
    expect(codes(parseGeneratedOutput('', 1))).toEqual(['EMPTY_OUTPUT']);
    expect(codes(parseGeneratedOutput('[{"title":"x"}] gracias', 1))).toEqual(['INVALID_JSON']);
  });
});
