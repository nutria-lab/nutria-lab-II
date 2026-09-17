import { useState, type FormEvent } from 'react';

import { Banner } from '../../../common/components/Banner';
import { Pill } from '../../../common/components/Pill';
import {
  recipeService,
  RecipeRequestError,
  type CreateRecipeRequest,
  type Recipe,
  type RecipeCategory,
  type RecipeIngredientItem,
} from '../../../services/recipeService';
import type { Ingredient } from '../../../services/ingredientService';
import { RECIPE_CATEGORY_LABELS } from '../labels';

type RecipeFormProps = {
  mode: 'create' | 'edit';
  initialValues?: Recipe;
  onSuccess: (recipe: Recipe) => void;
  onCancel: () => void;
  // NUT-20 (bug real reportado por la PO) — antes este componente llamaba a `useIngredients()`
  // internamente, por lo que un ingrediente creado desde otra parte de la pantalla mientras
  // este formulario seguía montado nunca se reflejaba en el datalist de sugerencias hasta
  // recargar la página. Ahora el catálogo lo controla la página padre (que sí puede
  // `refetch()` tras crear un ingrediente) y se lo pasa por props.
  catalogIngredients: Ingredient[];
  catalogStatus: 'loading' | 'empty' | 'error' | 'success';
  // NUT-20 (séptima iteración, tester) — Hallazgo 2 (bloqueante) del cuarto review: invocado
  // con `true` justo antes de disparar la petición y con `false` cuando termina (éxito o
  // error), para que el `Modal` padre pueda dejar de ser cerrable mientras dura el guardado.
  onSubmittingChange?: (submitting: boolean) => void;
};

// Mismo patrón/convenciones que `IngredientForm.tsx` (Banner de error de servidor, inputs
// `type="text" inputMode="decimal"` para permitir distinguir "vacío" de "no numérico", botón
// de envío deshabilitado mientras la petición está pendiente). Ver `RecipeForm.test.tsx` para
// la fuente de verdad exacta de mensajes/testids/comportamiento (~30 aserciones).
const REQUIRED_TEXT_ERROR = 'Este campo es obligatorio.';
const REQUIRED_CATEGORY_ERROR = 'Seleccioná al menos una categoría.';
const INVALID_NUMBER_ERROR = 'Ingresá un valor numérico mayor o igual a 0.';
const INGREDIENTS_REQUIRED_ERROR = 'Agregá al menos un ingrediente completo.';
const INGREDIENT_ROW_INCOMPLETE_ERROR = 'Completá nombre, cantidad y unidad para esta fila.';
const INSTRUCTIONS_REQUIRED_ERROR = 'Agregá al menos un paso de preparación.';
const VALIDATION_ERROR = 'Revisá los campos del formulario e intentá de nuevo.';
const CONNECTIVITY_ERROR = 'No pudimos conectar. Revisá tu conexión e intentá de nuevo.';
const UNEXPECTED_ERROR = 'Ocurrió un error inesperado. Intentá de nuevo.';

// Id fijo (no `useId()`) a propósito: `useId()` genera ids con `:` (p. ej. ":r0:"), inválidos
// como selector CSS sin escapar (`document.querySelector('datalist#:r0:')` rompería). El
// test de sugerencias del catálogo hace exactamente ese `querySelector` sobre el `id` leído
// del atributo `list`, así que el id debe ser un token CSS simple.
const INGREDIENT_SUGGESTIONS_DATALIST_ID = 'recipe-ingredient-name-suggestions';

const ALL_CATEGORIES: RecipeCategory[] = [
  'VEGAN',
  'VEGETARIAN',
  'HIGH_PROTEIN',
  'GLUTEN_FREE',
  'DAIRY_FREE',
  'LOW_CARB',
  'OTHER',
];

type IngredientRowState = {
  name: string;
  quantity: string;
  unit: string;
};

function emptyRow(): IngredientRowState {
  return { name: '', quantity: '', unit: '' };
}

