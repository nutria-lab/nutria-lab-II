type MealCardMobileConfirmProps = {
  mealTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
  isSubmitting?: boolean;
};

export function MealCardMobileConfirm({
  mealTitle,
  onConfirm,
  onCancel,
  isSubmitting = false,
}: MealCardMobileConfirmProps) {
  return (
    <div
      role="region"
      aria-label={`Confirmar reemplazo de ${mealTitle}`}
      className="border-t border-outline-variant/30 bg-surface-container-low/70 p-3.5 space-y-2.5 rounded-b-xl"
    >
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className="material-symbols-outlined text-brand-green text-lg mt-0.5">
          help
        </span>
        <div>
          <p className="text-xs font-bold text-on-surface">
            ¿Reemplazar {mealTitle}?
          </p>
          <p className="text-[11px] text-on-surface-variant leading-tight mt-0.5">
            Solo cambiará este plato. Las demás comidas de tu semana no se modificarán.
          </p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSubmitting}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
        >
          {isSubmitting ? (
            <>
              <span aria-hidden="true" className="material-symbols-outlined animate-spin text-sm">
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
  );
}
