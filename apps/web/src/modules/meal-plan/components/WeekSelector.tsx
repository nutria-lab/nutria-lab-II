import type { KeyboardEvent } from 'react';
import type { MealPlanDay } from '../../../services/mealPlanService';
import { formatDayAbbreviation, formatDayNumber } from '../utils';

type WeekSelectorProps = {
  days: MealPlanDay[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
};

export function WeekSelector({ days, selectedDate, onSelectDate }: WeekSelectorProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();

    const nextIndex =
      event.key === 'ArrowRight' ? (index + 1) % days.length : (index - 1 + days.length) % days.length;
    const nextDay = days[nextIndex];

    onSelectDate(nextDay.date);
    document.getElementById(`day-tab-${nextDay.date}`)?.focus();
  }

  return (
    <div
      className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label="Días de la semana"
    >
      {days.map((day, index) => {
        const isSelected = day.date === selectedDate;
        return (
          <button
            key={day.date}
            id={`day-tab-${day.date}`}
            type="button"
            role="tab"
            aria-selected={isSelected}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onSelectDate(day.date)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`flex min-w-[64px] h-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl py-2 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green ${
              isSelected
                ? 'bg-primary-container font-bold text-on-primary-fixed shadow-sm'
                : 'bg-surface-container font-medium text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            <span className="text-[10px] tracking-wide uppercase">{formatDayAbbreviation(day.date)}</span>
            <span className="text-xl font-bold">{formatDayNumber(day.date)}</span>
          </button>
        );
      })}
    </div>
  );
}
