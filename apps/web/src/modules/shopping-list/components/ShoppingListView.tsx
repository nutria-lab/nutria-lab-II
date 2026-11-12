import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ShoppingListItemError, ShoppingListResponse } from "../types";
import { formatWeekRange, shiftWeekStart } from "../utils";
import { ShoppingListItem } from "./ShoppingListItem";

export type ShoppingListViewState =
  "loading" | "success" | "error" | "session-expired";

const ITEMS_PER_PAGE = 10;

type ShoppingListViewProps = {
  state: ShoppingListViewState;
  weekStart: string;
  response?: ShoppingListResponse;
  pending: Record<string, boolean>;
  itemErrors: Record<string, ShoppingListItemError>;
  stale: boolean;
  conflictNotice: boolean;
  onChangeWeek: (weekStart: string) => void;
  onRetry: () => void;
  onSetChecked: (key: string, checked: boolean) => void;
  onRetryItem: (key: string) => void;
};

function WarningMessages({ response }: { response: ShoppingListResponse }) {
  if (response.warnings.length === 0) return null;
  const missingRecipeCount = response.warnings.filter(
    (warning) => warning.code === "MISSING_RECIPE",
  ).length;
  const invalidIngredientCount = response.warnings.filter(
    (warning) => warning.code === "INVALID_INGREDIENT",
  ).length;
  return (
    <section
      aria-labelledby="shopping-list-warnings"
      className="rounded-2xl border border-tertiary-container/70 bg-tertiary-fixed/40 p-4 sm:p-5"
    >
      <h2 className="font-semibold text-on-surface" id="shopping-list-warnings">
        La lista puede estar incompleta
      </h2>
      <ul className="mt-2 list-inside list-disc space-y-1 text-sm leading-6 text-on-surface-variant">
        {missingRecipeCount > 0 && (
          <li>
            {missingRecipeCount === 1
              ? "Una comida no tiene una receta disponible."
              : `${missingRecipeCount} comidas no tienen una receta disponible.`}
          </li>
        )}
        {invalidIngredientCount > 0 && (
          <li>
            {invalidIngredientCount === 1
              ? "Un ingrediente tiene la unidad o la cantidad incompleta."
              : `${invalidIngredientCount} ingredientes tienen la unidad o la cantidad incompleta.`} Los valores que se pueden calcular siguen en la lista.
          </li>
        )}
      </ul>
    </section>
  );
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      className="mt-5 inline-flex min-h-12 items-center rounded-xl bg-brand-green px-5 font-semibold text-white hover:bg-brand-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
      onClick={onRetry}
      type="button"
    >
      Reintentar
    </button>
  );
}

