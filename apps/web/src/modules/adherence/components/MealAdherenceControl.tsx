import { useId } from 'react';
import type { AdherenceMeal, MealCompletionStatus } from '../types';

export type MealAdherenceControlProps = {
  /** Meal from contract A; status and server-calculated canEdit are authoritative. */
  meal: AdherenceMeal;
  /** Container sets true immediately when handling an intent, blocking further actions. */
  pending: boolean;
  /** Container-owned failure text; null removes the alert. Rendered as plain text. */
  error: string | null;
  /** Intent only. Container owns HTTP, error recovery and refreshed confirmed props. */
  onSetStatus: (status: MealCompletionStatus) => void;
};

const choices: { status: MealCompletionStatus; label: string }[] = [
  { status: 'COMPLETED', label: 'Completada' },
  { status: 'SKIPPED', label: 'Omitida' },
  { status: 'NOT_LOGGED', label: 'Sin registrar' },
];
const labels: Record<MealCompletionStatus, string> = {
  COMPLETED: 'Completada', SKIPPED: 'Omitida', NOT_LOGGED: 'Sin registrar',
};

/** Controlled presentation: no optimistic selection, authorization or transport effects. */
export function MealAdherenceControl({ meal, pending, error, onSetStatus }: MealAdherenceControlProps) {
  const id = useId();
  const blocked = pending || !meal.canEdit;

  function select(status: MealCompletionStatus) {
    if (!blocked && status !== meal.status) onSetStatus(status);
  }

  return (
    <section className="@container min-w-0 rounded-2xl border border-outline-variant bg-surface-container-low p-5 text-on-surface shadow-[0_3px_12px_rgba(46,50,48,0.05)] [overflow-wrap:anywhere]">
      <p className="mb-1.5 text-[0.8rem] font-bold text-on-surface-variant">Registro de comida</p>
      <h3 id={`${id}-title`} className="mb-4 font-headline text-xl font-semibold leading-relaxed">{meal.title}</h3>
      <div
        role="group"
        aria-labelledby={`${id}-legend ${id}-title`}
        aria-describedby={!meal.canEdit ? `${id}-locked` : undefined}
        aria-busy={pending}
        className="grid min-w-0 grid-cols-1 gap-2 @min-[28rem]:grid-cols-3"
      >
        <span id={`${id}-legend`} className="sr-only">Estado de</span>
        {choices.map(({ status, label }) => {
          const selected = meal.status === status;
          const selectedStyle = selected
            ? status === 'COMPLETED'
              ? 'border-2 border-brand-green-dark bg-brand-green-dark text-on-primary'
              : status === 'SKIPPED'
                ? 'border-2 border-tertiary bg-tertiary-fixed text-on-tertiary-container'
                : 'border-2 bg-surface-container-high'
            : '';

          return (
            <button
              key={status}
              type="button"
              aria-pressed={selected}
              aria-disabled={blocked}
              data-status={status}
              onClick={() => select(status)}
              className={`flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-[0.65rem] border border-outline bg-brand-cream px-2 py-2.5 text-center font-body font-bold leading-snug text-on-surface focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-brand-green-dark aria-disabled:cursor-not-allowed aria-disabled:border-dashed ${blocked ? '' : 'hover:shadow-[inset_0_0_0_1px_currentColor]'} ${selectedStyle}`}
            >
              <span aria-hidden="true" className="shrink-0">{selected ? '✓' : '◯'}</span>
              {label}
            </button>
          );
        })}
      </div>
      <p role="status" aria-atomic="true" className="mt-3.5 text-sm font-bold">
        {pending ? 'Guardando…' : `Estado actual: ${labels[meal.status]}`}
      </p>
      {!meal.canEdit && (
        <p id={`${id}-locked`} className="mt-2.5 text-sm leading-relaxed text-on-surface-variant">
          Esta comida no está disponible para registrar cambios. Solo se pueden registrar comidas de hoy o anteriores del plan vigente.
        </p>
      )}
      {error !== null && <p role="alert" className="mt-3 rounded-lg bg-error-container p-3 leading-relaxed text-on-error-container">{error}</p>}
    </section>
  );
}
