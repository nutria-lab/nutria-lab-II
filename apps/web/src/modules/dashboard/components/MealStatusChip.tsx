import type { MealCompletionStatus } from '../types';
import { getMealStatusLabel } from '../utils';

const CHIP_STYLES: Record<MealCompletionStatus, { className: string; icon: string | null }> = {
  NOT_LOGGED: { className: 'bg-surface-container-high text-on-surface-variant', icon: null },
  COMPLETED: { className: 'bg-primary-fixed text-on-primary-fixed-variant', icon: 'check' },
  SKIPPED: { className: 'border border-outline-variant text-on-surface-variant', icon: 'remove' },
};

// El chip siempre lleva texto: el color nunca es la única señal del estado.
export function MealStatusChip({ status }: { status: MealCompletionStatus | null }) {
  const label = getMealStatusLabel(status);
  if (status === null || label === null) return null;
  const { className, icon } = CHIP_STYLES[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>
      {icon && (
        <span aria-hidden="true" className="material-symbols-outlined text-sm">
          {icon}
        </span>
      )}
      <span>{label}</span>
    </span>
  );
}
