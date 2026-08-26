import { CheckIcon } from './CheckIcon';

type SelectableCardProps = {
  title: string;
  description: string;
  valueLabel?: string;
  selected: boolean;
  onClick: () => void;
};

export function SelectableCard({
  title,
  description,
  valueLabel,
  selected,
  onClick,
}: SelectableCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`w-full rounded-xl border bg-white p-4 text-left transition-colors ${
        selected ? 'border-brand-green' : 'border-neutral-200'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-serif text-lg font-semibold text-neutral-900">{title}</span>
        {selected && (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-green text-white">
            <CheckIcon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      {valueLabel && (
        <div className="font-serif text-lg font-semibold text-brand-green">{valueLabel}</div>
      )}
      <p className="mt-1 text-sm text-neutral-500">{description}</p>
    </button>
  );
}
