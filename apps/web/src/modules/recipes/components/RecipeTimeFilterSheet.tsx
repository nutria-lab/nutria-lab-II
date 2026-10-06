import { useEffect, useRef } from 'react';

export type RecipeTimeFilterSheetProps = {
  open: boolean;
  onClose: () => void;
  selectedMinutes?: number;
  onSelectMinutes: (minutes?: number) => void;
};

const TIME_OPTIONS: { label: string; value?: number }[] = [
  { label: 'Sin límite de tiempo', value: undefined },
  { label: 'Hasta 15 minutos (Rápido)', value: 15 },
  { label: 'Hasta 30 minutos', value: 30 },
  { label: 'Hasta 45 minutos', value: 45 },
  { label: 'Hasta 60 minutos', value: 60 },
];

export function RecipeTimeFilterSheet({
  open,
  onClose,
  selectedMinutes,
  onSelectMinutes,
}: RecipeTimeFilterSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="time-filter-sheet-title"
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={sheetRef}
        className="w-full max-h-[80vh] rounded-t-3xl border-t border-outline-variant/30 bg-[#faf6f0] p-6 shadow-2xl transition-transform animate-in slide-in-from-bottom"
      >
        {/* Drag handle */}
        <div
          className="mx-auto -mt-2 mb-4 h-1.5 w-12 cursor-pointer rounded-full bg-outline-variant/80"
          onClick={onClose}
          aria-hidden="true"
        />

        {/* Header */}
        <div className="mb-4 flex items-center justify-between border-b border-outline-variant/20 pb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-brand-green" aria-hidden="true">
              schedule
            </span>
            <h2 id="time-filter-sheet-title" className="font-headline text-lg font-bold text-on-surface">
              Tiempo de Preparación
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar filtro de tiempo"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-container text-on-surface-variant hover:bg-surface-container-high active:scale-95"
          >
            <span className="material-symbols-outlined text-lg" aria-hidden="true">
              close
            </span>
          </button>
        </div>

        {/* Options */}
        <div role="radiogroup" aria-label="Opciones de tiempo de preparación" className="space-y-2">
          {TIME_OPTIONS.map((option) => {
            const isSelected = selectedMinutes === option.value;
            return (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => {
                  onSelectMinutes(option.value);
                  onClose();
                }}
                className={`flex w-full items-center justify-between rounded-xl border p-3.5 text-left text-sm font-semibold transition-all active:scale-[0.99] ${
                  isSelected
                    ? 'border-brand-green bg-brand-green/10 text-brand-green ring-1 ring-brand-green'
                    : 'border-outline-variant/30 bg-white text-on-surface hover:bg-surface-container-low'
                }`}
              >
                <span>{option.label}</span>
                {isSelected && (
                  <span className="material-symbols-outlined text-brand-green text-base" aria-hidden="true">
                    check
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
