import { createElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  MealAdherenceControl,
  type AdherenceMeal,
  type AdherenceResponse,
  type MealAdherenceControlProps,
  type MealCompletionStatus,
} from '@/modules/adherence';
import {
  adherenceFixture,
  emptyPlanAdherenceFixture,
  noPlanAdherenceFixture,
  pastWeekAdherenceFixture,
} from '@/modules/adherence/fixtures/adherence.fixture';

const labels: Record<MealCompletionStatus, string> = {
  COMPLETED: 'Completada',
  SKIPPED: 'Omitida',
  NOT_LOGGED: 'Sin registrar',
};
const statuses: MealCompletionStatus[] = ['NOT_LOGGED', 'COMPLETED', 'SKIPPED'];
const lockExplanation = 'Esta comida no está disponible para registrar cambios. Solo se pueden registrar comidas de hoy o anteriores del plan vigente.';

function fixtureMeal(status: MealCompletionStatus = 'NOT_LOGGED'): AdherenceMeal {
  const meal = adherenceFixture.days.flatMap((day) => day.meals).find((item) => item.status === status);
  if (!meal) throw new Error(`Missing ${status} fixture`);
  return { ...meal, canEdit: true };
}

function props(overrides: Partial<MealAdherenceControlProps> = {}): MealAdherenceControlProps {
  return { meal: fixtureMeal(), pending: false, error: null, onSetStatus: vi.fn(), ...overrides };
}

