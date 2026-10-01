import { CheckIcon } from './CheckIcon';

type SelectableCardProps = {
  title: string;
  description: string;
  valueLabel?: string;
  icon?: string; // Material Symbol icon name
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
};

export function SelectableCard({
  title,
  description,
  valueLabel,
  icon,
  selected,
  disabled,
  onClick,
}: SelectableCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`group w-full rounded-xl border-2 p-6 text-left transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
          ? 'border-brand-green bg-brand-green/5'
          : 'border-surface-container-high bg-surface hover:border-brand-green/30'
      }`}
    >
      {/* Mobile: icon + text side by side. Desktop: icon on top, text below */}
      <div className="flex items-center gap-4 md:flex-col md:items-start md:gap-2">
        {icon && (
          <span
            className={`material-symbols-outlined text-2xl md:mb-2 ${
              selected ? 'text-brand-green' : 'text-on-surface-variant'
            }`}
          >
            {icon}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-on-surface">{title}</span>
            {selected && (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-green text-on-primary">
                <CheckIcon className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
          {valueLabel && (
            <div className="font-headline text-3xl font-bold text-brand-green my-1">{valueLabel}</div>
          )}
          <p className="mt-1 text-xs leading-relaxed text-on-surface-variant italic">{description}</p>
        </div>
      </div>
    </button>
  );
}
