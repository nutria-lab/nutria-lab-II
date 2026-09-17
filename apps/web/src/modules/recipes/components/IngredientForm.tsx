import { useState, type FormEvent } from 'react';

import { Banner } from '../../../common/components/Banner';
import {
  ingredientService,
  IngredientRequestError,
  type CreateIngredientRequest,
  type Ingredient,
  type IngredientType,
} from '../../../services/ingredientService';
import { INGREDIENT_TYPE_LABELS } from '../labels';

type IngredientFormProps = {
  onSuccess: (ingredient: Ingredient) => void;
  onCancel: () => void;
  // NUT-20 (séptima iteración, tester) — Hallazgo 2 (bloqueante) del cuarto review: invocado
  // con `true` justo antes de disparar la petición y con `false` cuando termina (éxito o
  // error), para que el `Modal` padre pueda dejar de ser cerrable mientras dura el guardado.
  onSubmittingChange?: (submitting: boolean) => void;
};

const REQUIRED_TEXT_ERROR = 'Este campo es obligatorio.';
const REQUIRED_TYPE_ERROR = 'Seleccioná un tipo.';
const INVALID_NUMBER_ERROR = 'Ingresá un valor numérico mayor o igual a 0.';
const CONFLICT_ERROR = 'Ya existe un ingrediente con ese nombre.';
const VALIDATION_ERROR = 'Revisá los campos del formulario e intentá de nuevo.';
const CONNECTIVITY_ERROR = 'No pudimos conectar. Revisá tu conexión e intentá de nuevo.';
const UNEXPECTED_ERROR = 'Ocurrió un error inesperado. Intentá de nuevo.';

// Fuente única de verdad de las etiquetas: `labels.ts` (`INGREDIENT_TYPE_LABELS`).
const INGREDIENT_TYPE_OPTIONS: { value: IngredientType; label: string }[] = (
  Object.entries(INGREDIENT_TYPE_LABELS) as [IngredientType, string][]
).map(([value, label]) => ({ value, label }));

type FieldErrors = Partial<
  Record<'name' | 'type' | 'defaultUnit' | 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber' | 'sodium', string>
>;

// Devuelve el número parseado si `raw` es un texto obligatorio numérico válido (>= 0), o
// `null` si está vacío/no es numérico/es negativo — en todos esos casos el llamador debe
// mostrar INVALID_NUMBER_ERROR. Ver criterio del tester en IngredientForm.test.tsx: los
// inputs son `type="text" inputMode="decimal"`, no `type="number"`, para poder distinguir
// "vacío" de "no numérico" de forma determinística.
function parseRequiredNumber(raw: string): number | null {
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

// Para campos numéricos opcionales (fibra/sodio): vacío es válido (no se envía), cualquier
// otro valor debe ser numérico y >= 0.
function parseOptionalNumber(raw: string): { value?: number; invalid: boolean } {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { invalid: false };
  }
  const value = Number(trimmed);
  if (Number.isNaN(value) || value < 0) {
    return { invalid: true };
  }
  return { value, invalid: false };
}