describe('MealAdherenceControl', () => {
  it.each(statuses)('renders the confirmed %s status with accessible choices', (status) => {
    const meal = fixtureMeal(status);
    render(createElement(MealAdherenceControl, props({ meal })));
    const group = screen.getByRole('group', { name: new RegExp(meal.title, 'i') });
    expect(within(group).getAllByRole('button')).toHaveLength(3);
    for (const choice of statuses) {
      expect(within(group).getByRole('button', { name: labels[choice] }))
        .toHaveAttribute('aria-pressed', String(choice === status));
    }
    expect(screen.getByRole('status')).toHaveTextContent(labels[status]);
    expect(screen.getByText(meal.title)).toBeVisible();
  });

  it.each([
    ['NOT_LOGGED', 'COMPLETED'],
    ['NOT_LOGGED', 'SKIPPED'],
    ['COMPLETED', 'NOT_LOGGED'],
    ['SKIPPED', 'NOT_LOGGED'],
  ] satisfies [MealCompletionStatus, MealCompletionStatus][])('emits %s → %s without mutating or optimistically selecting', async (from, to) => {
    const user = userEvent.setup();
    const meal = Object.freeze(fixtureMeal(from));
    const snapshot = { ...meal };
    const onSetStatus = vi.fn();
    render(createElement(MealAdherenceControl, props({ meal, onSetStatus })));
    await user.click(screen.getByRole('button', { name: labels[to] }));
    expect(onSetStatus).toHaveBeenCalledExactlyOnceWith(to);
    expect(screen.getByRole('button', { name: labels[from] })).toHaveAttribute('aria-pressed', 'true');
    expect(meal).toEqual(snapshot);
  });

  it.each(statuses)('ignores activation of the current %s choice', async (status) => {
    const user = userEvent.setup();
    const onSetStatus = vi.fn();
    render(createElement(MealAdherenceControl, props({ meal: fixtureMeal(status), onSetStatus })));
    await user.click(screen.getByRole('button', { name: labels[status] }));
    expect(onSetStatus).not.toHaveBeenCalled();
  });

  it('blocks repeated click and keyboard activations while pending and retains focus and confirmed selection', async () => {
    const user = userEvent.setup();
    const input = props();
    const view = render(createElement(MealAdherenceControl, input));
    const complete = screen.getByRole('button', { name: 'Completada' });
    await user.click(complete);
    expect(input.onSetStatus).toHaveBeenCalledExactlyOnceWith('COMPLETED');
    const liveStatus = screen.getByRole('status');
    view.rerender(createElement(MealAdherenceControl, { ...input, pending: true }));
    expect(complete).toHaveFocus();
    expect(screen.getByRole('status')).toBe(liveStatus);
    expect(liveStatus).toHaveTextContent(/Guardando/);
    expect(screen.getByRole('button', { name: 'Sin registrar' })).toHaveAttribute('aria-pressed', 'true');
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      await user.click(button);
      await user.keyboard('{Enter} ');
    }
    expect(input.onSetStatus).toHaveBeenCalledTimes(1);
  });

  it('explains and blocks a server read-only meal using click, Enter and Space', async () => {
    const user = userEvent.setup();
    const input = props({ meal: { ...fixtureMeal(), canEdit: false } });
    render(createElement(MealAdherenceControl, input));
    expect(screen.getByText(lockExplanation)).toBeVisible();
    const group = screen.getByRole('group', { name: new RegExp(input.meal.title, 'i') });
    expect(group).toHaveAccessibleDescription(lockExplanation);
    for (const button of within(group).getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      await user.click(button);
      await user.keyboard('{Enter} ');
    }
    expect(input.onSetStatus).not.toHaveBeenCalled();
  });

  it('recovers from pending → error → retry → confirmed success without moving focus', async () => {
    const user = userEvent.setup();
    const input = props();
    const view = render(createElement(MealAdherenceControl, input));
    const complete = screen.getByRole('button', { name: 'Completada' });
    await user.click(complete);
    view.rerender(createElement(MealAdherenceControl, { ...input, pending: true }));
    const error = 'No se pudo guardar <img src=x onerror=alert(1)>'; 
    view.rerender(createElement(MealAdherenceControl, { ...input, error }));
    expect(complete).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent(error);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sin registrar' })).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{Enter}');
    expect(input.onSetStatus).toHaveBeenNthCalledWith(2, 'COMPLETED');
    view.rerender(createElement(MealAdherenceControl, { ...input, pending: true }));
    view.rerender(createElement(MealAdherenceControl, { ...input, meal: { ...input.meal, status: 'COMPLETED' } }));
    expect(complete).toHaveFocus();
    expect(complete).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Completada');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input.onSetStatus).toHaveBeenCalledTimes(2);
  });

  it('supports Tab, Enter and Space in natural order without submitting an ancestor form', async () => {
    const user = userEvent.setup();
    const input = props();
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(createElement('form', { onSubmit: submit }, createElement(MealAdherenceControl, input)));
    const buttons = screen.getAllByRole('button');
    for (const button of buttons) {
      expect(button).toHaveAttribute('type', 'button');
      await user.tab();
      expect(button).toHaveFocus();
    }
    const complete = screen.getByRole('button', { name: 'Completada' });
    complete.focus();
    await user.keyboard('{Enter}');
    const skipped = screen.getByRole('button', { name: 'Omitida' });
    skipped.focus();
    await user.keyboard(' ');
    expect(input.onSetStatus).toHaveBeenNthCalledWith(1, 'COMPLETED');
    expect(input.onSetStatus).toHaveBeenNthCalledWith(2, 'SKIPPED');
    expect(submit).not.toHaveBeenCalled();
  });

  it('renders a nullable recipe and allows server-authorized edits in a past week', async () => {
    const user = userEvent.setup();
    const pastMeal = pastWeekAdherenceFixture.days.flatMap((day) => day.meals).find((meal) => meal.canEdit);
    if (!pastMeal) throw new Error('Missing editable past-week fixture');
    const meal: AdherenceMeal = { ...pastMeal, recipeId: null, status: 'NOT_LOGGED' };
    const onSetStatus = vi.fn();
    render(createElement(MealAdherenceControl, props({ meal, onSetStatus })));
    expect(screen.getByText(meal.title)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Completada' }));
    expect(onSetStatus).toHaveBeenCalledExactlyOnceWith('COMPLETED');
  });

  it('keeps descriptions local to each of multiple controls with the same title', () => {
    const meal = { ...fixtureMeal(), canEdit: false };
    const view = render(createElement('div', null,
      createElement(MealAdherenceControl, props({ meal })),
      createElement(MealAdherenceControl, props({ meal: { ...meal, plannedMealId: 'another-meal' } })),
    ));
    const groups = screen.getAllByRole('group');
    expect(groups).toHaveLength(2);
    const descriptionIds = groups.map((group) => group.getAttribute('aria-describedby'));
    expect(descriptionIds[0]).toBeTruthy();
    expect(descriptionIds[1]).toBeTruthy();
    expect(descriptionIds[0]).not.toBe(descriptionIds[1]);
    for (const group of groups) expect(group).toHaveAccessibleDescription(lockExplanation);
    const ids = Array.from(view.container.querySelectorAll('[id]'), (element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('contract A handoff fixtures', () => {
  it.each([
    ['current', adherenceFixture],
    ['past week', pastWeekAdherenceFixture],
    ['no plan', noPlanAdherenceFixture],
    ['empty plan', emptyPlanAdherenceFixture],
  ] satisfies [string, AdherenceResponse][])('keeps %s counters and nullable percentages coherent', (_name, response) => {
    expect(response.timezone).toBe('America/Argentina/Buenos_Aires');
    for (const day of response.days) {
      expect(day.plannedMeals).toBe(day.meals.length);
      expect(day.completedMeals).toBe(day.meals.filter((meal) => meal.status === 'COMPLETED').length);
      expect(day.skippedMeals).toBe(day.meals.filter((meal) => meal.status === 'SKIPPED').length);
      expect(day.notLoggedMeals).toBe(day.meals.filter((meal) => meal.status === 'NOT_LOGGED').length);
    }
    for (const key of ['plannedMeals', 'completedMeals', 'skippedMeals', 'notLoggedMeals'] as const) {
      expect(response.summary[key]).toBe(response.days.reduce((total, day) => total + day[key], 0));
    }
    for (const counters of [...response.days, response.summary]) {
      expect(counters.adherencePercent).toBe(counters.plannedMeals === 0
        ? null : Math.round(counters.completedMeals / counters.plannedMeals * 1000) / 10);
    }
  });

  it('covers no plan, empty plan, all states, nullable recipe and future read-only meals', () => {
    expect(noPlanAdherenceFixture.plan).toBeNull();
    expect(noPlanAdherenceFixture.days).toEqual([]);
    expect(noPlanAdherenceFixture.summary).toEqual({ plannedMeals: 0, completedMeals: 0, skippedMeals: 0, notLoggedMeals: 0, adherencePercent: null });
    expect(emptyPlanAdherenceFixture.plan).not.toBeNull();
    expect(emptyPlanAdherenceFixture.summary).toEqual(noPlanAdherenceFixture.summary);
    const meals = adherenceFixture.days.flatMap((day) => day.meals);
    expect(new Set(meals.map((meal) => meal.status))).toEqual(new Set(statuses));
    expect(meals.some((meal) => meal.recipeId === null)).toBe(true);
    const futureMeals = adherenceFixture.days.filter((day) => day.date > adherenceFixture.today).flatMap((day) => day.meals);
    expect(futureMeals.length).toBeGreaterThan(0);
    expect(futureMeals.every((meal) => !meal.canEdit)).toBe(true);
    expect(pastWeekAdherenceFixture.weekStart < adherenceFixture.weekStart).toBe(true);
    expect(pastWeekAdherenceFixture.days.some((day) => day.date < pastWeekAdherenceFixture.today && day.meals.some((meal) => meal.canEdit))).toBe(true);
  });
});
