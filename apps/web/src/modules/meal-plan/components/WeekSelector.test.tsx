import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WeekSelector } from './WeekSelector';
import type { MealPlanDay } from '../../../services/mealPlanService';

const days: MealPlanDay[] = [
  { date: '2026-08-24', meals: [] },
  { date: '2026-08-25', meals: [] },
  { date: '2026-08-26', meals: [] },
];

describe('WeekSelector', () => {
  it('keeps only the selected day in the natural tab order (roving tabindex)', () => {
    render(<WeekSelector days={days} selectedDate="2026-08-25" onSelectDate={vi.fn()} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('moves selection to the next day with ArrowRight', async () => {
    const handleSelect = vi.fn();
    const user = userEvent.setup();
    render(<WeekSelector days={days} selectedDate="2026-08-24" onSelectDate={handleSelect} />);

    screen.getByRole('tab', { name: /24/ }).focus();
    await user.keyboard('{ArrowRight}');

    expect(handleSelect).toHaveBeenCalledWith('2026-08-25');
  });

  it('wraps around to the first day with ArrowRight from the last day', async () => {
    const handleSelect = vi.fn();
    const user = userEvent.setup();
    render(<WeekSelector days={days} selectedDate="2026-08-26" onSelectDate={handleSelect} />);

    screen.getByRole('tab', { name: /26/ }).focus();
    await user.keyboard('{ArrowRight}');

    expect(handleSelect).toHaveBeenCalledWith('2026-08-24');
  });

  it('moves selection to the previous day with ArrowLeft, wrapping from the first day', async () => {
    const handleSelect = vi.fn();
    const user = userEvent.setup();
    render(<WeekSelector days={days} selectedDate="2026-08-24" onSelectDate={handleSelect} />);

    screen.getByRole('tab', { name: /24/ }).focus();
    await user.keyboard('{ArrowLeft}');

    expect(handleSelect).toHaveBeenCalledWith('2026-08-26');
  });
});
