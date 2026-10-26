import type {
  ShoppingListItem as ShoppingListItemData,
  ShoppingListItemError,
} from "../types";
import { formatShoppingQuantity } from "../utils";

type ShoppingListItemProps = {
  item: ShoppingListItemData;
  pending: boolean;
  disabled: boolean;
  error?: ShoppingListItemError;
  onSetChecked: (key: string, checked: boolean) => void;
  onRetry: () => void;
};

export function ShoppingListItem({
  item,
  pending,
  disabled,
  error,
  onSetChecked,
  onRetry,
}: ShoppingListItemProps) {
  const quantity =
    item.quantity === null
      ? `Cantidad no disponible${item.unit ? ` · ${item.unit}` : ""}`
      : `${formatShoppingQuantity(item.quantity)}${item.unit ? ` ${item.unit}` : ""}`;
  const checkboxLabel = `${item.name}, ${quantity}`;

  return (
    <li
      className={`flex min-w-0 flex-wrap items-start gap-4 rounded-2xl px-4 py-4 sm:px-5 ${item.checked ? "bg-surface-container" : "bg-white/80"}`}
    >
      <input
        aria-label={checkboxLabel}
        aria-describedby={`shopping-item-status-${item.key}`}
        aria-disabled={pending || disabled}
        checked={item.checked}
        className="mt-1 size-6 shrink-0 cursor-pointer accent-brand-green focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-green"
        onChange={(event) => {
          if (!pending && !disabled)
            onSetChecked(item.key, event.currentTarget.checked);
        }}
        type="checkbox"
      />
      <span
        className={`min-w-0 flex-1 break-words text-base leading-6 ${item.checked ? "text-on-surface-variant line-through" : "text-on-surface"}`}
      >
        {item.name}
      </span>
      <span className="max-w-[45%] shrink-0 rounded-full bg-secondary-container px-3 py-1 text-right text-sm font-semibold text-on-secondary-container">
        {quantity}
      </span>
      <span
        id={`shopping-item-status-${item.key}`}
        className="min-h-5 w-full basis-full text-sm text-on-surface-variant"
        aria-live="polite"
      >
        {pending ? "Guardando…" : <span aria-hidden="true"> </span>}
      </span>
      {error && (
        <span className="w-full basis-full text-sm text-error" role="alert">
          {error.message}
          {error.action === "retry" ? (
            <button
              className="ml-2 min-h-11 font-semibold underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
              onClick={onRetry}
              type="button"
            >
              Reintentar
            </button>
          ) : (
            <button
              className="ml-2 min-h-11 font-semibold underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
              onClick={onRetry}
              type="button"
            >
              Actualizar lista
            </button>
          )}
        </span>
      )}
    </li>
  );
}
