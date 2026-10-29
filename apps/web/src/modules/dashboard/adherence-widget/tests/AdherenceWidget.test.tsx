import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

import { AdherenceWidget } from '@/modules/dashboard/adherence-widget/AdherenceWidget';
import {
  ADHERENCE_WIDGET_ERROR_MESSAGE,
  adherencePartialProgressFixture,
  createAdherenceWidgetProps,
  type AdherenceWidgetFixtureState,
} from '@/modules/dashboard/adherence-widget/fixtures';
import {
  createAdherenceWidgetStateProps,
  type AdherenceWidgetExtraState,
} from '@/modules/dashboard/adherence-widget/stateFixtures';
import type { AdherenceWidgetViewProps } from '@/modules/dashboard/adherence-widget/utils';
import type { AdherenceResponse } from '@/modules/dashboard/types';

const TITLE = 'Progreso de la semana';
const LOAD_ERROR = 'No pudimos cargar tu progreso.';
const REFRESH_ERROR = 'No pudimos actualizar tu progreso.';
const UNAVAILABLE = 'No disponible todavía';
const NO_PLAN = 'Todavía no tenés un plan para esta semana.';
const NO_DATA = 'Sin datos de progreso';
const NO_RECORDS = 'Todavía no hay comidas registradas esta semana.';
const FUTURE_NOTE = 'Incluye todas las comidas planificadas de la semana, también las de los próximos días.';
// Testing Library normaliza el espacio no separable del porcentaje a un espacio común.
const PARTIAL_PERCENT = '32,1 %';
// Copy prohibido: culpabilizante o que afirme consumo real.
const FORBIDDEN_COPY = /comiste|consum|ingeri|incumpl|fallaste|deberías|mal\b/i;

const BASE_STATES: AdherenceWidgetFixtureState[] = [
  'noPlan',
  'planWithoutMeals',
  'partial',
  'loading',
  'error',
  'refreshing',
  'staleWithError',
  'unavailable',
  'retrying',
];
const EXTRA_STATES: AdherenceWidgetExtraState[] = ['noRecords', 'staleWeek', 'stalePlan', 'inconsistent'];

function renderWidget(props: AdherenceWidgetViewProps) {
  const result = render(<AdherenceWidget {...props} />);
  return { ...result, widget: screen.getByRole('region', { name: TITLE }) };
}

function withSummary(summary: Partial<AdherenceResponse['summary']>): AdherenceResponse {
  const data = structuredClone(adherencePartialProgressFixture);
  data.summary = { ...data.summary, ...summary };
  return data;
}

function counter(widget: HTMLElement, label: string): string | null {
  return within(widget).getByText(label, { selector: 'dt' }).nextElementSibling?.textContent ?? null;
}

function expectNoNumbers(widget: HTMLElement) {
  expect(widget.textContent ?? '').not.toMatch(/\d|%/);
  expect(within(widget).queryByRole('progressbar')).not.toBeInTheDocument();
}

async function expectNoAxeViolations(container: HTMLElement) {
  // jsdom no calcula estilos: el contraste queda para la evidencia visual.
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  expect(results.violations.map(({ id, help }) => `${id}: ${help}`)).toEqual([]);
}

type Outcome = 'unavailable' | 'skeleton' | 'loadError' | 'summary' | 'summaryWithAlert';

