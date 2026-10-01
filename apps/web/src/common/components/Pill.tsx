type PillProps = {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
};

export function Pill({ label, selected, disabled, onClick }: PillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`rounded-full px-4 py-3 text-sm transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
          ? 'bg-brand-green font-bold text-on-primary border-transparent shadow-sm'
          : 'border border-outline-variant font-medium text-on-surface hover:bg-surface-container-highest'
      }`}
    >
      {label}
    </button>
  );
}
