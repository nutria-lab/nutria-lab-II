import 'reflect-metadata';
import { TELEMETRY_KPI_IDS } from '../calc/telemetry-formulas';
import type { CollectionContext, KpiId, KpiLogger, KpiResult } from '../kpi-contract';
import { KpiModule } from '../kpi.module';
import { KpiSnapshotError, TelemetrySnapshotService } from '../snapshots/telemetry-snapshot.service';
import { KpiContextError, TelemetryLogger } from '../telemetry-logger';
import { windowForDate } from '../window/kpi-window';
import { FakeSnapshotStore, pgError, sampleAggregates, storedFinals } from './telemetry-fakes.fixture';

const DAY = '2026-10-11';
const CANON = windowForDate(DAY);
const CLOCK_HOURS_LATER = new Date('2026-10-12T18:30:00.000Z'); // 15:30 local del día siguiente

const ALL_KPI_IDS: readonly KpiId[] = [
  'availability_rate',
  'dependency_error_rate',
  'error_rate',
  'health_status',
  'initial_plans_count',
  'last_success_age_seconds',
  'latency_p95_ms',
  'manual_recipes_count',
  'operations_count',
  'timeout_rate',
];

function context(overrides: Partial<CollectionContext> = {}): CollectionContext {
  return {
    contract_version: '1',
    date: DAY,
    environment: 'dev',
    window_start: CANON.start.toISOString(),
    window_end: CANON.end.toISOString(),
    run_id: '6f1c2b2e-3f0a-4f7e-9a51-1b2c3d4e5f60',
    ...overrides,
  };
}

function makeLogger(clock: () => Date = () => new Date(CLOCK_HOURS_LATER)) {
  const store = new FakeSnapshotStore((_env, w) => sampleAggregates(w.end));
  const core = new TelemetrySnapshotService(store, clock);
  const finalizeSpy = jest.spyOn(core, 'finalizeCore');
  const logger = new TelemetryLogger(core, { environment: 'dev' }, clock);
  return { store, core, finalizeSpy, logger };
}

/** Composite falso: consume KpiLogger del contrato y exige ids disjuntos. */
class FakeComposite {
  constructor(private readonly loggers: readonly KpiLogger[]) {}

  async collect(ctx: CollectionContext): Promise<KpiResult[]> {
    const all: KpiResult[] = [];
    for (const logger of this.loggers) {
      const results = await logger.collect(ctx);
      for (const result of results) {
        if (all.some(r => r.kpi_id === result.kpi_id)) throw new Error(`duplicate ${result.kpi_id}`);
        all.push(result);
      }
    }
    return all.sort((a, b) => a.kpi_id.localeCompare(b.kpi_id));
  }
}

const businessLogger: KpiLogger = {
  async collect(ctx) {
    return (['initial_plans_count', 'manual_recipes_count'] as const).map(kpiId => ({
      kpi_id: kpiId,
      value: 1,
      quality: 'observed' as const,
      reason: null,
      sample_count: 1,
      measured_at: ctx.window_end,
    }));
  },
};

