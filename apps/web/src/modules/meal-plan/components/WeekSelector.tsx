import type { MealPlanDay } from '../../../services/mealPlanService';
import { formatDayAbbreviation, formatDayNumber } from '../utils';

type WeekSelectorProps = {
  days: MealPlanDay[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
};

export function WeekSelector({ days, selectedDate, onSelectDate }: WeekSelectorProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Días de la semana">
      {days.map((day) => {
        const isSelected = day.date === selectedDate;
        return (
          <button
            key={day.date}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onSelectDate(day.date)}
            className={`flex min-h-[44px] w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl border py-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green ${
              isSelected
                ? 'border-brand-green bg-brand-green text-white'
                : 'border-neutral-200 bg-white text-neutral-600'
            }`}
          >
            <span className="text-[10px] tracking-wide uppercase">{formatDayAbbreviation(day.date)}</span>
            <span className="text-base font-bold">{formatDayNumber(day.date)}</span>
          </button>
        );
      })}
    </div>
  );
}
