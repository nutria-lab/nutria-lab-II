import {
  KpiWindowError,
  parseReportDate,
  resolveFinalizeDate,
  resolvePreviewWindow,
  scheduledBucket,
  windowForDate,
} from '../window/kpi-window';

const at = (iso: string): Date => new Date(iso);

/** Ejecuta `fn` y devuelve el `code` del KpiWindowError lanzado (falla si no lanza o lanza otra cosa). */
function thrownCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(KpiWindowError);
    return (error as KpiWindowError).code;
  }
  throw new Error('se esperaba un KpiWindowError y no se lanzó nada');
}

describe('kpi-window — E1 ventana de un día D', () => {
  it('D=2026-10-09 ⇒ 2026-10-09T03:00:00.000Z – 2026-10-10T00:00:00.000Z', () => {
    const window = windowForDate('2026-10-09');

    expect(window.date).toBe('2026-10-09');
    expect(window.start.toISOString()).toBe('2026-10-09T03:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-10-10T00:00:00.000Z');
  });

  it('resuelve el offset por instante con Intl (no un -03:00 fijo): verano 2009 con UTC-2', () => {
    // Argentina aplicó horario de verano (UTC-2) entre 2008-10-19 y 2009-03-15.
    const window = windowForDate('2009-01-10');

    expect(window.start.toISOString()).toBe('2009-01-10T02:00:00.000Z');
    expect(window.end.toISOString()).toBe('2009-01-10T23:00:00.000Z');
  });
});

describe('kpi-window — E2 fecha sin explicitar: último corte de las 21:00 ya pasado', () => {
  it('sin fecha a 2026-10-10T00:05Z ⇒ D=2026-10-09', () => {
    const window = resolveFinalizeDate(at('2026-10-10T00:05:00.000Z'));

    expect(window.date).toBe('2026-10-09');
    expect(window.start.toISOString()).toBe('2026-10-09T03:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-10-10T00:00:00.000Z');
  });

  it('justo en el corte (2026-10-10T00:00:00.000Z) ⇒ D=2026-10-09', () => {
    expect(resolveFinalizeDate(at('2026-10-10T00:00:00.000Z')).date).toBe('2026-10-09');
  });

  it('scheduler atrasado a 2026-10-10T02:00Z ⇒ D=2026-10-09 (no la fecha UTC)', () => {
    const window = resolveFinalizeDate(at('2026-10-10T02:00:00.000Z'));

    expect(window.date).toBe('2026-10-09');
    expect(window.end.toISOString()).toBe('2026-10-10T00:00:00.000Z');
  });

  it('atraso grande pero sin cruzar otro corte (2026-10-10T23:59Z) ⇒ sigue D=2026-10-09', () => {
    expect(resolveFinalizeDate(at('2026-10-10T23:59:00.000Z')).date).toBe('2026-10-09');
  });

  it('a 2026-10-09T23:59Z (20:59 local, corte de hoy no ocurrió) ⇒ D=2026-10-08', () => {
    const window = resolveFinalizeDate(at('2026-10-09T23:59:00.000Z'));

    expect(window.date).toBe('2026-10-08');
    expect(window.start.toISOString()).toBe('2026-10-08T03:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-10-09T00:00:00.000Z');
  });
});

