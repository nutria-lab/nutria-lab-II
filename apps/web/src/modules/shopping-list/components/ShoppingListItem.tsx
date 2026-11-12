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
  const sourceMealCount = new Set(
    item.sources.map((source) => source.plannedMealId),
  ).size;
  const sourceLabel =
    sourceMealCount > 1
      ? `En ${sourceMealCount} comidas`
      : item.sources.length > 1
        ? `${item.sources.length} veces en una comida`
        : "";
  const checkboxLabel = `${item.name}, ${quantity}`;

  return (
    <li
      className={`grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 rounded-2xl border p-4 shadow-sm transition-[background-color,border-color,box-shadow] duration-200 focus-within:ring-2 focus-within:ring-brand-green/25 sm:gap-x-4 sm:p-5 ${item.checked ? "border-transparent bg-surface-container" : "border-outline-variant/35 bg-white hover:border-brand-green/35 hover:shadow-md"}`}
    >
      <input
        aria-label={checkboxLabel}
        aria-describedby={`shopping-item-status-${item.key}`}
        aria-disabled={pending || disabled}
        checked={item.checked}
        className="col-start-1 row-start-1 mt-0.5 size-6 cursor-pointer accent-brand-green focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-green"
        onChange={(event) => {
          if (!pending && !disabled)
            onSetChecked(item.key, event.currentTarget.checked);
        }}
        type="checkbox"
      />
      <div className="col-start-2 row-start-1 min-w-0">
        <span
          className={`block break-words text-base font-semibold leading-6 ${item.checked ? "text-on-surface-variant line-through" : "text-on-surface"}`}
        >
          {item.name}
        </span>
        {sourceLabel && (
          <span className="mt-1 block text-xs font-medium text-on-surface-variant">
            {sourceLabel}
          </span>
        )}
      </div>
      <span className="col-start-3 row-start-1 w-fit max-w-[40vw] break-words rounded-full bg-secondary-container px-3 py-1 text-right text-sm font-semibold text-on-secondary-container sm:max-w-[16rem]">
        {quantity}
      </span>
      <span
        id={`shopping-item-status-${item.key}`}
        className="col-start-2 col-span-2 row-start-2 min-h-4 text-xs text-on-surface-variant"
        aria-live="polite"
      >
        {pending ? "Guardando…" : <span aria-hidden="true"> </span>}
      </span>
      {error && (
        <span className="col-start-2 col-span-2 row-start-3 text-sm text-error" role="alert">
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
