import { Link } from 'react-router-dom';

const NOT_FOUND_MESSAGE = 'Esta receta ya no está disponible. Puede que haya sido eliminada.';
const BACK_TO_LIST_LABEL = 'Volver al listado';
const RETRY_LABEL = 'Reintentar';

export function RecipeDetailSkeleton() {
  return (
    <div
      data-testid="recipe-detail-skeleton"
      aria-busy="true"
      aria-live="polite"
      className="mx-auto max-w-3xl animate-pulse space-y-4 px-4 py-6 md:px-8"
    >
      <div className="h-48 w-full rounded-2xl bg-surface-container" />
      <div className="h-6 w-2/3 rounded bg-surface-container" />
      <div className="h-24 w-full rounded bg-surface-container" />
    </div>
  );
}

export function RecipeDetailNotFound() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 text-center md:px-8">
      <p className="font-headline text-lg font-semibold text-on-surface">{NOT_FOUND_MESSAGE}</p>
      <Link
        to="/recipes"
        className="mt-4 inline-block min-h-[44px] rounded-xl bg-brand-green px-6 py-3 text-sm font-semibold text-on-primary"
      >
        {BACK_TO_LIST_LABEL}
      </Link>
    </div>
  );
}

export function RecipeDetailError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 text-center md:px-8">
      <p className="font-headline text-lg font-semibold text-on-surface">Algo salió mal</p>
      <p className="mt-2 text-sm text-on-surface-variant">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 min-h-[44px] rounded-xl bg-brand-green px-6 text-sm font-semibold text-on-primary"
      >
        {RETRY_LABEL}
      </button>
    </div>
  );
}