export function ShoppingListView({
  state,
  weekStart,
  response,
  pending = {},
  itemErrors = {},
  stale = false,
  conflictNotice = false,
  onChangeWeek,
  onRetry,
  onSetChecked,
  onRetryItem = () => undefined,
}: ShoppingListViewProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const checkedItems =
    response?.items.filter((item) => item.checked).length ?? 0;
  const totalItems = response?.items.length ?? 0;
  const pageCount = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const activePageIndex = Math.min(pageIndex, Math.max(pageCount - 1, 0));
  const firstVisibleItem = activePageIndex * ITEMS_PER_PAGE;
  const pageItems =
    response?.items.slice(firstVisibleItem, firstVisibleItem + ITEMS_PER_PAGE) ??
    [];
  const lastVisibleItem = Math.min(firstVisibleItem + ITEMS_PER_PAGE, totalItems);
  const progress =
    totalItems === 0 ? 0 : Math.round((checkedItems / totalItems) * 100);
  const isNoPlan = response?.plan === null;
  const isEmptyPlan =
    response?.plan !== null && response !== undefined && totalItems === 0;

  useEffect(() => {
    setPageIndex(0);
  }, [weekStart, response?.plan?.id, response?.plan?.updatedAt]);

  return (
    <main
      className="mx-auto w-full max-w-6xl min-w-0 px-4 py-6 sm:px-6 sm:py-9 lg:px-8"
      aria-busy={state === "loading"}
    >
      <header className="mb-6 flex flex-col gap-4 rounded-[2rem] border border-outline-variant/35 bg-gradient-to-br from-primary-fixed via-white to-secondary-fixed/40 p-5 shadow-sm sm:mb-8 sm:flex-row sm:items-center sm:justify-between sm:p-7">
        <div className="flex min-w-0 items-start gap-4">
          <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-green text-white shadow-sm sm:size-14">
            <span className="material-symbols-outlined text-2xl">shopping_basket</span>
          </span>
          <div className="min-w-0">
            <p className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-brand-green">
              Tu semana, más simple
            </p>
            <h1 className="font-headline text-3xl font-bold leading-tight text-on-surface sm:text-4xl">
              Lista de compras
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-on-surface-variant sm:text-base sm:leading-7">
              Ingredientes de tu plan, consolidados para ir al súper.
            </p>
          </div>
        </div>
        {totalItems > 0 && (
          <span className="inline-flex min-h-10 w-fit items-center gap-2 rounded-full border border-outline-variant/30 bg-white/80 px-4 text-sm font-semibold text-on-surface-variant">
            <span aria-hidden="true" className="material-symbols-outlined text-lg text-brand-green">format_list_bulleted</span>
            {totalItems} {totalItems === 1 ? "producto" : "productos"}
          </span>
        )}
      </header>

      <section
        aria-label="Semana seleccionada"
        className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-outline-variant/30 bg-white/85 p-3 shadow-sm sm:mb-7 sm:px-5"
      >
        <button
          aria-label="Semana anterior"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-2xl text-brand-green hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green"
          onClick={() => onChangeWeek(shiftWeekStart(weekStart, -1))}
          type="button"
        >
          ‹
        </button>
        <p className="text-center text-sm font-semibold text-on-surface sm:text-base">
          {formatWeekRange(weekStart)}
        </p>
        <button
          aria-label="Semana siguiente"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-2xl text-brand-green hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green"
          onClick={() => onChangeWeek(shiftWeekStart(weekStart, 1))}
          type="button"
        >
          ›
        </button>
      </section>

      {state === "loading" && (
        <section
          className="grid min-h-64 gap-5 rounded-3xl bg-white/70 p-6 shadow-sm lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.5fr)]"
          role="status"
        >
          <span className="sr-only">
            Cargando la lista de compras para la semana del{" "}
            {formatWeekRange(weekStart)}…
          </span>
          <div className="min-h-28 animate-pulse rounded-2xl bg-surface-container-low" />
          <div className="min-h-28 animate-pulse rounded-2xl bg-surface-container-low" />
        </section>
      )}

      {state === "session-expired" && (
        <section
          className="rounded-3xl bg-white p-6 shadow-sm sm:p-8"
          role="alert"
        >
          <h2 className="font-headline text-2xl font-bold text-brand-green">
            Tu sesión venció
          </h2>
          <p className="mt-3 leading-7 text-on-surface-variant">
            Iniciá sesión para volver a ver tu lista de compras.
          </p>
          <Link
            className="mt-6 inline-flex min-h-12 items-center rounded-xl bg-brand-green px-5 font-semibold text-white"
            to="/login"
          >
            Iniciar sesión
          </Link>
        </section>
      )}

      {state === "error" && (
        <section
          className="rounded-3xl bg-white p-6 shadow-sm sm:p-8"
          role="alert"
        >
          <h2 className="font-headline text-2xl font-bold text-brand-green">
            No pudimos cargar la lista
          </h2>
          <p className="mt-3 leading-7 text-on-surface-variant">
            Probá de nuevo en unos instantes.
          </p>
          <RetryButton onRetry={onRetry} />
        </section>
      )}

      {state === "success" && response && (
        <>
          {conflictNotice && (
            <div
              className="mb-5 rounded-2xl border border-tertiary-container bg-tertiary-fixed/50 p-4 text-on-surface"
              role="status"
            >
              El plan cambió mientras guardabas. Actualizamos la lista; revisá
              el producto antes de volver a marcarlo.
            </div>
          )}
          {isNoPlan ? (
            <section className="rounded-3xl bg-white p-6 shadow-sm sm:p-8">
              <h2 className="font-headline text-2xl font-bold text-on-surface">
                Todavía no hay un plan para esta semana
              </h2>
              <p className="mt-3 max-w-2xl leading-7 text-on-surface-variant">
                Cuando tengas un plan semanal, acá vas a encontrar sus
                ingredientes.
              </p>
              <Link
                className="mt-6 inline-flex min-h-12 items-center rounded-xl bg-brand-green px-5 font-semibold text-white"
                to="/meal-plan"
              >
                Ver mi plan
              </Link>
            </section>
          ) : (
            <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.5fr)] lg:gap-7">
              <aside className="space-y-5">
                <section
                  aria-labelledby="shopping-progress-heading"
                  className="min-h-36 rounded-3xl border border-primary-container/40 bg-primary-fixed p-5 shadow-sm sm:p-6"
                >
                  <h2
                    className="text-sm font-bold uppercase tracking-[0.12em] text-brand-green"
                    id="shopping-progress-heading"
                  >
                    Progreso de la semana
                  </h2>
                  <p className="mt-2 font-headline text-2xl font-bold text-brand-green">
                    {checkedItems} de {totalItems} marcados
                  </p>
                  {totalItems > 0 ? (
                    <div
                      aria-label={`${progress}% de productos marcados`}
                      aria-valuemax={totalItems}
                      aria-valuemin={0}
                      aria-valuenow={checkedItems}
                      className="mt-4 h-3 overflow-hidden rounded-full bg-white/80"
                      role="progressbar"
                    >
                      <div
                        className="h-full rounded-full bg-brand-green transition-[width]"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-on-surface-variant">
                      Todavía no hay productos para marcar.
                    </p>
                  )}
                </section>
                <WarningMessages response={response} />
                {isEmptyPlan && (
                  <section className="rounded-3xl bg-white p-5 shadow-sm sm:p-6">
                    <h2 className="font-headline text-xl font-bold text-on-surface">
                      Este plan está sin ingredientes
                    </h2>
                    <p className="mt-2 leading-6 text-on-surface-variant">
                      Cuando sus comidas incluyan ingredientes disponibles,
                      aparecerán acá.
                    </p>
                  </section>
                )}
                {response.warnings.length === 0 && totalItems > 0 && (
                  <Link
                    className="inline-flex min-h-12 items-center rounded-xl border border-outline-variant px-5 font-semibold text-brand-green hover:bg-surface-container-low focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green"
                    to="/meal-plan"
                  >
                    Ver mi plan
                  </Link>
                )}
              </aside>
              <section aria-label="Productos de la lista" className="min-w-0">
                {totalItems > 0 && (
                  <div className="mb-3 px-1">
                    <h2 className="font-headline text-xl font-bold text-on-surface">Ingredientes</h2>
                    <p className="mt-1 text-sm text-on-surface-variant">Marcá lo que ya pusiste en el carrito.</p>
                  </div>
                )}
                {totalItems === 0 ? (
                  !isEmptyPlan && (
                    <p className="rounded-3xl bg-white p-6 text-on-surface-variant shadow-sm">
                      No hay productos disponibles para esta semana.
                    </p>
                  )
                ) : (
                  <ul aria-label="Ingredientes" className="space-y-3">
                    {pageItems.map((item) => (
                      <ShoppingListItem
                        key={item.key}
                        item={item}
                        pending={Boolean(pending[item.key])}
                        error={itemErrors[item.key]}
                        disabled={stale}
                        onSetChecked={onSetChecked}
                        onRetry={() => onRetryItem(item.key)}
                      />
                    ))}
                  </ul>
                )}
                {pageCount > 1 && (
                  <nav
                    aria-label="Paginación de ingredientes"
                    className="mt-4 flex items-center justify-between gap-2 rounded-2xl border border-outline-variant/30 bg-white/85 p-2 shadow-sm sm:p-3"
                  >
                    <button
                      aria-label="Página anterior de ingredientes"
                      className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-outline-variant/35 bg-white px-2.5 text-sm font-semibold text-brand-green transition-colors hover:bg-primary-fixed/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green disabled:cursor-not-allowed disabled:opacity-45 sm:gap-2 sm:px-4"
                      disabled={activePageIndex === 0}
                      onClick={() => setPageIndex(Math.max(0, activePageIndex - 1))}
                      type="button"
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-lg">arrow_back</span>
                      Anterior
                    </button>
                    <p
                      aria-atomic="true"
                      aria-live="polite"
                      className="min-w-0 text-center text-xs text-on-surface-variant sm:text-sm"
                    >
                      <span className="block font-semibold text-on-surface">
                        Página {activePageIndex + 1} de {pageCount}
                      </span>
                      <span className="block">
                        {firstVisibleItem + 1}–{lastVisibleItem} de {totalItems}
                      </span>
                    </p>
                    <button
                      aria-label="Página siguiente de ingredientes"
                      className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-outline-variant/35 bg-white px-2.5 text-sm font-semibold text-brand-green transition-colors hover:bg-primary-fixed/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green disabled:cursor-not-allowed disabled:opacity-45 sm:gap-2 sm:px-4"
                      disabled={activePageIndex >= pageCount - 1}
                      onClick={() => setPageIndex(Math.min(pageCount - 1, activePageIndex + 1))}
                      type="button"
                    >
                      Siguiente
                      <span aria-hidden="true" className="material-symbols-outlined text-lg">arrow_forward</span>
                    </button>
                  </nav>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </main>
  );
}
