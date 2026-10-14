import { useEffect, useRef } from 'react';
import type { Meal } from '../../../services/mealPlanService';

type ReplaceMealModalProps = {
  isOpen: boolean;
  meal: Meal | null;
  onConfirm: () => void;
  onCancel: () => void;
  isSubmitting?: boolean;
};

export function ReplaceMealModal({
  isOpen,
  meal,
  onConfirm,
  onCancel,
  isSubmitting = false,
}: ReplaceMealModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Focus confirm button when modal opens
    confirmButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isSubmitting, onCancel]);

  if (!isOpen || !meal) return null;

  const mealTitle = meal.recipe?.title ?? meal.title ?? 'esta comida';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onCancel();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="replace-meal-modal-title"
        aria-describedby="replace-meal-modal-desc"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-outline-variant/30 space-y-4 animate-in fade-in zoom-in-95 duration-150"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-fixed/40 text-brand-green">
            <span aria-hidden="true" className="material-symbols-outlined text-2xl">
              sync
            </span>
          </div>
          <div>
            <h3
              id="replace-meal-modal-title"
              className="font-headline text-lg font-bold text-on-surface leading-snug"
            >
              ¿Reemplazar {mealTitle}?
            </h3>
            <p id="replace-meal-modal-desc" className="mt-1 text-sm text-on-surface-variant leading-relaxed">
              Se generará una nueva sugerencia para este plato. Las demás comidas de tu semana no cambiarán.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-on-surface-variant hover:bg-surface-container transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-brand-green px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
          >
            {isSubmitting ? (
              <>
                <span aria-hidden="true" className="material-symbols-outlined animate-spin text-base">
                  progress_activity
                </span>
                Reemplazando...
              </>
            ) : (
              'Reemplazar comida'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
