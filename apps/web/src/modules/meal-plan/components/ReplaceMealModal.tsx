import { useEffect, useRef } from 'react';
import type { Meal } from '../../../services/mealPlanService';

type ReplaceMealModalProps = {
  isOpen: boolean;
  meal: Meal | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** Hay otro reemplazo en curso: Confirmar queda deshabilitado; Cancelar y Escape siguen activos. */
  isConfirmBlocked?: boolean;
};

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function ReplaceMealModal({
  isOpen,
  meal,
  onConfirm,
  onCancel,
  isConfirmBlocked = false,
}: ReplaceMealModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  // Al abrir se enfoca la acción principal (o Cancelar si está bloqueada); al cerrar, el foco
  // vuelve al control que abrió el diálogo si sigue siendo enfocable. Depende sólo de `isOpen`
  // para que otros cambios de props no muevan el foco con el diálogo abierto.
  useEffect(() => {
    if (!isOpen) return;

    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const confirm = confirmButtonRef.current;
    (confirm && !confirm.disabled ? confirm : cancelButtonRef.current)?.focus();

    return () => {
      if (trigger?.isConnected) trigger.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const focusIsInside = active instanceof Node && dialogRef.current?.contains(active);
      if (event.shiftKey && (active === first || !focusIsInside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !focusIsInside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onCancel]);

  if (!isOpen || !meal) return null;

  const mealTitle = meal.recipe?.title ?? meal.title ?? 'esta comida';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
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
              Reemplazar {mealTitle}
            </h3>
            <p id="replace-meal-modal-desc" className="mt-1 text-sm text-on-surface-variant leading-relaxed">
              Solo se cambiará este plato. Las demás comidas de tu plan se mantendrán iguales.
            </p>
          </div>
        </div>

        {isConfirmBlocked && (
          <p role="status" className="rounded-xl bg-surface-container px-3 py-2 text-sm text-on-surface-variant">
            Hay otro reemplazo en curso. Vas a poder confirmar cuando termine.
          </p>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-on-surface-variant hover:bg-surface-container transition-colors"
          >
            Cancelar
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            disabled={isConfirmBlocked}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-brand-green px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
          >
            Reemplazar comida
          </button>
        </div>
      </div>
    </div>
  );
}
