import { PageHeader } from '../../../common/components/PageHeader';
import type { DashboardViewModel } from '../types';
import { buildGreeting, hasNextMealColumn } from '../utils';
import { AdherenceWidgetSlot } from './AdherenceWidgetSlot';
import { NextMealHighlight } from './NextMealHighlight';
import { QuickAccessLinks } from './QuickAccessLinks';
import { TodayMealsCard } from './TodayMealsCard';

// El DOM sigue el orden mobile (saludo, progreso, siguiente comida, lista, accesos);
// en lg la grilla ubica la siguiente comida a la izquierda (7) y el progreso a la derecha (5).
export function DashboardView({ viewModel }: { viewModel: DashboardViewModel }) {
  const withNextMeal = hasNextMealColumn(viewModel.todayMeals);

  return (
    <div>
      <div className="md:hidden">
        <PageHeader />
      </div>
      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <header>
          <h1 className="break-words font-headline text-3xl font-bold leading-tight text-on-surface">
            {buildGreeting(viewModel.userName)}
          </h1>
          <p className="mt-1 text-on-surface-variant">Hoy es un buen día para nutrirte.</p>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <AdherenceWidgetSlot
            state={viewModel.adherence}
            className={withNextMeal ? 'lg:col-span-5 lg:col-start-8 lg:row-start-1' : 'lg:col-span-12'}
          />
          <NextMealHighlight state={viewModel.todayMeals} className="lg:col-span-7 lg:col-start-1 lg:row-start-1" />
          <TodayMealsCard state={viewModel.todayMeals} className="lg:col-span-12" />
          <QuickAccessLinks className="lg:col-span-12" />
        </div>
      </main>
    </div>
  );
}
