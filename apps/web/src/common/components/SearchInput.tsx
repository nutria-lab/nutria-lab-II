/**
 * SearchInput — shared search field used across the app.
 *
 * Variants:
 *  - default: rounded-2xl with border (used inline in list pages)
 *  - topbar:  rounded-full, borderless, surface-container bg (used in the desktop TopBar)
 *
 * Supports controlled and uncontrolled usage via value/onChange props.
 */

type SearchInputProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Visual variant. Defaults to 'default'. */
  variant?: 'default' | 'topbar';
  /** Additional class names for the wrapper div. */
  className?: string;
};

const VARIANT_INPUT_CLASSES: Record<NonNullable<SearchInputProps['variant']>, string> = {
  default:
    'w-full rounded-2xl border border-outline-variant/50 bg-surface-container-low py-2.5 pl-10 pr-9 text-sm text-on-surface placeholder:text-on-surface-variant/60 outline-none transition-all focus:border-brand-green focus:ring-2 focus:ring-brand-green/20',
  topbar:
    'w-full rounded-full border-none bg-surface-container py-2 pl-10 pr-9 text-sm text-on-surface placeholder:text-on-surface-variant outline-none focus:ring-2 focus:ring-brand-green/20',
};

export function SearchInput({
  id = 'search-input',
  value,
  onChange,
  placeholder = 'Buscar...',
  variant = 'default',
  className,
}: SearchInputProps) {
  return (
    <div className={`relative ${className ?? ''}`}>
      <label htmlFor={id} className="sr-only">
        {placeholder}
      </label>
      <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-on-surface-variant">
        <span className="material-symbols-outlined text-lg" aria-hidden="true">
          search
        </span>
      </div>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={VARIANT_INPUT_CLASSES[variant]}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Limpiar búsqueda"
          className="absolute inset-y-0 right-2 flex items-center px-1 text-on-surface-variant hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-lg" aria-hidden="true">
            close
          </span>
        </button>
      )}
    </div>
  );
}