describe('TelemetryLogger.collect (G4)', () => {
  it('implementa KpiLogger y devuelve exactamente los 8 códigos de Telemetry ordenados por kpi_id', async () => {
    const { logger } = makeLogger();
    const asContract: KpiLogger = logger;

    const results = await asContract.collect(context());

    expect(results.map(r => r.kpi_id)).toEqual([...TELEMETRY_KPI_IDS]);
  });

  it('usa el corte fijo del contexto aunque el reloj esté horas después, vía el núcleo de finalize', async () => {
    const { logger, finalizeSpy, store } = makeLogger();

    await logger.collect(context());

    expect(finalizeSpy).toHaveBeenCalledTimes(1);
    expect(finalizeSpy).toHaveBeenCalledWith({ environment: 'dev', date: DAY, start: CANON.start, end: CANON.end });
    expect(store.isolations).toEqual(['RepeatableRead']);
    expect(store.calls.loadAggregates).toHaveBeenCalledWith('dev', { start: CANON.start, end: CANON.end });
  });

  it('con finales existentes devuelve los guardados (measured_at original)', async () => {
    const { logger, store } = makeLogger();
    const existing = storedFinals('2026-10-12T00:05:00.000Z');
    store.readFinalsQueue = [existing];

    await expect(logger.collect(context())).resolves.toEqual(existing);
  });

  describe('contexto mal formado ⇒ lanza (no traduce a unavailable)', () => {
    const cases: [string, Partial<CollectionContext>, string][] = [
      ['contract_version distinto de 1', { contract_version: '2' as '1' }, 'KPI_CONTRACT_VERSION_MISMATCH'],
      ['environment distinto de KPI_ENV', { environment: 'prod' }, 'KPI_ENV_MISMATCH'],
      [
        'window_end no canónico',
        { window_end: new Date(CANON.end.getTime() - 3_600_000).toISOString() },
        'KPI_CONTEXT_WINDOW_MISMATCH',
      ],
      [
        'window_start no canónico',
        { window_start: new Date(CANON.start.getTime() + 1).toISOString() },
        'KPI_CONTEXT_WINDOW_MISMATCH',
      ],
      ['fecha inválida', { date: '2026-02-30' }, 'INVALID_DATE'],
    ];

    it.each(cases)('%s', async (_name, overrides, code) => {
      const { logger, finalizeSpy } = makeLogger();
      await expect(logger.collect(context(overrides))).rejects.toMatchObject({ code });
      expect(finalizeSpy).not.toHaveBeenCalled();
    });

    it('KPI_ENV del proceso ausente ⇒ KPI_ENV_MISMATCH', async () => {
      const store = new FakeSnapshotStore((_env, w) => sampleAggregates(w.end));
      const logger = new TelemetryLogger(new TelemetrySnapshotService(store, () => CLOCK_HOURS_LATER), {
        environment: null,
      });
      const error = await logger.collect(context()).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(KpiContextError);
      expect(error).toMatchObject({ code: 'KPI_ENV_MISMATCH' });
    });

    it('corte futuro ⇒ FUTURE_CUT', async () => {
      const { logger, finalizeSpy } = makeLogger(() => new Date('2026-10-11T20:00:00.000Z')); // 17:00 local de D
      await expect(logger.collect(context())).rejects.toMatchObject({ code: 'FUTURE_CUT' });
      expect(finalizeSpy).not.toHaveBeenCalled();
    });
  });

  describe('fuente caída ⇒ 8 unavailable SOURCE_UNAVAILABLE sin persistir', () => {
    it.each([
      ['DB caída', pgError('ECONNREFUSED')],
      ['conflicto agotado', new KpiSnapshotError('KPI_FINALIZE_CONFLICT')],
    ])('%s', async (_name, failure) => {
      const { logger, store } = makeLogger();
      store.transactionError = failure;

      const results = await logger.collect(context());

      expect(results.map(r => r.kpi_id)).toEqual([...TELEMETRY_KPI_IDS]);
      for (const result of results) {
        expect(result).toEqual({
          kpi_id: result.kpi_id,
          value: null,
          quality: 'unavailable',
          reason: 'SOURCE_UNAVAILABLE',
          sample_count: 0,
          measured_at: CLOCK_HOURS_LATER.toISOString(),
        });
      }
      expect(store.calls.insertFinals).not.toHaveBeenCalled();
      expect(store.calls.upsertPreviews).not.toHaveBeenCalled();
    });
  });

  describe('fallas de conexión/timeout/conflicto siguen siendo SOURCE_UNAVAILABLE', () => {
    it.each([
      ['08006 connection failure', pgError('08006')],
      ['08001 no se pudo conectar', pgError('08001')],
      ['57014 statement_timeout', pgError('57014')],
      ['ETIMEDOUT', pgError('ETIMEDOUT')],
      ['23505 hasta agotar reintentos', pgError('23505')],
      ['40001 hasta agotar reintentos', pgError('40001')],
    ])('%s ⇒ 8 unavailable SOURCE_UNAVAILABLE', async (_name, failure) => {
      const { logger, store } = makeLogger();
      store.transactionError = failure;

      const results = await logger.collect(context());

      expect(results).toHaveLength(8);
      for (const result of results) expect(result).toMatchObject({ quality: 'unavailable', reason: 'SOURCE_UNAVAILABLE' });
      expect(store.calls.insertFinals).not.toHaveBeenCalled();
    });
  });

  describe('errores de programación/estructura (SQLSTATE clase 42, clase 23 salvo 23505) se PROPAGAN', () => {
    const prismaWrapped = (sqlState: string) =>
      Object.assign(new Error('Raw query failed'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2010',
        clientVersion: '7.0.0',
        meta: { code: sqlState, message: 'secret detail' },
      });
    const adapterWrapped = (sqlState: string) =>
      Object.assign(new Error('driver adapter error'), {
        name: 'DriverAdapterError',
        cause: { kind: 'postgres', originalCode: sqlState, originalMessage: 'secret detail' },
      });

    it.each([
      ['42P01 tabla inexistente (pg)', pgError('42P01')],
      ['42703 columna inexistente (pg)', pgError('42703')],
      ['42601 error de sintaxis (pg)', pgError('42601')],
      ['23514 CHECK violado (pg)', pgError('23514')],
      ['23502 NOT NULL violado (pg)', pgError('23502')],
      ['42P01 envuelto por Prisma (P2010 + meta.code)', prismaWrapped('42P01')],
      ['23514 envuelto por Prisma (P2010 + meta.code)', prismaWrapped('23514')],
      ['42703 envuelto por adapter-pg (cause.originalCode)', adapterWrapped('42703')],
      ['23514 envuelto por adapter-pg (cause.originalCode)', adapterWrapped('23514')],
    ])('%s ⇒ collect rechaza con el mismo error, sin 8 unavailable', async (_name, failure) => {
      const { logger, store } = makeLogger();
      store.transactionError = failure;

      await expect(logger.collect(context())).rejects.toBe(failure);
      expect(store.calls.insertFinals).not.toHaveBeenCalled();
    });

    it('también si el error estructural aparece al calcular (loadAggregates), no sólo al abrir la transacción', async () => {
      const { logger, store } = makeLogger();
      const failure = pgError('42703');
      store.calls.loadAggregates.mockRejectedValue(failure);

      await expect(logger.collect(context())).rejects.toBe(failure);
    });
  });

  describe('fecha ya purgada (report_date < computePurgeCutoff(now)) ⇒ PURGED_WINDOW sin recalcular', () => {
    const NOW_2027 = new Date('2027-05-20T15:00:00.000Z'); // corte vigente 2027-04-01 (mitad del trimestre)
    const contextFor = (day: string): CollectionContext => {
      const w = windowForDate(day);
      return context({ date: day, window_start: w.start.toISOString(), window_end: w.end.toISOString() });
    };

    it('día anterior al corte ⇒ 8 unavailable reason PURGED_WINDOW, sin leer agregados ni insertar', async () => {
      const { logger, store } = makeLogger(() => new Date(NOW_2027));

      const results = await logger.collect(contextFor('2027-02-10'));

      expect(results.map(r => r.kpi_id)).toEqual([...TELEMETRY_KPI_IDS]);
      for (const result of results) {
        expect(result).toEqual({
          kpi_id: result.kpi_id,
          value: null,
          quality: 'unavailable',
          reason: 'PURGED_WINDOW',
          sample_count: 0,
          measured_at: NOW_2027.toISOString(),
        });
      }
      expect(store.calls.loadAggregates).not.toHaveBeenCalled();
      expect(store.calls.insertFinals).not.toHaveBeenCalled();
      expect(store.calls.upsertPreviews).not.toHaveBeenCalled();
    });

    it('justo el día anterior al corte (2027-03-31) también es PURGED_WINDOW', async () => {
      const { logger, store } = makeLogger(() => new Date(NOW_2027));

      const results = await logger.collect(contextFor('2027-03-31'));

      for (const result of results) expect(result).toMatchObject({ quality: 'unavailable', reason: 'PURGED_WINDOW' });
      expect(store.calls.loadAggregates).not.toHaveBeenCalled();
      expect(store.calls.insertFinals).not.toHaveBeenCalled();
    });

    it('si los 8 finales ya existen, los devuelve tal cual (sin recalcular ni insertar)', async () => {
      const { logger, store } = makeLogger(() => new Date(NOW_2027));
      const existing = storedFinals('2027-02-11T00:05:00.000Z');
      store.readFinalsQueue = [existing];

      await expect(logger.collect(contextFor('2027-02-10'))).resolves.toEqual(existing);
      expect(store.calls.loadAggregates).not.toHaveBeenCalled();
      expect(store.calls.insertFinals).not.toHaveBeenCalled();
    });

    it('el día del corte (2027-04-01) no está purgado: calcula normalmente', async () => {
      const { logger, store } = makeLogger(() => new Date(NOW_2027));

      const results = await logger.collect(contextFor('2027-04-01'));

      expect(store.calls.loadAggregates).toHaveBeenCalledTimes(1);
      expect(store.calls.insertFinals).toHaveBeenCalledTimes(1);
      expect(results.every(r => r.reason !== 'PURGED_WINDOW')).toBe(true);
    });

    it('antes de 2027 no hay corte: una fecha vieja de 2026 se calcula normalmente', async () => {
      const { logger, store } = makeLogger(() => new Date('2026-12-20T15:00:00.000Z'));

      const results = await logger.collect(contextFor('2026-01-15'));

      expect(store.calls.loadAggregates).toHaveBeenCalledTimes(1);
      expect(results.every(r => r.reason !== 'PURGED_WINDOW')).toBe(true);
    });
  });

  it('Composite falso: ids disjuntos con initial_plans_count/manual_recipes_count y completo con ellos', async () => {
    const { logger } = makeLogger();
    const composite = new FakeComposite([logger, businessLogger]);

    const results = await composite.collect(context());

    expect(results.map(r => r.kpi_id)).toEqual([...ALL_KPI_IDS]);
  });

  it('KpiModule provee y exporta TelemetryLogger', () => {
    const exportsMeta = (Reflect.getMetadata('exports', KpiModule) ?? []) as unknown[];
    expect(exportsMeta).toContain(TelemetryLogger);
  });
});