function serializeProperties(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

export function IngredientForm({ onSuccess, onCancel, onSubmittingChange }: IngredientFormProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<IngredientType | ''>('');
  const [description, setDescription] = useState('');
  const [defaultUnit, setDefaultUnit] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fiber, setFiber] = useState('');
  const [sodium, setSodium] = useState('');
  const [properties, setProperties] = useState('');

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) {
      return;
    }

    const nextErrors: FieldErrors = {};

    if (name.trim() === '') {
      nextErrors.name = REQUIRED_TEXT_ERROR;
    }

    if (type === '') {
      nextErrors.type = REQUIRED_TYPE_ERROR;
    }

    if (defaultUnit.trim() === '') {
      nextErrors.defaultUnit = REQUIRED_TEXT_ERROR;
    }

    const caloriesValue = parseRequiredNumber(calories);
    if (caloriesValue === null) {
      nextErrors.calories = INVALID_NUMBER_ERROR;
    }

    const proteinValue = parseRequiredNumber(protein);
    if (proteinValue === null) {
      nextErrors.protein = INVALID_NUMBER_ERROR;
    }

    const carbsValue = parseRequiredNumber(carbs);
    if (carbsValue === null) {
      nextErrors.carbs = INVALID_NUMBER_ERROR;
    }

    const fatValue = parseRequiredNumber(fat);
    if (fatValue === null) {
      nextErrors.fat = INVALID_NUMBER_ERROR;
    }

    const fiberResult = parseOptionalNumber(fiber);
    if (fiberResult.invalid) {
      nextErrors.fiber = INVALID_NUMBER_ERROR;
    }

    const sodiumResult = parseOptionalNumber(sodium);
    if (sodiumResult.invalid) {
      nextErrors.sodium = INVALID_NUMBER_ERROR;
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const payload: CreateIngredientRequest = {
      name: name.trim(),
      ...(description.trim() !== '' ? { description: description.trim() } : {}),
      type: type as IngredientType,
      defaultUnit: defaultUnit.trim(),
      nutritionalValues: {
        calories: caloriesValue as number,
        protein: proteinValue as number,
        carbs: carbsValue as number,
        fat: fatValue as number,
        ...(fiberResult.value !== undefined ? { fiber: fiberResult.value } : {}),
        ...(sodiumResult.value !== undefined ? { sodium: sodiumResult.value } : {}),
      },
      properties: serializeProperties(properties),
    };

    setSubmitError(null);
    setSubmitting(true);
    onSubmittingChange?.(true);

    try {
      const created = await ingredientService.create(payload);
      onSuccess(created);
    } catch (error) {
      if (error instanceof IngredientRequestError) {
        if (error.kind === 'conflict') {
          setSubmitError(CONFLICT_ERROR);
        } else if (error.kind === 'validation') {
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
        <label htmlFor="ingredient-name" className="mb-1 block text-sm font-medium text-neutral-700">
          Nombre *
        </label>
        <input
          id="ingredient-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="min-h-[44px] w-full rounded-lg border border-brand-cream-dark bg-white px-4 text-sm text-neutral-900"
        />
        {errors.name && (
          <p data-testid="error-name" className="mt-1 text-xs text-red-600">
            {errors.name}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="ingredient-type" className="mb-1 block text-sm font-medium text-neutral-700">
          Tipo *
        </label>
        <select
          id="ingredient-type"
          value={type}
          onChange={(event) => setType(event.target.value as IngredientType | '')}
          className="min-h-[44px] w-full rounded-lg border border-brand-cream-dark bg-white px-4 text-sm text-neutral-900"
        >
          <option value="">Seleccioná un tipo</option>
          {INGREDIENT_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {errors.type && (
          <p data-testid="error-type" className="mt-1 text-xs text-red-600">
            {errors.type}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="ingredient-description" className="mb-1 block text-sm font-medium text-neutral-700">
          Descripción
        </label>
        <textarea
          id="ingredient-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          className="w-full rounded-lg border border-brand-cream-dark bg-white px-4 py-2 text-sm text-neutral-900"
        />
      </div>

      <div>
        <label htmlFor="ingredient-default-unit" className="mb-1 block text-sm font-medium text-neutral-700">
          Unidad de Medida Habitual *
        </label>
        <input
          id="ingredient-default-unit"
          type="text"
          value={defaultUnit}
          onChange={(event) => setDefaultUnit(event.target.value)}
          className="min-h-[44px] w-full rounded-lg border border-brand-cream-dark bg-white px-4 text-sm text-neutral-900"
        />
        {errors.defaultUnit && (
          <p data-testid="error-defaultUnit" className="mt-1 text-xs text-red-600">
            {errors.defaultUnit}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="ingredient-calories" className="mb-1 block text-sm font-medium text-neutral-700">
            Calorías (kcal) *
          </label>
          <input
            id="ingredient-calories"
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
          <label htmlFor="ingredient-protein" className="mb-1 block text-sm font-medium text-neutral-700">
            Proteínas (g) *
          </label>
          <input
            id="ingredient-protein"
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
          <label htmlFor="ingredient-carbs" className="mb-1 block text-sm font-medium text-neutral-700">
            Carbohidratos (g) *
          </label>
          <input
            id="ingredient-carbs"
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
          <label htmlFor="ingredient-fat" className="mb-1 block text-sm font-medium text-neutral-700">
            Grasas (g) *
          </label>
          <input
            id="ingredient-fat"
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

        <div>
          <label htmlFor="ingredient-fiber" className="mb-1 block text-sm font-medium text-neutral-700">
            Fibra (g)
          </label>
          <input
            id="ingredient-fiber"
            type="text"
            inputMode="decimal"
            value={fiber}
            onChange={(event) => setFiber(event.target.value)}
            className="min-h-[44px] w-full rounded-lg border border-brand-cream-dark bg-white px-4 text-sm text-neutral-900"
          />
          {errors.fiber && (
            <p data-testid="error-fiber" className="mt-1 text-xs text-red-600">
              {errors.fiber}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="ingredient-sodium" className="mb-1 block text-sm font-medium text-neutral-700">
            Sodio (mg)
          </label>
          <input
            id="ingredient-sodium"
            type="text"
            inputMode="decimal"
            value={sodium}
            onChange={(event) => setSodium(event.target.value)}
            className="min-h-[44px] w-full rounded-lg border border-brand-cream-dark bg-white px-4 text-sm text-neutral-900"
          />
          {errors.sodium && (
            <p data-testid="error-sodium" className="mt-1 text-xs text-red-600">
              {errors.sodium}
            </p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="ingredient-properties" className="mb-1 block text-sm font-medium text-neutral-700">
          Propiedades y Restricciones
        </label>
        <input
          id="ingredient-properties"
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
          Guardar Ingrediente
        </button>
      </div>
    </form>
  );
}
