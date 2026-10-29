import type { ShoppingListItem as ShoppingListItemData } from "../types";
import { formatShoppingQuantity } from "../utils";

type ShoppingListItemProps = {
  item: ShoppingListItemData;
  onSetChecked: (key: string, checked: boolean) => void;
};

export function ShoppingListItem({
  item,
  onSetChecked,
}: ShoppingListItemProps) {
  const quantity =
    item.quantity === null
      ? `Cantidad no disponible${item.unit ? ` · ${item.unit}` : ""}`
      : `${formatShoppingQuantity(item.quantity)}${item.unit ? ` ${item.unit}` : ""}`;
  const checkboxLabel = `${item.name}, ${quantity}`;

  return (
    <li
      className={`flex min-w-0 items-start gap-4 rounded-2xl px-4 py-4 sm:px-5 ${item.checked ? "bg-surface-container" : "bg-white/80"}`}
    >
      <input
        aria-label={checkboxLabel}
        checked={item.checked}
        className="mt-1 size-6 shrink-0 cursor-pointer accent-brand-green focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-green"
        onChange={(event) =>
          onSetChecked(item.key, event.currentTarget.checked)
        }
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
    </li>
  );
}