describe('kpi-window — E2 fecha explícita', () => {
  const now = at('2026-10-11T12:00:00.000Z'); // 09:00 local del 2026-10-11

  it('fecha cuyo corte ya ocurrió se respeta tal cual (reintento/ejecución manual)', () => {
    const window = resolveFinalizeDate(now, '2026-10-09');

    expect(window.date).toBe('2026-10-09');
    expect(window.start.toISOString()).toBe('2026-10-09T03:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-10-10T00:00:00.000Z');
  });

  it('fecha de hoy cuyo corte de las 21:00 todavía no ocurrió ⇒ FUTURE_CUT', () => {
    expect(thrownCode(() => resolveFinalizeDate(now, '2026-10-11'))).toBe('FUTURE_CUT');
  });

  it('fecha futura ⇒ FUTURE_CUT', () => {
    expect(thrownCode(() => resolveFinalizeDate(now, '2026-10-12'))).toBe('FUTURE_CUT');
  });

  it('el corte exactamente igual a now ya ocurrió (no se rechaza)', () => {
    expect(resolveFinalizeDate(at('2026-10-10T00:00:00.000Z'), '2026-10-09').date).toBe('2026-10-09');
  });

  it.each(['2026-02-30', '2026-1-5', '2026-13-01', '2026-10-9', '2026/10/09', '2026-10-09T00:00:00Z', '', ' 2026-10-09'])(
    'fecha mal formada o inexistente %p ⇒ INVALID_DATE',
    raw => {
      expect(thrownCode(() => parseReportDate(raw))).toBe('INVALID_DATE');
      expect(thrownCode(() => resolveFinalizeDate(now, raw))).toBe('INVALID_DATE');
    },
  );

  it('parseReportDate acepta una fecha de calendario real (incluido 29 de febrero bisiesto)', () => {
    expect(parseReportDate('2026-10-09')).toBe('2026-10-09');
    expect(parseReportDate('2028-02-29')).toBe('2028-02-29');
    expect(thrownCode(() => parseReportDate('2027-02-29'))).toBe('INVALID_DATE');
  });
});

describe('kpi-window — preview (sample)', () => {
  it('sin fecha usa la fecha local actual y end = now antes de las 21:00', () => {
    const window = resolvePreviewWindow(at('2026-10-09T15:00:00.000Z'));

    expect(window.date).toBe('2026-10-09');
    expect(window.start.toISOString()).toBe('2026-10-09T03:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-10-09T15:00:00.000Z');
    expect(window.skipReason).toBeNull();
  });

  it('después de las 21:00 local end = 21:00 de D (min(now, corte))', () => {
    const window = resolvePreviewWindow(at('2026-10-10T01:30:00.000Z')); // 22:30 local del 2026-10-09

    expect(window.date).toBe('2026-10-09');
    expect(window.end.toISOString()).toBe('2026-10-10T00:00:00.000Z');
    expect(window.skipReason).toBeNull();
  });

  it('fecha explícita pasada ⇒ end = corte de esa fecha', () => {
    const window = resolvePreviewWindow(at('2026-10-11T12:00:00.000Z'), '2026-10-09');

    expect(window.start.toISOString()).toBe('2026-10-09T03:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-10-10T00:00:00.000Z');
  });

  it('start(D) > now ⇒ FUTURE_DATE', () => {
    expect(thrownCode(() => resolvePreviewWindow(at('2026-10-11T12:00:00.000Z'), '2026-10-12'))).toBe('FUTURE_DATE');
  });

  it('end ≤ start (now exactamente en 00:00 local) ⇒ skipReason NO_POSITIVE_WINDOW', () => {
    const window = resolvePreviewWindow(at('2026-10-09T03:00:00.000Z'));

    expect(window.date).toBe('2026-10-09');
    expect(window.skipReason).toBe('NO_POSITIVE_WINDOW');
  });

  it('fecha mal formada ⇒ INVALID_DATE', () => {
    expect(thrownCode(() => resolvePreviewWindow(at('2026-10-11T12:00:00.000Z'), '2026-02-30'))).toBe('INVALID_DATE');
  });
});

describe('kpi-window — bucket de muestra de salud', () => {
  it.each([
    ['2026-10-09T12:00:00.000Z', '2026-10-09T12:00:00.000Z'],
    ['2026-10-09T12:29:59.999Z', '2026-10-09T12:00:00.000Z'],
    ['2026-10-09T12:30:00.000Z', '2026-10-09T12:30:00.000Z'],
    ['2026-10-09T12:47:13.250Z', '2026-10-09T12:30:00.000Z'],
  ])('bucket = floor(now / 30 min) en UTC: %s ⇒ %s', (now, expected) => {
    expect(scheduledBucket(at(now)).toISOString()).toBe(expected);
  });
});
