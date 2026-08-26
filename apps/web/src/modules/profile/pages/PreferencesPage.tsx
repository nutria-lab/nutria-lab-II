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
      <main className="mx-auto max-w-md px-4 py-8 text-center text-sm text-neutral-500">
        Cargando tus preferencias...
      </main>
    );
  }

  const isFormValid = Boolean(formState.goal && formState.diet && formState.cookTimePreference);

  return (
    <main className="mx-auto max-w-md space-y-6 px-4 py-6">
      <h1 className="font-serif text-2xl font-bold text-neutral-900">Preferencias alimentarias</h1>

      {status === 'success' && (
        <Banner variant="success" message="Tus preferencias se guardaron correctamente" />
      )}
      {status === 'error' && errorMessage && <Banner variant="error" message={errorMessage} />}

      <p className="text-sm text-neutral-600">
        Ajustá tus preferencias para recibir mejores sugerencias.
      </p>

      <section className="space-y-3">
        <h2 className="font-serif text-lg font-semibold text-neutral-900">¿Cuál es tu objetivo principal?</h2>
        <GoalSelector value={formState.goal} onChange={(goal) => setFormState({ ...formState, goal })} />
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-lg font-semibold text-neutral-900">Preferencias y alergias</h2>

        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Elegí una dieta</p>
          <DietPills value={formState.diet} onChange={(diet) => setFormState({ ...formState, diet })} />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Excluir ingredientes</p>
          <ExcludeIngredientsPills
            value={formState.excludedIngredients}
            onChange={(excludedIngredients) => setFormState({ ...formState, excludedIngredients })}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-lg font-semibold text-neutral-900">Tiempo de cocina preferido</h2>
        <CookTimeSelector
          value={formState.cookTimePreference}
          onChange={(cookTimePreference) => setFormState({ ...formState, cookTimePreference })}
        />
      </section>

      <button
        type="button"
        disabled={!isFormValid || status === 'saving'}
        onClick={() => save(formState)}
        className="w-full rounded-lg bg-brand-green py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
      >
        {status === 'saving' ? 'Guardando...' : 'Guardar preferencias'}
      </button>
    </main>
  );
}
