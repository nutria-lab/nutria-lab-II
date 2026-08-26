type PillProps = {
  label: string;
  selected: boolean;
  onClick: () => void;
};

export function Pill({ label, selected, onClick }: PillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
        selected
          ? 'bg-brand-green text-white'
          : 'bg-brand-cream-dark text-neutral-700 hover:bg-neutral-200'
      }`}
    >
      {label}
    </button>
  );
}
