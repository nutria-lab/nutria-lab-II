import { useEffect, useState } from 'react';
import { useNutritionProfile } from '../hooks/useNutritionProfile';
import { GoalSelector } from '../components/GoalSelector';
import { DietPills } from '../components/DietPills';
import { ExcludeIngredientsPills } from '../components/ExcludeIngredientsPills';
import { CookTimeSelector } from '../components/CookTimeSelector';
import { Banner } from '../../../common/components/Banner';
import type { NutritionProfile } from '../../../services/nutritionProfileService';

export function PreferencesPage() {
  const { profile, isNewProfile, status, errorMessage, save, retry } = useNutritionProfile();
  const [formState, setFormState] = useState<NutritionProfile | null>(null);

  useEffect(() => {
    if (profile && !formState) {
      setFormState(profile);
    }
  }, [profile, formState]);

  if (status === 'error' && !formState) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-error-container/30">
          <span className="material-symbols-outlined text-2xl text-error">error</span>
        </div>
        <p className="font-headline text-lg font-semibold text-on-surface">Algo salió mal</p>
        <p className="mt-2 text-sm text-on-surface-variant">
          {errorMessage ?? 'No pudimos cargar tus preferencias.'}
        </p>
        <button
          type="button"
          onClick={retry}
          className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-brand-green py-4 px-6 text-base font-bold text-on-primary shadow-lg shadow-brand-green/20 transition-all hover:opacity-90 active:scale-[0.98]"
        >
          Reintentar
        </button>
      </main>
    );
  }

  if (status === 'loading' || !formState) {
    return (
      <main className="mx-auto max-w-7xl animate-pulse space-y-6 px-4 py-8 md:px-8">
        <span className="sr-only">Cargando tus preferencias...</span>
        <div className="h-10 w-64 rounded-xl bg-surface-container" />
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-4">
            <div className="h-48 rounded-xl bg-surface-container" />
          </div>
          <div className="space-y-4 lg:col-span-8">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 rounded-xl bg-surface-container" />
            ))}
          </div>
        </div>
      </main>
    );
  }

  const isFormValid = Boolean(formState.goal && formState.diet && formState.cookTimePreference);
  const isSaving = status === 'saving';

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 md:px-8">
      {/* Page heading */}
      <section className="mb-10">
        <h1 className="font-headline text-4xl font-bold text-on-surface mb-2">
          Personalizá tu experiencia
        </h1>
        <p className="max-w-2xl leading-relaxed text-on-surface-variant">
          Ajustá tus preferencias para que NutrIA te sugiera las recetas más nutritivas para tu estilo de vida.
        </p>
      </section>

      {/* Banners */}
      {status === 'success' && (
        <div className="mb-6">
          <Banner variant="success" message="Tus preferencias se guardaron correctamente" />
        </div>
      )}
      {status === 'error' && errorMessage && (
        <div className="mb-6">
          <Banner variant="error" message={errorMessage} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">

        {/* ── Left column: progress + decoration ── */}
        <div className="space-y-6 lg:col-span-4">
          {/* Setup progress card */}
          <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-6">
            <h3 className="mb-6 text-sm font-bold uppercase tracking-wider text-tertiary">
              Tu perfil
            </h3>
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-green text-sm font-bold text-on-primary">
                  <span className="material-symbols-outlined text-base">check</span>
                </div>
                <div>
                  <p className="text-sm font-bold text-on-surface">Objetivo</p>
                  <p className="text-xs text-on-surface-variant">
                    {formState.goal ? 'Completado' : 'Pendiente'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${formState.diet ? 'bg-brand-green text-on-primary' : 'bg-surface-container-highest text-on-surface-variant'}`}>
                  {formState.diet
                    ? <span className="material-symbols-outlined text-base">check</span>
                    : '2'
                  }
                </div>
                <div>
                  <p className="text-sm font-bold text-on-surface">Dieta</p>
                  <p className="text-xs text-on-surface-variant">
                    {formState.diet ? 'Completado' : 'Pendiente'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${formState.cookTimePreference ? 'bg-brand-green text-on-primary' : 'bg-surface-container-highest text-on-surface-variant'}`}>
                  {formState.cookTimePreference
                    ? <span className="material-symbols-outlined text-base">check</span>
                    : '3'
                  }
                </div>
                <div>
                  <p className="text-sm font-bold text-on-surface">Tiempo de cocina</p>
                  <p className="text-xs text-on-surface-variant">
                    {formState.cookTimePreference ? 'Completado' : 'Pendiente'}
                  </p>
                </div>
              </div>
            </div>
            {/* Progress bar */}
            <div className="mt-8 border-t border-outline-variant/30 pt-6">
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-highest">
                <div
                  className="h-full rounded-full bg-brand-green transition-all duration-500"
                  style={{
                    width: `${
                      ([formState.goal, formState.diet, formState.cookTimePreference].filter(Boolean).length / 3) * 100
                    }%`,
                  }}
                />
              </div>
              <p className="mt-2 text-right text-xs text-on-surface-variant">
                {Math.round(
                  ([formState.goal, formState.diet, formState.cookTimePreference].filter(Boolean).length / 3) * 100,
                )}% completado
              </p>
            </div>
          </div>

          {/* Info callout (new profile) */}
          {isNewProfile && status === 'idle' && (
            <div className="flex items-start gap-4 rounded-xl bg-tertiary-container/20 p-5">
              <span className="material-symbols-outlined shrink-0 text-tertiary">info</span>
              <p className="text-sm italic leading-relaxed text-on-tertiary-container">
                Todavía no tenés preferencias guardadas — completá el formulario para crear tu perfil.
              </p>
            </div>
          )}
        </div>

        {/* ── Right column: form sections ── */}
        <div className="space-y-6 lg:col-span-8">

          {/* Section: Goal */}
          <div className="rounded-xl border border-surface-container-high bg-white p-8 shadow-[0_4px_20px_rgba(46,50,48,0.06)]">
            <div className="mb-6 flex items-center gap-3">
              <span className="material-symbols-outlined text-brand-green">flag</span>
              <h2 className="font-headline text-xl font-bold">¿Cuál es tu objetivo principal?</h2>
            </div>
            <GoalSelector
              value={formState.goal}
              disabled={isSaving}
              onChange={(goal) => setFormState({ ...formState, goal })}
            />
          </div>

          {/* Section: Diet & Exclusions */}
          <div className="rounded-xl border border-surface-container-high bg-white p-8 shadow-[0_4px_20px_rgba(46,50,48,0.06)]">
            <div className="mb-8 flex items-center gap-3">
              <span className="material-symbols-outlined text-brand-green">restaurant</span>
              <h2 className="font-headline text-xl font-bold">Preferencias y restricciones</h2>
            </div>
            <div className="space-y-8">
              <div>
                <p className="mb-4 flex items-center gap-2 text-sm font-bold text-on-surface-variant">
                  <span className="material-symbols-outlined icon-filled text-xs">circle</span>
                  ELEGÍ UNA DIETA
                </p>
                <DietPills
                  value={formState.diet}
                  disabled={isSaving}
                  onChange={(diet) => setFormState({ ...formState, diet })}
                />
                <div className="mt-4 flex items-start gap-3 rounded-xl bg-tertiary-container/20 p-4">
                  <span className="material-symbols-outlined shrink-0 text-sm text-tertiary">info</span>
                  <p className="text-xs italic leading-relaxed text-on-tertiary-container">
                    Ajustaremos los ingredientes automáticamente para que nunca falten los macronutrientes esenciales según tu elección.
                  </p>
                </div>
              </div>
              <div>
                <p className="mb-4 flex items-center gap-2 text-sm font-bold text-on-surface-variant">
                  <span className="material-symbols-outlined icon-filled text-xs">circle</span>
                  EXCLUIR INGREDIENTES
                </p>
                <ExcludeIngredientsPills
                  value={formState.excludedIngredients}
                  disabled={isSaving}
                  onChange={(excludedIngredients) => setFormState({ ...formState, excludedIngredients })}
                />
              </div>
            </div>
          </div>

          {/* Section: Cook time */}
          <div className="rounded-xl border border-surface-container-high bg-white p-8 shadow-[0_4px_20px_rgba(46,50,48,0.06)]">
            <div className="mb-6 flex items-center gap-3">
              <span className="material-symbols-outlined text-brand-green">schedule</span>
              <h2 className="font-headline text-xl font-bold">Tiempo de cocina preferido</h2>
            </div>
            <CookTimeSelector
              value={formState.cookTimePreference}
              disabled={isSaving}
              onChange={(cookTimePreference) => setFormState({ ...formState, cookTimePreference })}
            />
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-between pt-2 pb-8">
            <button
              type="button"
              disabled={isSaving}
              className="rounded-xl border border-outline px-8 py-3 font-bold text-on-surface-variant transition-colors hover:bg-surface-container disabled:opacity-50"
            >
              Volver al perfil
            </button>
            <button
              type="button"
              disabled={!isFormValid || isSaving}
              onClick={() => save(formState)}
              className="flex items-center gap-2 rounded-xl bg-brand-green px-12 py-3 font-bold text-on-primary shadow-lg shadow-brand-green/20 transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent" />
                  Guardando...
                </>
              ) : (
                'Guardar preferencias'
              )}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
