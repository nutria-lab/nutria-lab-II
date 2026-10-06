import type { ParseOutcome, ValidationError } from './recipe-validation.types';

// Etapa "parse" de NUT-74. Sólo se acepta JSON plano o envuelto en un fence ```json (sin importar
// mayúsculas); cualquier otro texto alrededor es INVALID_JSON. Los mensajes nunca repiten el texto generado.

const JSON_FENCE = /^```json[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i;

const failure = (error: ValidationError): ParseOutcome<never> => ({ ok: false, errors: [error] });

export function parseJsonOutput(raw: unknown): ParseOutcome<unknown> {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text.length === 0) {
    return failure({ code: 'EMPTY_OUTPUT', message: 'The AI returned an empty response' });
  }

  const fenced = JSON_FENCE.exec(text);
  let value: unknown;
  try {
    value = JSON.parse(fenced ? fenced[1] : text);
  } catch {
    return failure({ code: 'INVALID_JSON', message: 'The AI response is not valid JSON' });
  }

  if (value === null) {
    return failure({ code: 'EMPTY_OUTPUT', message: 'The AI returned an empty response' });
  }
  return { ok: true, value };
}

// Lote de recetas: un array, o { "recipes": [...] }, con exactamente la cantidad pedida. Estos
// errores rechazan el lote entero: no hay recetas individuales para evaluar.
export function parseGeneratedOutput(raw: unknown, expectedCount: number): ParseOutcome<unknown[]> {
  const parsed = parseJsonOutput(raw);
  if (!parsed.ok) return parsed;

  const { value } = parsed;
  const recipes = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null && Array.isArray((value as { recipes?: unknown }).recipes)
      ? (value as { recipes: unknown[] }).recipes
      : null;
  if (!recipes) {
    return failure({ code: 'INVALID_JSON', message: 'The AI response is not a list of recipes' });
  }

  if (recipes.length !== expectedCount) {
    return failure({
      code: 'COUNT_MISMATCH',
      message: `Expected ${expectedCount} recipes but the AI returned ${recipes.length}`,
    });
  }
  return { ok: true, value: recipes };
}
