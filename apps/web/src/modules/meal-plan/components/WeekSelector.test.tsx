import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WeekSelector } from './WeekSelector';

// NUT-10: fixture inline con la forma REAL de `MealPlanDay` (ver
// .plans/nut-10-integrar-plan-de-comidas/plan.md sección 3):
//
// MealPlanDay: { id, mealPlanId, day (DayOfWeek enum), date, meals: PlannedMeal[] }
//
// `WeekSelector` hoy solo lee `day.date` (para key/id/selección/formato) y `days.length`
// (para el wrap-around de flechas); no reordena ni depende de `day` (enum) ni de `meals`,
// así que los campos adicionales del contrato real no cambian su comportamiento. Se
// construye vía helper (no como literal anotado con el tipo `MealPlanDay` de
// `mealPlanService.ts`) para no acoplar este test a un tipo de producción todavía
// desalineado con el contrato real (sin `id`/`mealPlanId`/`day`).

function buildDay(day: string, date: string) {
  return { id: `day-${date}`, mealPlanId: 'plan-1', day, date, meals: [] };
}

const days = [buildDay('MONDAY', '2026-08-24'), buildDay('TUESDAY', '2026-08-25'), buildDay('WEDNESDAY', '2026-08-26')];

describe('WeekSelector', () => {
  it('keeps only the selected day in the natural tab order (roving tabindex)', () => {
    render(<WeekSelector days={days as never} selectedDate="2026-08-25" onSelectDate={vi.fn()} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('moves selection to the next day with ArrowRight', async () => {
    const handleSelect = vi.fn();
    const user = userEvent.setup();
    render(<WeekSelector days={days as never} selectedDate="2026-08-24" onSelectDate={handleSelect} />);

    screen.getByRole('tab', { name: /24/ }).focus();
    await user.keyboard('{ArrowRight}');

    expect(handleSelect).toHaveBeenCalledWith('2026-08-25');
  });

  it('wraps around to the first day with ArrowRight from the last day', async () => {
    const handleSelect = vi.fn();
    const user = userEvent.setup();
    render(<WeekSelector days={days as never} selectedDate="2026-08-26" onSelectDate={handleSelect} />);

    screen.getByRole('tab', { name: /26/ }).focus();
    await user.keyboard('{ArrowRight}');

    expect(handleSelect).toHaveBeenCalledWith('2026-08-24');
  });

  it('moves selection to the previous day with ArrowLeft, wrapping from the first day', async () => {
    const handleSelect = vi.fn();
    const user = userEvent.setup();
    render(<WeekSelector days={days as never} selectedDate="2026-08-24" onSelectDate={handleSelect} />);

    screen.getByRole('tab', { name: /24/ }).focus();
    await user.keyboard('{ArrowLeft}');

    expect(handleSelect).toHaveBeenCalledWith('2026-08-26');
  });
});
