import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CookTimeSelector } from '@/modules/profile/components/CookTimeSelector';
import type { CookTimePreference } from '@/services/nutritionProfileService';

// jsdom no mueve un range con el teclado. Esto aplica lo que hace el navegador según min, max y step del
// propio input, así la prueba depende de los atributos reales.
type RangeKey = 'ArrowRight' | 'ArrowLeft' | 'Home' | 'End';

function pressKey(slider: HTMLInputElement, key: RangeKey) {
  const min = Number(slider.min);
  const max = Number(slider.max);
  const step = Number(slider.step);
  const current = Number(slider.value);
  const next = {
    ArrowRight: Math.min(current + step, max),
    ArrowLeft: Math.max(current - step, min),
    Home: min,
    End: max,
  }[key];
  if (next !== current) fireEvent.change(slider, { target: { value: String(next) } });
}

const MARKS = ['Rápido (15m)', 'Estándar (30m)', 'Gourmet (60m)'];

function renderSelector(initial: CookTimePreference, disabled = false) {
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <CookTimeSelector
        value={value}
        disabled={disabled}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Harness />);
  return { onChange, slider: screen.getByRole<HTMLInputElement>('slider') };
}

function expectOption(slider: HTMLInputElement, minutes: number, title: string) {
  expect(screen.getByText(`${minutes} min`)).toBeInTheDocument();
  expect(slider).toHaveAttribute('aria-valuetext', `${title}, ${minutes} minutos`);
}

describe('CookTimeSelector — mobile slider', () => {
  it('regression: from 30 min, one right arrow goes to 60 min instead of staying on 30', () => {
    const { slider, onChange } = renderSelector('STANDARD');

    pressKey(slider, 'ArrowRight');

    expect(onChange).toHaveBeenLastCalledWith('GOURMET');
    expect(screen.getByText('60 min')).toBeInTheDocument();
  });

  it('exposes only the three options as positions, with no intermediate value', () => {
    const { slider } = renderSelector('STANDARD');

    expect(slider.min).toBe('0');
    expect(slider.max).toBe('2');
    expect(slider.step).toBe('1');
    expect(slider.value).toBe('1');
  });

  it('arrows walk 15→30→60 and back, one option per press', () => {
    const { slider, onChange } = renderSelector('QUICK');

    pressKey(slider, 'ArrowRight');
    expectOption(slider, 30, 'Estándar');
    pressKey(slider, 'ArrowRight');
    expectOption(slider, 60, 'Gourmet');
    pressKey(slider, 'ArrowLeft');
    expectOption(slider, 30, 'Estándar');
    pressKey(slider, 'ArrowLeft');
    expectOption(slider, 15, 'Rápido');

    expect(onChange.mock.calls.map(([value]) => value)).toEqual(['STANDARD', 'GOURMET', 'STANDARD', 'QUICK']);
  });

  it('at 15 min, the left arrow and Home stay on the first position', () => {
    const { slider } = renderSelector('QUICK');

    pressKey(slider, 'ArrowLeft');
    pressKey(slider, 'Home');

    expect(slider.value).toBe(slider.min);
    expectOption(slider, 15, 'Rápido');
  });

  it('at 60 min, the right arrow and End stay on the last position', () => {
    const { slider } = renderSelector('GOURMET');

    pressKey(slider, 'ArrowRight');
    pressKey(slider, 'End');

    expect(slider.value).toBe(slider.max);
    expectOption(slider, 60, 'Gourmet');
  });

  it('Home goes to 15 min and End to 60 min from the middle', () => {
    const { slider, onChange } = renderSelector('STANDARD');

    pressKey(slider, 'End');
    expect(onChange).toHaveBeenLastCalledWith('GOURMET');
    expectOption(slider, 60, 'Gourmet');

    pressKey(slider, 'Home');
    expect(onChange).toHaveBeenLastCalledWith('QUICK');
    expectOption(slider, 15, 'Rápido');
  });

  it.each([
    ['STANDARD', '0', 'QUICK', 15, 'Rápido'],
    ['QUICK', '1', 'STANDARD', 30, 'Estándar'],
    ['STANDARD', '2', 'GOURMET', 60, 'Gourmet'],
  ] as const)('from %s, a change event to position %s (touch) selects %s', (start, position, value, minutes, title) => {
    const { slider, onChange } = renderSelector(start);

    fireEvent.change(slider, { target: { value: position } });

    expect(onChange).toHaveBeenCalledExactlyOnceWith(value);
    expectOption(slider, minutes, title);
  });

  it.each([
    ['QUICK', '0', 'Rápido, 15 minutos'],
    ['STANDARD', '1', 'Estándar, 30 minutos'],
    ['GOURMET', '2', 'Gourmet, 60 minutos'],
  ] as const)('%s announces the readable option, never the position', (value, position, text) => {
    const { slider } = renderSelector(value);

    expect(slider.value).toBe(position);
    expect(slider).toHaveAttribute('aria-valuetext', text);
    expect(slider).toHaveAccessibleName('Tiempo de cocina');
  });

  it('shows one mark per position, in order, and highlights only the selected one', () => {
    renderSelector('STANDARD');

    const marks = MARKS.map((text) => screen.getByText(text));

    expect(marks[0].compareDocumentPosition(marks[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(marks[1].compareDocumentPosition(marks[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(marks[0]).toHaveClass('text-left');
    expect(marks[1]).toHaveClass('text-center');
    expect(marks[2]).toHaveClass('text-right');
    expect(marks.map((mark) => mark.classList.contains('font-bold'))).toEqual([false, true, false]);
    expect(screen.queryByText(/Elaborado/)).not.toBeInTheDocument();
  });

  it('is disabled when the disabled prop is set', () => {
    const { slider } = renderSelector('STANDARD', true);

    expect(slider).toBeDisabled();
  });

  it('a value outside the enum is shown as not chosen, never as an option', () => {
    const { slider, onChange } = renderSelector('BRUNCH' as CookTimePreference);

    expect(screen.getByText('Sin elegir')).toBeInTheDocument();
    expect(slider).toHaveAttribute('aria-valuetext', 'Sin elegir');
    expect(screen.queryByText(/^\d+ min$/)).not.toBeInTheDocument();
    expect(MARKS.map((text) => screen.getByText(text).classList.contains('font-bold'))).toEqual([false, false, false]);
    for (const card of screen.getAllByRole('button')) {
      expect(card).toHaveAttribute('aria-pressed', 'false');
    }

    pressKey(slider, 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('GOURMET');
  });
});

describe('CookTimeSelector — desktop cards', () => {
  it.each([
    ['Rápido', 'QUICK', 'STANDARD', '0'],
    ['Estándar', 'STANDARD', 'QUICK', '1'],
    ['Gourmet', 'GOURMET', 'STANDARD', '2'],
  ] as const)('%s selects %s (from %s) and moves the slider to position %s', (title, value, start, position) => {
    const { slider, onChange } = renderSelector(start);

    fireEvent.click(screen.getByRole('button', { name: new RegExp(title) }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(value);
    expect(screen.getByRole('button', { name: new RegExp(title) })).toHaveAttribute('aria-pressed', 'true');
    expect(slider.value).toBe(position);
  });

  it('every card is disabled when the disabled prop is set', () => {
    renderSelector('STANDARD', true);

    for (const card of screen.getAllByRole('button')) {
      expect(card).toBeDisabled();
    }
  });
});
