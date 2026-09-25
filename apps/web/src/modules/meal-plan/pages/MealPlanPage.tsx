import { useSearchParams } from 'react-router-dom';
import { Banner } from '../../../common/components/Banner';
import { useMealPlan } from '../hooks/useMealPlan';
import { WeekSelector } from '../components/WeekSelector';
import { MealCard } from '../components/MealCard';
import { formatFullDate, formatLocalDateKey, formatWeekRange } from '../utils';

function LoadingSkeleton() {
  return (
    <div
      className="mx-auto max-w-lg animate-pulse space-y-6 px-4 py-6"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="space-y-2">
        <div className="h-8 w-48 rounded-xl bg-surface-container" />
        <div className="h-4 w-52 rounded-lg bg-surface-container" />
      </div>
      <div className="flex gap-3">
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="h-20 min-w-[64px] shrink-0 rounded-xl bg-surface-container" />
        ))}
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-28 rounded-xl bg-surface-container" />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-surface-container">
        <span className="material-symbols-outlined text-3xl text-on-surface-variant">calendar_month</span>
      </div>
      <p className="font-headline text-lg font-semibold text-on-surface">
        Todavía no tenés un plan para esta semana
      </p>
      <p className="mt-2 text-sm text-on-surface-variant">
        Generá un plan nuevo para ver tus comidas organizadas por día.
      </p>
      <button
        type="button"
        onClick={onGenerate}
        className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-brand-green px-6 py-4 text-sm font-bold text-on-primary shadow-md transition-all hover:opacity-90 active:scale-[0.98]"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-lg">auto_awesome</span>
        Generar plan
      </button>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <p className="font-headline text-lg font-semibold text-on-surface">Algo salió mal</p>
      <p className="mt-2 text-sm text-on-surface-variant">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-brand-green px-6 py-4 text-sm font-bold text-on-primary shadow-md transition-all hover:opacity-90 active:scale-[0.98]"
      >
        Reintentar
      </button>
    </div>
  );
}

export function MealPlanPage() {
  const { mealPlan, status, errorMessage, retry, generate } = useMealPlan();
  const [searchParams, setSearchParams] = useSearchParams();

  const dayParam = searchParams.get('day');
  const defaultDate = (() => {
    if (!mealPlan) return null;
    const today = formatLocalDateKey(new Date());
    const matchesToday = mealPlan.days.some((day) => day.date === today);
    return matchesToday ? today : (mealPlan.days[0]?.date ?? null);
  })();
  const selectedDate =
    mealPlan && dayParam && mealPlan.days.some((day) => day.date === dayParam)
      ? dayParam
      : defaultDate;

  function handleSelectDate(date: string) {
    setSearchParams((previousParams) => {
      const nextParams = new URLSearchParams(previousParams);
      nextParams.set('day', date);
      return nextParams;
    });
  }

  if (status === 'loading' && !mealPlan) return <LoadingSkeleton />;
  if (status === 'empty') return <EmptyState onGenerate={() => generate?.()} />;
  if (status === 'error' && !mealPlan) return <ErrorState message={errorMessage ?? 'No pudimos cargar tu plan.'} onRetry={retry} />;
  if (!mealPlan || !selectedDate) return null;

  const selectedDay = mealPlan.days.find((day) => day.date === selectedDate);

  return (
    <main className="mx-auto max-w-lg space-y-6 px-4 py-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold leading-tight text-on-surface">
            Tu plan semanal
          </h1>
          <p className="mt-1 font-medium text-secondary">{formatWeekRange(mealPlan.days)}</p>
        </div>
        {/* Action buttons */}
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            title="Preferencias"
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-container text-brand-green transition-colors hover:bg-primary-fixed/30"
          >
            <span className="material-symbols-outlined">tune</span>
          </button>
          <button
            type="button"
            title="Regenerar plan"
            onClick={() => generate?.()}
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green text-on-primary shadow-md transition-all hover:opacity-90"
          >
            <span className="material-symbols-outlined">autorenew</span>
          </button>
        </div>
      </div>

      {status === 'error' && errorMessage && <Banner variant="error" message={errorMessage} />}

      <WeekSelector days={mealPlan.days} selectedDate={selectedDate} onSelectDate={handleSelectDate} />

      <h2 className="font-headline text-lg font-semibold text-on-surface">
        {formatFullDate(selectedDate)}
      </h2>

      <div className="space-y-4">
        {selectedDay?.meals.map((meal, index) => (
          <MealCard key={`${meal.mealType}-${index}`} meal={meal} />
        ))}
      </div>
    </main>
  );
}