const OUTCOME_CHECKS: Record<Outcome, (widget: HTMLElement) => void> = {
  unavailable: (widget) => {
    expect(within(widget).getByText(UNAVAILABLE)).toBeInTheDocument();
    expect(widget.querySelector('[aria-busy="true"]')).toBeNull();
    expect(within(widget).queryByRole('button')).not.toBeInTheDocument();
    expectNoNumbers(widget);
  },
  skeleton: (widget) => {
    expect(widget.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(within(widget).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(widget).queryByRole('button')).not.toBeInTheDocument();
    expectNoNumbers(widget);
  },
  loadError: (widget) => {
    expect(within(widget).getByRole('alert')).toHaveTextContent(LOAD_ERROR);
    expect(within(widget).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(within(widget).queryByText(ADHERENCE_WIDGET_ERROR_MESSAGE)).not.toBeInTheDocument();
    expectNoNumbers(widget);
  },
  summary: (widget) => {
    expect(within(widget).getByText(PARTIAL_PERCENT)).toBeInTheDocument();
    expect(widget.querySelector('[aria-busy="true"]')).toBeNull();
    expect(within(widget).queryByRole('alert')).not.toBeInTheDocument();
  },
  summaryWithAlert: (widget) => {
    expect(within(widget).getByText(PARTIAL_PERCENT)).toBeInTheDocument();
    expect(within(widget).getByRole('alert')).toHaveTextContent(REFRESH_ERROR);
    expect(within(widget).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  },
};

// Todas las combinaciones de data × loading × error (design §2). Cada fila parte de un fixture base
// y pisa solo `loading` y `error`.
const DATA_KINDS: Array<[string, () => AdherenceWidgetViewProps, [Outcome, Outcome, Outcome, Outcome]]> = [
  // Orden de los resultados: [sin loading ni error, loading, error, loading + error].
  ['data null', () => createAdherenceWidgetProps('unavailable'), ['unavailable', 'skeleton', 'loadError', 'skeleton']],
  ['stale week', () => createAdherenceWidgetStateProps('staleWeek'), ['loadError', 'skeleton', 'loadError', 'skeleton']],
  ['stale plan', () => createAdherenceWidgetStateProps('stalePlan'), ['loadError', 'skeleton', 'loadError', 'skeleton']],
  ['inconsistent', () => createAdherenceWidgetStateProps('inconsistent'), ['loadError', 'skeleton', 'loadError', 'skeleton']],
  ['usable data', () => createAdherenceWidgetProps('partial'), ['summary', 'summary', 'summaryWithAlert', 'summary']],
];
const FLAGS: Array<[string, boolean, string | null]> = [
  ['no loading, no error', false, null],
  ['loading', true, null],
  ['error', false, ADHERENCE_WIDGET_ERROR_MESSAGE],
  ['loading + error', true, ADHERENCE_WIDGET_ERROR_MESSAGE],
];
const COMBINATIONS = DATA_KINDS.flatMap(([kind, base, outcomes]) =>
  FLAGS.map(([flags, loading, error], index) => [`${kind} + ${flags}`, base, loading, error, outcomes[index]] as const),
);

describe('AdherenceWidget state combinations', () => {
  it.each(COMBINATIONS)('%s → expected outcome', (_label, base, loading, error, outcome) => {
    const { widget } = renderWidget({ ...base(), loading, error });

    OUTCOME_CHECKS[outcome](widget);
  });

  it.each(COMBINATIONS.filter(([, , , , outcome]) => outcome === 'loadError' || outcome === 'summaryWithAlert'))(
    '%s: "Reintentar" calls onRetry',
    async (_label, base, loading, error) => {
      const onRetry = vi.fn();
      const { widget } = renderWidget({ ...base(), loading, error, onRetry });

      await userEvent.click(within(widget).getByRole('button', { name: 'Reintentar' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    },
  );
});

describe('AdherenceWidget usable data', () => {
  it('no plan: explicit state without counters nor percent', () => {
    const { widget } = renderWidget(createAdherenceWidgetProps('noPlan'));

    expect(within(widget).getByText(NO_PLAN)).toBeInTheDocument();
    expectNoNumbers(widget);
  });

  it('plan without meals (null percent): "Sin datos", never 0% nor 100%', () => {
    const { widget } = renderWidget(createAdherenceWidgetProps('planWithoutMeals'));

    expect(within(widget).getByText(NO_DATA)).toBeInTheDocument();
    expectNoNumbers(widget);
  });

  it('partial progress: backend percent, bar, "X de N", counters and the future-meals note', () => {
    const { widget } = renderWidget(createAdherenceWidgetProps('partial'));

    expect(within(widget).getByText(PARTIAL_PERCENT)).toBeInTheDocument();
    expect(within(widget).getByText('9 de 28 comidas completadas')).toBeInTheDocument();
    expect(counter(widget, 'Completadas')).toBe('9');
    expect(counter(widget, 'Omitidas')).toBe('1');
    expect(counter(widget, 'Sin registrar')).toBe('18');
    expect(within(widget).getByText(FUTURE_NOTE)).toBeInTheDocument();
    const bar = within(widget).getByRole('progressbar', { name: TITLE });
    expect(bar).toHaveAttribute('aria-valuenow', '32.1');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuetext', '32,1 %');
    expect(within(widget).queryByText(NO_RECORDS)).not.toBeInTheDocument();
  });

  it('no records yet: summary with the backend 0 and a neutral message', () => {
    const { widget } = renderWidget(createAdherenceWidgetStateProps('noRecords'));

    expect(within(widget).getByText(NO_RECORDS)).toBeInTheDocument();
    expect(within(widget).getByText('0 %')).toBeInTheDocument();
    expect(counter(widget, 'Sin registrar')).toBe('28');
  });

  it('matching expected week and plan: shows the summary', () => {
    const { weekStart, plan } = adherencePartialProgressFixture;
    const { widget } = renderWidget({
      ...createAdherenceWidgetProps('partial'),
      expectedWeekStart: weekStart,
      expectedPlanId: plan!.id,
    });

    expect(within(widget).getByText(PARTIAL_PERCENT)).toBeInTheDocument();
  });
});

describe('AdherenceWidget inconsistent summaries', () => {
  // Cada caso rompe una sola regla; el resto del resumen sigue siendo válido.
  it.each<[string, AdherenceResponse]>([
    ['percent null with planned meals', withSummary({ adherencePercent: null })],
    ['percent above 100', withSummary({ adherencePercent: 120 })],
    ['percent not finite', withSummary({ adherencePercent: Number.NaN })],
    ['counters that do not add up', withSummary({ notLoggedMeals: 17 })],
    ['negative counter', withSummary({ completedMeals: -1, notLoggedMeals: 28 })],
    ['fractional counters', withSummary({ completedMeals: 9.5, notLoggedMeals: 17.5 })],
  ])('%s: recoverable error, no numbers', (_label, data) => {
    const { widget } = renderWidget({ data, loading: false, error: null, onRetry: vi.fn() });

    OUTCOME_CHECKS.loadError(widget);
  });

  it('percent present without planned meals: recoverable error, never a fictitious 0%', () => {
    const data = structuredClone(createAdherenceWidgetProps('planWithoutMeals').data!);
    data.summary.adherencePercent = 0;
    const { widget } = renderWidget({ data, loading: false, error: null, onRetry: vi.fn() });

    OUTCOME_CHECKS.loadError(widget);
  });

  it('no plan with planned meals: recoverable error instead of "no plan"', () => {
    const data = structuredClone(createAdherenceWidgetProps('noPlan').data!);
    data.summary = { plannedMeals: 1, completedMeals: 0, skippedMeals: 0, notLoggedMeals: 1, adherencePercent: 0 };
    const { widget } = renderWidget({ data, loading: false, error: null, onRetry: vi.fn() });

    expect(within(widget).queryByText(NO_PLAN)).not.toBeInTheDocument();
    OUTCOME_CHECKS.loadError(widget);
  });
});

describe('AdherenceWidget values come from the backend', () => {
  it('re-rendering with new data (back from logging) updates every number', () => {
    const props = createAdherenceWidgetProps('partial');
    const { widget, rerender } = renderWidget(props);
    expect(within(widget).getByText(PARTIAL_PERCENT)).toBeInTheDocument();

    const updated = withSummary({ completedMeals: 10, skippedMeals: 1, notLoggedMeals: 17, adherencePercent: 35.7 });
    rerender(<AdherenceWidget {...props} data={updated} />);

    expect(within(widget).getByText('35,7 %')).toBeInTheDocument();
    expect(within(widget).getByText('10 de 28 comidas completadas')).toBeInTheDocument();
    expect(counter(widget, 'Sin registrar')).toBe('17');
    expect(within(widget).queryByText(PARTIAL_PERCENT)).not.toBeInTheDocument();
  });

  it('does not show the mockup 85%: it only appears when the backend sends it', () => {
    const { widget, unmount } = renderWidget(createAdherenceWidgetProps('partial'));
    expect(widget.textContent).not.toMatch(/85/);
    unmount();

    const data = withSummary({ adherencePercent: 85 });
    const { widget: withEightyFive } = renderWidget({ data, loading: false, error: null, onRetry: vi.fn() });
    expect(within(withEightyFive).getByText('85 %')).toBeInTheDocument();
  });
});

describe('AdherenceWidget copy', () => {
  it.each(BASE_STATES)('%s: no blaming nor consumption claims', (state) => {
    const { widget } = renderWidget(createAdherenceWidgetProps(state));

    expect(widget.textContent ?? '').not.toMatch(FORBIDDEN_COPY);
  });

  it.each(EXTRA_STATES)('%s: no blaming nor consumption claims', (state) => {
    const { widget } = renderWidget(createAdherenceWidgetStateProps(state));

    expect(widget.textContent ?? '').not.toMatch(FORBIDDEN_COPY);
  });

  it('labels the metric as progress of the week', () => {
    renderWidget(createAdherenceWidgetProps('partial'));

    expect(screen.getByRole('heading', { level: 2, name: TITLE })).toBeInTheDocument();
  });
});

describe('AdherenceWidget accessibility', () => {
  it.each(BASE_STATES)('%s: no axe violations', async (state) => {
    const { container } = renderWidget(createAdherenceWidgetProps(state));

    await expectNoAxeViolations(container);
  });

  it.each(EXTRA_STATES)('%s: no axe violations', async (state) => {
    const { container } = renderWidget(createAdherenceWidgetStateProps(state));

    await expectNoAxeViolations(container);
  });

  it('the summary is a polite live region so updates are announced', () => {
    const { widget } = renderWidget(createAdherenceWidgetProps('partial'));

    const live = widget.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live).toHaveTextContent(PARTIAL_PERCENT);
    expect(live).toHaveTextContent('9 de 28 comidas completadas');
  });

  it.each<[string, () => AdherenceWidgetViewProps]>([
    ['load error', () => createAdherenceWidgetProps('error')],
    ['refresh error', () => createAdherenceWidgetProps('staleWithError')],
    ['stale data', () => createAdherenceWidgetStateProps('stalePlan')],
  ])('%s: "Reintentar" is reachable with Tab and works with Enter and Space', async (_label, build) => {
    const onRetry = vi.fn();
    renderWidget({ ...build(), onRetry });
    const user = userEvent.setup();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('summary without error has no focus stops', async () => {
    renderWidget(createAdherenceWidgetProps('partial'));

    await userEvent.tab();
    expect(document.body).toHaveFocus();
  });
});

describe('AdherenceWidget responsive layout', () => {
  it.each(['partial', 'error', 'noPlan'] as const)('%s: fluid layout without fixed pixel widths', (state) => {
    const { widget } = renderWidget(createAdherenceWidgetProps(state));

    for (const element of [widget, ...widget.querySelectorAll<HTMLElement>('*')]) {
      expect(element.getAttribute('class') ?? '').not.toMatch(/\b(?:min-)?w-\[\d+px\]/);
    }
  });

  it('counters stay in three columns that shrink on narrow screens', () => {
    const { widget } = renderWidget(createAdherenceWidgetProps('partial'));

    const list = widget.querySelector('dl');
    expect(list).toHaveClass('grid', 'grid-cols-3');
    for (const item of list!.children) {
      expect(item).toHaveClass('min-w-0');
    }
  });

  it('on mobile, counters shrink gap, padding and label size so no label breaks mid-word from 320 px, and recover them from sm', () => {
    const { widget } = renderWidget(createAdherenceWidgetProps('partial'));

    const list = widget.querySelector('dl')!;
    expect(list).toHaveClass('gap-1', 'sm:gap-2');
    expect(list).not.toHaveClass('gap-2');
    for (const item of list.children) {
      expect(item).toHaveClass('px-0.5', 'py-3', 'sm:p-3');
      expect(item).not.toHaveClass('p-3');
      const label = item.querySelector('dt')!;
      expect(label).toHaveClass('text-[11px]', 'sm:text-xs');
      expect(label).not.toHaveClass('text-xs');
    }
  });

  it('keeps the three counter labels', () => {
    const { widget } = renderWidget(createAdherenceWidgetProps('partial'));

    const labels = [...widget.querySelectorAll('dt')].map((dt) => dt.textContent);
    expect(labels).toEqual(['Completadas', 'Omitidas', 'Sin registrar']);
  });

  it('the bar width is a percentage', () => {
    const { widget } = renderWidget(createAdherenceWidgetProps('partial'));

    const fill = within(widget).getByRole('progressbar').firstElementChild as HTMLElement;
    expect(fill.style.width).toBe('32.1%');
  });
});
