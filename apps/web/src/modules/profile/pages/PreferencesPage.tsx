import { useEffect, useState } from 'react';
import { useNutritionProfile } from '../hooks/useNutritionProfile';
import { GoalSelector } from '../components/GoalSelector';
import { DietPills } from '../components/DietPills';
import { ExcludeIngredientsPills } from '../components/ExcludeIngredientsPills';
import { CookTimeSelector } from '../components/CookTimeSelector';
import { Banner } from '../../../common/components/Banner';
import type { NutritionProfile } from '../../../services/nutritionProfileService';

export function PreferencesPage() {
  const { profile, status, errorMessage, save } = useNutritionProfile();
  const [formState, setFormState] = useState<NutritionProfile | null>(null);

  useEffect(() => {
    if (profile && !formState) {
      setFormState(profile);
    }
  }, [profile, formState]);

  if (status === 'loading' || !formState) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8 text-center text-sm text-neutral-500 md:px-8">
        Cargando tus preferencias...
      </main>
    );
  }

  const isFormValid = Boolean(formState.goal && formState.diet && formState.cookTimePreference);
  const isSaving = status === 'saving';

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 md:px-8">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl font-bold text-neutral-900">Preferencias alimentarias</h1>
        <span className="hidden h-10 w-10 shrink-0 rounded-full bg-brand-green md:block" aria-hidden="true" />
      </div>

      {status === 'success' && (
        <Banner variant="success" message="Tus preferencias se guardaron correctamente" />
      )}
      {status === 'error' && errorMessage && <Banner variant="error" message={errorMessage} />}

      <p className="text-sm text-neutral-600">
        Ajustá tus preferencias para recibir mejores sugerencias.
      </p>

      <section className="space-y-3">
        <h2 className="font-serif text-lg font-semibold text-neutral-900">¿Cuál es tu objetivo principal?</h2>
        <GoalSelector
          value={formState.goal}
          disabled={isSaving}
          onChange={(goal) => setFormState({ ...formState, goal })}
        />
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-lg font-semibold text-neutral-900">Preferencias y alergias</h2>

        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Elegí una dieta</p>
          <DietPills
            value={formState.diet}
            disabled={isSaving}
            onChange={(diet) => setFormState({ ...formState, diet })}
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Excluir ingredientes</p>
          <ExcludeIngredientsPills
            value={formState.excludedIngredients}
            disabled={isSaving}
            onChange={(excludedIngredients) => setFormState({ ...formState, excludedIngredients })}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-lg font-semibold text-neutral-900">Tiempo de cocina preferido</h2>
        <CookTimeSelector
          value={formState.cookTimePreference}
          disabled={isSaving}
          onChange={(cookTimePreference) => setFormState({ ...formState, cookTimePreference })}
        />
      </section>

      <div className="flex flex-col gap-3 md:flex-row md:justify-end">
        <button
          type="button"
          disabled={isSaving}
          className="hidden rounded-lg border border-neutral-300 px-6 py-3 text-sm font-semibold text-neutral-700 transition-opacity hover:bg-neutral-100 disabled:opacity-50 md:block"
        >
          Volver al perfil
        </button>
        <button
          type="button"
          disabled={!isFormValid || isSaving}
          onClick={() => save(formState)}
          className="w-full rounded-lg bg-brand-green py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-50 md:w-auto md:px-6"
        >
          {isSaving ? 'Guardando...' : 'Guardar preferencias'}
        </button>
      </div>
    </main>
  );
}
