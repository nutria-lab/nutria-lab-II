import { useSearchParams } from 'react-router-dom';
import { Banner } from '../../../common/components/Banner';
import { useMealPlan } from '../hooks/useMealPlan';
import { WeekSelector } from '../components/WeekSelector';
import { MealCard } from '../components/MealCard';
import { formatFullDate, formatLocalDateKey, formatWeekRange } from '../utils';

function LoadingSkeleton() {
  return (
    <div
      className="mx-auto max-w-3xl animate-pulse space-y-6 px-4 py-6 md:px-8"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="space-y-2">
        <div className="h-7 w-40 rounded bg-brand-cream-dark" />
        <div className="h-4 w-52 rounded bg-brand-cream-dark" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="h-14 w-11 shrink-0 rounded-2xl bg-brand-cream-dark" />
        ))}
      </div>
      <div className="h-6 w-48 rounded bg-brand-cream-dark" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-20 rounded-2xl bg-brand-cream-dark" />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 text-center md:px-8">
      <p className="font-serif text-lg font-semibold text-neutral-900">
        Todavía no tenés un plan para esta semana
      </p>
      <p className="mt-2 text-sm text-neutral-500">
        Generá un plan nuevo para ver tus comidas organizadas por día.
      </p>
      <button
        type="button"
        onClick={onGenerate}
        className="mt-4 min-h-[44px] rounded-lg bg-brand-green px-6 text-sm font-semibold text-white"
      >
        Generar plan
      </button>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 text-center md:px-8">
      <p className="font-serif text-lg font-semibold text-neutral-900">Algo salió mal</p>
      <p className="mt-2 text-sm text-neutral-500">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 min-h-[44px] rounded-lg bg-brand-green px-6 text-sm font-semibold text-white"
      >
        Reintentar
      </button>
    </div>
  );
}

// Decisión 5 del design.md: un 401 no ofrece "Reintentar" (fallaría de nuevo por el mismo
// motivo); deriva a la acción de reautenticación existente en el resto de la app.
function UnauthorizedState() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 text-center md:px-8">
      <p className="font-serif text-lg font-semibold text-neutral-900">
        Tu sesión expiró. Iniciá sesión nuevamente para ver tu plan semanal.
      </p>
    </div>
  );
}

export function MealPlanPage() {
  const { mealPlan, status, errorMessage, retry, generate } = useMealPlan();
  const [searchParams, setSearchParams] = useSearchParams();

  // Decisión 3 del design.md: el día activo vive en el query param `day`, no en un
  // `useState` local, para sobrevivir a un refresh y a la navegación de ida y vuelta.
  const dayParam = searchParams.get('day');
  const defaultDate = (() => {
    if (!mealPlan) {
      return null;
    }
    const today = formatLocalDateKey(new Date());
    const matchesToday = mealPlan.days.some((day) => day.date === today);
    return matchesToday ? today : (mealPlan.days[0]?.date ?? null);
  })();
  const selectedDate =
    mealPlan && dayParam && mealPlan.days.some((day) => day.date === dayParam) ? dayParam : defaultDate;

  function handleSelectDate(date: string) {
    setSearchParams((previousParams) => {
      const nextParams = new URLSearchParams(previousParams);
      nextParams.set('day', date);
      return nextParams;
    });
  }

  if (status === 'loading' && !mealPlan) {
    return <LoadingSkeleton />;
  }

  if (status === 'unauthorized') {
    return <UnauthorizedState />;
  }

  if (status === 'empty') {
    return <EmptyState onGenerate={() => generate?.()} />;
  }

  if (status === 'error' && !mealPlan) {
    return <ErrorState message={errorMessage ?? 'No pudimos cargar tu plan.'} onRetry={retry} />;
  }

  if (!mealPlan || !selectedDate) {
    return null;
  }

  const selectedDay = mealPlan.days.find((day) => day.date === selectedDate);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 md:px-8">
      <div>
        <h1 className="font-serif text-2xl font-bold text-neutral-900">Tu plan semanal</h1>
        <p className="text-sm text-neutral-500">{formatWeekRange(mealPlan.days)}</p>
      </div>

      {status === 'error' && errorMessage && <Banner variant="error" message={errorMessage} />}

      <WeekSelector days={mealPlan.days} selectedDate={selectedDate} onSelectDate={handleSelectDate} />

      <h2 className="font-serif text-lg font-semibold text-neutral-900">{formatFullDate(selectedDate)}</h2>

      <div className="space-y-3">
        {selectedDay?.meals.map((meal, index) => (
          <MealCard key={`${meal.mealType}-${index}`} meal={meal} />
        ))}
      </div>
    </main>
  );
}
