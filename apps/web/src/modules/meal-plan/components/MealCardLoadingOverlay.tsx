type MealCardLoadingOverlayProps = {
  compact?: boolean;
};

export function MealCardLoadingOverlay({ compact = false }: MealCardLoadingOverlayProps) {
  if (compact) {
    return (
      <div
        className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-xl bg-white/90 backdrop-blur-[1px] p-2 text-center"
        aria-busy="true"
        aria-label="Reemplazando comida"
      >
        <span
          aria-hidden="true"
          className="material-symbols-outlined animate-spin text-brand-green text-xl"
        >
          progress_activity
        </span>
        <span className="text-[11px] font-bold text-on-surface">Reemplazando...</span>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center gap-3 rounded-xl bg-white/90 backdrop-blur-[1px] p-4 text-center"
      aria-busy="true"
      aria-label="Reemplazando comida"
    >
      <span
        aria-hidden="true"
        className="material-symbols-outlined animate-spin text-brand-green text-2xl"
      >
        progress_activity
      </span>
      <div className="text-left">
        <p className="text-sm font-bold text-on-surface">Reemplazando receta...</p>
        <p className="text-xs text-on-surface-variant">Buscando una nueva sugerencia</p>
      </div>
    </div>
  );
}
