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
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
          ? 'bg-brand-green text-white'
          : 'bg-brand-cream-dark text-neutral-700 hover:bg-neutral-200'
      }`}
    >
      {label}
    </button>
  );
}
