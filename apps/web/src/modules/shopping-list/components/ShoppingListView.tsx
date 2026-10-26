import { Link } from "react-router-dom";
import type { ShoppingListItemError, ShoppingListResponse } from "../types";
import { formatWeekRange, shiftWeekStart } from "../utils";
import { ShoppingListItem } from "./ShoppingListItem";

export type ShoppingListViewState =
  "loading" | "success" | "error" | "session-expired";

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
              ? "Un ingrediente tiene datos que no se pudieron incluir."
              : `${invalidIngredientCount} ingredientes tienen datos que no se pudieron incluir.`}
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
  const checkedItems =
    response?.items.filter((item) => item.checked).length ?? 0;
  const totalItems = response?.items.length ?? 0;
  const progress =
    totalItems === 0 ? 0 : Math.round((checkedItems / totalItems) * 100);
  const isNoPlan = response?.plan === null;
  const isEmptyPlan =
    response?.plan !== null && response !== undefined && totalItems === 0;

  return (
    <main
      className="mx-auto w-full max-w-6xl min-w-0 px-4 py-7 sm:px-6 sm:py-10 lg:px-8"
      aria-busy={state === "loading"}
    >
      <header className="mb-7 flex flex-col gap-5 sm:mb-9 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.12em] text-brand-green">
            Tu semana, más simple
          </p>
          <h1 className="font-headline text-3xl font-bold text-on-surface sm:text-4xl">
            Lista de compras
          </h1>
          <p className="mt-2 max-w-2xl text-base leading-7 text-on-surface-variant">
            Productos de tu plan semanal, en el orden recibido.
          </p>
        </div>
      </header>

      <section
        aria-label="Semana seleccionada"
        className="mb-5 flex items-center justify-between gap-3 rounded-2xl bg-white/80 p-3 shadow-sm sm:mb-7 sm:px-5"
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
                  className="min-h-36 rounded-3xl bg-primary-fixed p-5 sm:p-6"
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
                {totalItems === 0 ? (
                  !isEmptyPlan && (
                    <p className="rounded-3xl bg-white p-6 text-on-surface-variant shadow-sm">
                      No hay productos disponibles para esta semana.
                    </p>
                  )
                ) : (
                  <ul aria-label="Ingredientes" className="space-y-3">
                    {response.items.map((item) => (
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
              </section>
            </div>
          )}
        </>
      )}
    </main>
  );
}