// >= 0 obligatorio (tiempos y valores nutricionales) — mismo criterio que
// `parseRequiredNumber` de `IngredientForm.tsx`.
function parseRequiredNonNegative(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  const value = Number(trimmed);
  if (Number.isNaN(value) || value < 0) {
    return null;
  }
  return value;
}

// > 0 estricto — sólo para la cantidad de cada fila de ingrediente.
function parseStrictlyPositive(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  const value = Number(trimmed);
  if (Number.isNaN(value) || value <= 0) {
    return null;
  }
  return value;
}

// Split por coma, trim, descarta vacíos — mismo criterio que `serializeProperties` de
// `IngredientForm.tsx`.
function serializeCommaList(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

// Split por línea, trim, descarta líneas en blanco.
function serializeInstructions(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

type FieldErrors = Partial<
  Record<
    | 'title'
    | 'categories'
    | 'prepMinutes'
    | 'cookMinutes'
    | 'description'
    | 'calories'
    | 'protein'
    | 'carbs'
    | 'fat'
    | 'ingredients'
    | 'instructions',
    string
  >
>;

export function RecipeForm({
  mode,
  initialValues,
  onSuccess,
  onCancel,
  onSubmittingChange,
  catalogIngredients,
  catalogStatus,
}: RecipeFormProps) {
  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [categories, setCategories] = useState<RecipeCategory[]>(initialValues?.categories ?? []);
  const [prepMinutes, setPrepMinutes] = useState(initialValues ? String(initialValues.prepMinutes) : '');
  const [cookMinutes, setCookMinutes] = useState(initialValues ? String(initialValues.cookMinutes) : '');
  const [description, setDescription] = useState(initialValues?.description ?? '');
  const [calories, setCalories] = useState(
    initialValues?.nutritionalValues ? String(initialValues.nutritionalValues.calories) : '',
  );
  const [protein, setProtein] = useState(
    initialValues?.nutritionalValues ? String(initialValues.nutritionalValues.protein) : '',
  );
  const [carbs, setCarbs] = useState(
    initialValues?.nutritionalValues ? String(initialValues.nutritionalValues.carbs) : '',
  );
  const [fat, setFat] = useState(
    initialValues?.nutritionalValues ? String(initialValues.nutritionalValues.fat) : '',
  );
  const [rows, setRows] = useState<IngredientRowState[]>(
    initialValues && initialValues.ingredients.length > 0
      ? initialValues.ingredients.map((item) => ({
          name: item.name,
          quantity: String(item.quantity),
          unit: item.unit,
        }))
      : [emptyRow()],
  );
  const [instructions, setInstructions] = useState(initialValues ? initialValues.instructions.join('\n') : '');
  const [properties, setProperties] = useState(initialValues ? initialValues.properties.join(', ') : '');

  const [errors, setErrors] = useState<FieldErrors>({});
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleCategory(category: RecipeCategory) {
    setCategories((current) =>
      current.includes(category) ? current.filter((entry) => entry !== category) : [...current, category],
    );
  }

  function updateRow(index: number, patch: Partial<IngredientRowState>) {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((current) => [...current, emptyRow()]);
    setRowErrors({});
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
    setRowErrors({});
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) {
      return;
    }

    const nextErrors: FieldErrors = {};
    const nextRowErrors: Record<number, string> = {};

    if (title.trim() === '') {
      nextErrors.title = REQUIRED_TEXT_ERROR;
    }

    if (categories.length === 0) {
      nextErrors.categories = REQUIRED_CATEGORY_ERROR;
    }

    const prepValue = parseRequiredNonNegative(prepMinutes);
    if (prepValue === null) {
      nextErrors.prepMinutes = INVALID_NUMBER_ERROR;
    }

    const cookValue = parseRequiredNonNegative(cookMinutes);
    if (cookValue === null) {
      nextErrors.cookMinutes = INVALID_NUMBER_ERROR;
    }

    if (description.trim() === '') {
      nextErrors.description = REQUIRED_TEXT_ERROR;
    }

    const caloriesValue = parseRequiredNonNegative(calories);
    if (caloriesValue === null) {
      nextErrors.calories = INVALID_NUMBER_ERROR;
    }

    const proteinValue = parseRequiredNonNegative(protein);
    if (proteinValue === null) {
      nextErrors.protein = INVALID_NUMBER_ERROR;
    }

    const carbsValue = parseRequiredNonNegative(carbs);
    if (carbsValue === null) {
      nextErrors.carbs = INVALID_NUMBER_ERROR;
    }

    const fatValue = parseRequiredNonNegative(fat);
    if (fatValue === null) {
      nextErrors.fat = INVALID_NUMBER_ERROR;
    }

    // Fila totalmente vacía (por defecto): se ignora en silencio, no cuenta como error de
    // fila puntual. Fila con datos parciales: error puntual de esa fila. Sólo si NINGUNA fila
    // queda completa se muestra el error general de "ingredients".
    const completedIngredients: RecipeIngredientItem[] = [];
    rows.forEach((row, index) => {
      const rowName = row.name.trim();
      const rowUnit = row.unit.trim();
      const rowQuantityValue = parseStrictlyPositive(row.quantity);
      const isRowEmpty = rowName === '' && row.quantity.trim() === '' && rowUnit === '';

      if (isRowEmpty) {
        return;
      }

      if (rowName !== '' && rowUnit !== '' && rowQuantityValue !== null) {
        completedIngredients.push({ name: rowName, quantity: rowQuantityValue, unit: rowUnit });
      } else {
        nextRowErrors[index] = INGREDIENT_ROW_INCOMPLETE_ERROR;
      }
    });

    if (completedIngredients.length === 0) {
      nextErrors.ingredients = INGREDIENTS_REQUIRED_ERROR;
    }

    const instructionsList = serializeInstructions(instructions);
    if (instructionsList.length === 0) {
      nextErrors.instructions = INSTRUCTIONS_REQUIRED_ERROR;
    }

    setErrors(nextErrors);
    setRowErrors(nextRowErrors);

    if (Object.keys(nextErrors).length > 0 || Object.keys(nextRowErrors).length > 0) {
      return;
    }

    const payload: CreateRecipeRequest = {
      title: title.trim(),
      categories,
      prepMinutes: prepValue as number,
      cookMinutes: cookValue as number,
      description: description.trim(),
      nutritionalValues: {
        calories: caloriesValue as number,
        protein: proteinValue as number,
        carbs: carbsValue as number,
        fat: fatValue as number,
      },
      ingredients: completedIngredients,
      instructions: instructionsList,
      properties: serializeCommaList(properties),
    };

    setSubmitError(null);
    setSubmitting(true);
    onSubmittingChange?.(true);

    try {
      // Modo editar: se envía el ESTADO COMPLETO actual del formulario, no un delta.
      const result =
        mode === 'edit' && initialValues
          ? await recipeService.update(initialValues.id, payload)
          : await recipeService.create(payload);
      onSuccess(result);
    } catch (error) {
      if (error instanceof RecipeRequestError) {
        if (error.kind === 'validation') {
          setSubmitError(VALIDATION_ERROR);
        } else if (error.kind === 'network' || error.kind === 'timeout') {
          setSubmitError(CONNECTIVITY_ERROR);
        } else {
          setSubmitError(UNEXPECTED_ERROR);
        }
      } else {
        setSubmitError(UNEXPECTED_ERROR);
      }
    } finally {
      setSubmitting(false);
      onSubmittingChange?.(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {submitError && <Banner variant="error" message={submitError} />}

      <div>
        <label htmlFor="recipe-title" className="mb-1 block text-sm font-medium text-neutral-700">
          Nombre de la Receta *
        </label>
        <input
          id="recipe-title"
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="min-h-[44px] w-full rounded-lg border border-brand-cream-dark bg-white px-4 text-sm text-neutral-900"
        />
        {errors.title && (
          <p data-testid="error-title" className="mt-1 text-xs text-red-600">
            {errors.title}
          </p>
        )}
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium text-neutral-700">Categorías *</span>
        <div className="flex flex-wrap gap-2">
          {ALL_CATEGORIES.map((category) => (
            <Pill
              key={category}
              label={RECIPE_CATEGORY_LABELS[category]}
              selected={categories.includes(category)}
              onClick={() => toggleCategory(category)}
            />
          ))}
        </div>
        {errors.categories && (
          <p data-testid="error-categories" className="mt-1 text-xs text-red-600">
            {errors.categories}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="recipe-prepMinutes" className="mb-1 block text-sm font-medium text-neutral-700">
            Tiempo de Preparación (min) *
          </label>
          <input
            id="recipe-prepMinutes"
            type="text"
            inputMode="decimal"
            value={prepMinutes}
            onChange={(event) => setPrepMinutes(event.target.value)}
            className="min-h-[44px] w-full rounded-lg border border-brand-cream-dark bg-white px-4 text-sm text-neutral-900"
          />
          {errors.prepMinutes && (
            <p data-testid="error-prepMinutes" className="mt-1 text-xs text-red-600">
              {errors.prepMinutes}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="recipe-cookMinutes" className="mb-1 block text-sm font-medium text-neutral-700">
            Tiempo de Cocción (min) *
          </label>
          <input
            id="recipe-cookMinutes"
            type="text"
            inputMode="decimal"
            value={cookMinutes}
            onChange={(event) => setCookMinutes(event.target.value)}
            className="min-h-[44px] w-full rounded-lg border border-brand-cream-dark bg-white px-4 text-sm text-neutral-900"
          />
          {errors.cookMinutes && (
            <p data-testid="error-cookMinutes" className="mt-1 text-xs text-red-600">
              {errors.cookMinutes}
            </p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="recipe-description" className="mb-1 block text-sm font-medium text-neutral-700">
          Descripción Breve *
        </label>
        <textarea
          id="recipe-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          className="w-full rounded-lg border border-brand-cream-dark bg-white px-4 py-2 text-sm text-neutral-900"
        />
        {errors.description && (
          <p data-testid="error-description" className="mt-1 text-xs text-red-600">
            {errors.description}
          </p>
        )}
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium text-neutral-700">Valores Nutricionales *</span>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="recipe-calories" className="mb-1 block text-sm font-medium text-neutral-700">
              Calorías (kcal) *
            </label>
            <input
              id="recipe-calories"
              type="text"
              inputMode="decimal"
              value={calories}
              onChange={(event) => setCalories(event.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-brand-cream-dark bg-white px-4 text-sm text-neutral-900"
            />
            {errors.calories && (
              <p data-testid="error-calories" className="mt-1 text-xs text-red-600">
                {errors.calories}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="recipe-protein" className="mb-1 block text-sm font-medium text-neutral-700">
              Proteínas (g) *
            </label>
            <input
              id="recipe-protein"
              type="text"
              inputMode="decimal"
              value={protein}
              onChange={(event) => setProtein(event.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-brand-cream-dark bg-white px-4 text-sm text-neutral-900"
            />
            {errors.protein && (
              <p data-testid="error-protein" className="mt-1 text-xs text-red-600">
                {errors.protein}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="recipe-carbs" className="mb-1 block text-sm font-medium text-neutral-700">
              Carbohidratos (g) *
            </label>
            <input
              id="recipe-carbs"
              type="text"
              inputMode="decimal"
              value={carbs}
              onChange={(event) => setCarbs(event.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-brand-cream-dark bg-white px-4 text-sm text-neutral-900"
            />
            {errors.carbs && (
              <p data-testid="error-carbs" className="mt-1 text-xs text-red-600">
                {errors.carbs}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="recipe-fat" className="mb-1 block text-sm font-medium text-neutral-700">
              Grasas (g) *
            </label>
            <input
              id="recipe-fat"
              type="text"
              inputMode="decimal"
              value={fat}
              onChange={(event) => setFat(event.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-brand-cream-dark bg-white px-4 text-sm text-neutral-900"
            />
            {errors.fat && (
              <p data-testid="error-fat" className="mt-1 text-xs text-red-600">
                {errors.fat}
              </p>
            )}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="block text-sm font-medium text-neutral-700">Ingredientes y Porciones *</span>
          <button type="button" onClick={addRow} className="text-sm font-semibold text-brand-green-dark">
            + Añadir fila
          </button>
        </div>

        {/* Datalist único compartido, referenciado por el atributo `list` de cada input de
            nombre de fila (ver comentario de `INGREDIENT_SUGGESTIONS_DATALIST_ID` arriba). Si
            el catálogo está vacío/en error, queda sin opciones pero el input sigue siendo
            texto libre funcional. */}
        <datalist id={INGREDIENT_SUGGESTIONS_DATALIST_ID}>
          {catalogStatus === 'success' &&
            catalogIngredients.map((ingredient) => <option key={ingredient.id} value={ingredient.name} />)}
        </datalist>

        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} data-testid={`ingredient-row-${index}`} className="flex flex-wrap items-start gap-2">
              <input
                type="text"
                aria-label={`Nombre del ingrediente, fila ${index + 1}`}
                data-testid={`ingredient-name-${index}`}
                list={INGREDIENT_SUGGESTIONS_DATALIST_ID}
                value={row.name}
                onChange={(event) => updateRow(index, { name: event.target.value })}
                className="min-h-[44px] flex-1 rounded-lg border border-brand-cream-dark bg-white px-4 text-sm text-neutral-900"
              />
              <input
                type="text"
                inputMode="decimal"
                aria-label={`Cantidad del ingrediente, fila ${index + 1}`}
                data-testid={`ingredient-quantity-${index}`}
                value={row.quantity}
                onChange={(event) => updateRow(index, { quantity: event.target.value })}
                className="min-h-[44px] w-20 rounded-lg border border-brand-cream-dark bg-white px-2 text-sm text-neutral-900"
              />
              <input
                type="text"
                aria-label={`Unidad del ingrediente, fila ${index + 1}`}
                data-testid={`ingredient-unit-${index}`}
                value={row.unit}
                onChange={(event) => updateRow(index, { unit: event.target.value })}
                className="min-h-[44px] w-20 rounded-lg border border-brand-cream-dark bg-white px-2 text-sm text-neutral-900"
              />
              <button
                type="button"
                aria-label={`Eliminar fila ${index + 1}`}
                data-testid={`remove-ingredient-row-${index}`}
                onClick={() => removeRow(index)}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-neutral-500 hover:bg-brand-cream-dark"
              >
                <span aria-hidden="true">✕</span>
              </button>
              {rowErrors[index] && (
                <p data-testid={`error-ingredient-row-${index}`} className="w-full text-xs text-red-600">
                  {rowErrors[index]}
                </p>
              )}
            </div>
          ))}
        </div>
        {errors.ingredients && (
          <p data-testid="error-ingredients" className="mt-1 text-xs text-red-600">
            {errors.ingredients}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="recipe-instructions" className="mb-1 block text-sm font-medium text-neutral-700">
          Pasos de Preparación *
        </label>
        <textarea
          id="recipe-instructions"
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          rows={4}
          placeholder="Un paso por línea"
          className="w-full rounded-lg border border-brand-cream-dark bg-white px-4 py-2 text-sm text-neutral-900"
        />
        {errors.instructions && (
          <p data-testid="error-instructions" className="mt-1 text-xs text-red-600">
            {errors.instructions}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="recipe-properties" className="mb-1 block text-sm font-medium text-neutral-700">
          Propiedades y Restricciones
        </label>
        <input
          id="recipe-properties"
          type="text"
          value={properties}
          onChange={(event) => setProperties(event.target.value)}
          placeholder="Separadas por comas, por ejemplo: Vegano, Sin Gluten"
          className="min-h-[44px] w-full rounded-lg border border-brand-cream-dark bg-white px-4 text-sm text-neutral-900"
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="min-h-[44px] rounded-lg bg-brand-cream-dark px-6 text-sm font-semibold text-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="min-h-[44px] rounded-lg bg-brand-green px-6 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mode === 'edit' ? 'Guardar Cambios' : 'Guardar Receta'}
        </button>
      </div>
    </form>
  );
}
