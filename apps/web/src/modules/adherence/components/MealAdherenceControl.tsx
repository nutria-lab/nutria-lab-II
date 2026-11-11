import type { ChangeEvent } from 'react';
import { useId } from 'react';
import type { AdherenceMeal, MealCompletionStatus } from '../types';

export type MealAdherenceControlProps = {
  /** Meal from contract A; status and server-calculated canEdit are authoritative. */
  meal: AdherenceMeal;
  /** Container sets true immediately when handling an intent, blocking further actions. */
  pending: boolean;
  /** Container-owned failure text; null removes the alert. Rendered as plain text. */
  error: string | null;
  /** Dense layout for the seven-column weekly grid. */
  compact?: boolean;
  /** Intent only. Container owns HTTP, error recovery and refreshed confirmed props. */
  onSetStatus: (status: MealCompletionStatus) => void;
};

const choices: { status: MealCompletionStatus; label: string }[] = [
  { status: 'NOT_LOGGED', label: 'Sin registrar' },
  { status: 'COMPLETED', label: 'Completada' },
  { status: 'SKIPPED', label: 'Omitida' },
];

const labels: Record<MealCompletionStatus, string> = {
  COMPLETED: 'Completada',
  SKIPPED: 'Omitida',
  NOT_LOGGED: 'Sin registrar',
};
const statusStyles: Record<MealCompletionStatus, string> = {
  NOT_LOGGED: 'border-outline-variant bg-surface-container-low text-on-surface-variant',
  COMPLETED: 'border-brand-green-dark/30 bg-primary-fixed/50 text-brand-green-dark',
  SKIPPED: 'border-tertiary/40 bg-tertiary-fixed/60 text-on-tertiary-container',
};
const statusIconStyles: Record<MealCompletionStatus, string> = {
  NOT_LOGGED: 'text-on-surface-variant',
  COMPLETED: 'text-brand-green-dark',
  SKIPPED: 'text-on-tertiary-container',
};

const readOnlyMessage = 'Esta comida no está disponible para registrar cambios. Solo se pueden registrar comidas de hoy o anteriores del plan vigente.';

/** Compact, controlled status selector. The meal name lives in the containing card. */
export function MealAdherenceControl({ meal, pending, error, compact = false, onSetStatus }: MealAdherenceControlProps) {
  const id = useId();
  const blocked = pending || !meal.canEdit;

  function select(event: ChangeEvent<HTMLSelectElement>) {
    const nextStatus = event.currentTarget.value as MealCompletionStatus;
    if (!blocked && nextStatus !== meal.status) onSetStatus(nextStatus);
  }

  return (
    <section className={`min-w-0 border-t border-outline-variant/30 text-on-surface ${compact ? 'mt-2 pt-2' : 'mt-3 pt-3'}`}>
      <div
        role="group"
        aria-labelledby={`${id}-legend ${id}-meal-name`}
        aria-describedby={!meal.canEdit ? `${id}-locked` : undefined}
        className="flex min-w-0 items-center gap-2"
      >
        <span id={`${id}-meal-name`} className="sr-only">{meal.title}</span>
        <label id={`${id}-legend`} htmlFor={`${id}-status`} className={`shrink-0 font-semibold text-on-surface-variant ${compact ? 'text-[10px]' : 'text-xs'}`}>
          Estado
        </label>
        <div className="relative min-w-0 flex-1">
          <select
            id={`${id}-status`}
            aria-label={`Estado de ${meal.title}`}
            aria-describedby={!meal.canEdit ? `${id}-locked` : undefined}
            aria-busy={pending}
            value={meal.status}
            disabled={blocked}
            onChange={select}
            className={`w-full appearance-none rounded-lg border bg-white font-body font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green-dark disabled:cursor-not-allowed disabled:opacity-80 ${statusStyles[meal.status]} ${compact ? 'min-h-8 px-2 pr-7 text-[10px]' : 'min-h-10 px-3 pr-9 text-xs sm:min-h-11 sm:text-sm'}`}
          >
            {choices.map(({ status, label }) => <option key={status} value={status}>{label}</option>)}
          </select>
          <span aria-hidden="true" className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 ${statusIconStyles[meal.status]} ${compact ? 'text-sm' : 'text-base'} material-symbols-outlined`}>
            expand_more
          </span>
        </div>

        {!meal.canEdit && (
          <div className="group/info relative shrink-0">
            <button
              type="button"
              aria-label={`Información de disponibilidad para ${meal.title}`}
              aria-describedby={`${id}-locked`}
              className={`flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-green-dark ${compact ? 'h-7 w-7' : 'h-9 w-9'}`}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-base">info</span>
            </button>
            <span
              role="tooltip"
              aria-hidden="true"
              className="pointer-events-none invisible absolute right-0 top-full z-50 mt-1 w-56 max-w-[calc(100vw-2rem)] rounded-lg bg-on-surface p-3 text-left text-xs font-medium leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover/info:visible group-hover/info:opacity-100 group-focus-within/info:visible group-focus-within/info:opacity-100"
            >
              {readOnlyMessage}
            </span>
            <span id={`${id}-locked`} className="sr-only">{readOnlyMessage}</span>
          </div>
        )}
      </div>

      <p role="status" aria-atomic="true" className={pending ? `mt-1 font-semibold text-brand-green ${compact ? 'text-[10px]' : 'text-xs'}` : 'sr-only'}>
        {pending ? 'Guardando…' : `Estado actual: ${labels[meal.status]}`}
      </p>
      {error !== null && <p role="alert" className={`mt-2 rounded-lg bg-error-container leading-snug text-on-error-container ${compact ? 'p-2 text-[10px]' : 'p-3 text-xs'}`}>{error}</p>}
    </section>
  );
}
