type MealCardErrorBannerProps = {
  message?: string;
  compact?: boolean;
  onRetry: () => void;
  onCancel: () => void;
};

export function MealCardErrorBanner({
  message = 'No se pudo reemplazar.',
  compact = false,
  onRetry,
  onCancel,
}: MealCardErrorBannerProps) {
  if (compact) {
    return (
      <div className="mt-2 flex flex-col gap-1.5 rounded-lg bg-error-container/20 p-2 text-[11px] border border-error/30">
        <p className="font-semibold text-error leading-tight">{message}</p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onRetry}
            className="rounded bg-brand-green px-2 py-0.5 text-[10px] font-bold text-white hover:opacity-90"
          >
            Reintentar
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded bg-surface-container px-2 py-0.5 text-[10px] font-semibold text-on-surface-variant hover:bg-surface-container-high"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-error/20 bg-error-container/10 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="material-symbols-outlined text-base text-error">
            error
          </span>
          <p className="text-xs font-semibold text-error">{message}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-2.5 py-1 text-xs font-semibold text-on-surface-variant hover:bg-surface-container"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-brand-green px-3 py-1 text-xs font-bold text-white hover:opacity-90"
          >
            Reintentar
          </button>
        </div>
      </div>
    </div>
  );
}
