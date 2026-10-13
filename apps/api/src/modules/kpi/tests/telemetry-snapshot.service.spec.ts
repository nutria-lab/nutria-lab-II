import { TELEMETRY_KPI_IDS, buildTelemetryResults } from '../calc/telemetry-formulas';
import {
  FINALIZE_MAX_ATTEMPTS,
  KpiSnapshotError,
  TelemetrySnapshotService,
} from '../snapshots/telemetry-snapshot.service';
import type { SnapshotCut } from '../snapshots/telemetry-snapshot.service';
import { windowForDate } from '../window/kpi-window';
import { FakeSnapshotStore, pgError, sampleAggregates, storedFinals } from './telemetry-fakes.fixture';

const DAY = '2026-10-11';
const CANON = windowForDate(DAY); // 2026-10-11T03:00Z .. 2026-10-12T00:00Z
const FINAL_CUT: SnapshotCut = { environment: 'dev', date: DAY, start: CANON.start, end: CANON.end };
const NOW = new Date('2026-10-12T15:00:00.000Z');

function makeService(store: FakeSnapshotStore, afterFinalsRead?: (attempt: number) => Promise<void>) {
  return new TelemetrySnapshotService(store, () => new Date(NOW), afterFinalsRead ? { afterFinalsRead } : undefined);
}

describe('TelemetrySnapshotService.preview (G1)', () => {
  it('calcula los 8 en UNA transacción y los guarda con un único upsert del corte', async () => {
    const store = new FakeSnapshotStore((_env, w) => sampleAggregates(w.end));
    const previewCut: SnapshotCut = { ...FINAL_CUT, end: new Date('2026-10-11T18:00:00.000Z') };

    const run = await makeService(store).preview(previewCut);

    expect(store.isolations).toHaveLength(1);
    expect(store.calls.loadAggregates).toHaveBeenCalledWith('dev', { start: previewCut.start, end: previewCut.end });
    expect(store.calls.upsertPreviews).toHaveBeenCalledTimes(1);
    const [cutArg, results] = store.calls.upsertPreviews.mock.calls[0];
    expect(cutArg).toEqual(previewCut);
    expect(results.map((r: { kpi_id: string }) => r.kpi_id)).toEqual([...TELEMETRY_KPI_IDS]);
    expect(run.results).toEqual(results);
    expect(store.calls.insertFinals).not.toHaveBeenCalled();
  });

  it('el resultado sale de las fórmulas puras con measured_at = reloj', async () => {
    const store = new FakeSnapshotStore((_env, w) => sampleAggregates(w.end));
    const run = await makeService(store).preview(FINAL_CUT);
    const expected = buildTelemetryResults(sampleAggregates(FINAL_CUT.end), FINAL_CUT, NOW);
    expect(run.results).toEqual(expected);
  });
});

describe('TelemetrySnapshotService.finalizeCore (G2, D14)', () => {
  it('corre en REPEATABLE READ y, sin finales, inserta los 8 calculados en el mismo snapshot', async () => {
    const store = new FakeSnapshotStore((_env, w) => sampleAggregates(w.end));

    const run = await makeService(store).finalizeCore(FINAL_CUT);

    expect(store.isolations).toEqual(['RepeatableRead']);
    expect(store.calls.readFinals).toHaveBeenCalledWith(FINAL_CUT);
    expect(store.calls.loadAggregates).toHaveBeenCalledWith('dev', { start: FINAL_CUT.start, end: FINAL_CUT.end });
    expect(store.calls.insertFinals).toHaveBeenCalledTimes(1);
    expect(store.calls.upsertPreviews).not.toHaveBeenCalled();
    expect(run.reused).toBe(false);
    expect(run.results.map(r => r.kpi_id)).toEqual([...TELEMETRY_KPI_IDS]);
    // lectura antes que cálculo e inserción
    const readOrder = store.calls.readFinals.mock.invocationCallOrder[0];
    expect(readOrder).toBeLessThan(store.calls.loadAggregates.mock.invocationCallOrder[0]);
    expect(store.calls.loadAggregates.mock.invocationCallOrder[0]).toBeLessThan(
      store.calls.insertFinals.mock.invocationCallOrder[0],
    );
  });

  it('con 8 finales existentes los devuelve sin recalcular ni insertar', async () => {
    const store = new FakeSnapshotStore((_env, w) => sampleAggregates(w.end));
    const existing = storedFinals('2026-10-12T00:05:00.000Z');
    store.readFinalsQueue = [existing];

    const run = await makeService(store).finalizeCore(FINAL_CUT);

    expect(run.reused).toBe(true);
    expect(run.results).toEqual(existing);
    expect(store.calls.loadAggregates).not.toHaveBeenCalled();
    expect(store.calls.insertFinals).not.toHaveBeenCalled();
    expect(store.calls.upsertPreviews).not.toHaveBeenCalled();
  });

  it.each([1, 7])('%i finales ⇒ KPI_FINAL_INCOMPLETE sin insertar', async count => {
    const store = new FakeSnapshotStore((_env, w) => sampleAggregates(w.end));
    store.readFinalsQueue = [storedFinals('2026-10-12T00:05:00.000Z').slice(0, count)];

    const error = await makeService(store).finalizeCore(FINAL_CUT).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KpiSnapshotError);
    expect(error).toMatchObject({ code: 'KPI_FINAL_INCOMPLETE' });
    expect(store.calls.insertFinals).not.toHaveBeenCalled();
  });

  it.each(['23505', '40001'])('conflicto %s ⇒ nueva transacción que devuelve los 8 del ganador', async code => {
    const store = new FakeSnapshotStore((_env, w) => sampleAggregates(w.end));
    const winner = storedFinals('2026-10-12T00:01:00.000Z', 3);
    store.readFinalsQueue = [[], winner];
    store.insertFinalsErrors = [pgError(code)];

    const run = await makeService(store).finalizeCore(FINAL_CUT);

    expect(store.isolations).toEqual(['RepeatableRead', 'RepeatableRead']);
    expect(run.reused).toBe(true);
    expect(run.results).toEqual(winner);
    expect(store.calls.insertFinals).toHaveBeenCalledTimes(1);
  });

  it('3 conflictos seguidos ⇒ KPI_FINALIZE_CONFLICT tras exactamente 3 transacciones', async () => {
    const store = new FakeSnapshotStore((_env, w) => sampleAggregates(w.end));
    store.readFinalsQueue = [[]];
    store.insertFinalsErrors = [pgError('40001'), pgError('23505'), pgError('40001'), pgError('40001')];

    const error = await makeService(store).finalizeCore(FINAL_CUT).catch((e: unknown) => e);

    expect(FINALIZE_MAX_ATTEMPTS).toBe(3);
    expect(error).toBeInstanceOf(KpiSnapshotError);
    expect(error).toMatchObject({ code: 'KPI_FINALIZE_CONFLICT' });
    expect(store.isolations).toHaveLength(3);
  });

  it('un error no reintentable se propaga sin reintentar', async () => {
    const store = new FakeSnapshotStore((_env, w) => sampleAggregates(w.end));
    store.insertFinalsErrors = [pgError('ECONNREFUSED')];

    await expect(makeService(store).finalizeCore(FINAL_CUT)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    expect(store.isolations).toHaveLength(1);
  });

  it('invoca la barrera inyectable entre la lectura y la inserción, con el número de intento', async () => {
    const store = new FakeSnapshotStore((_env, w) => sampleAggregates(w.end));
    const barrier = jest.fn(async (_attempt: number) => undefined);

    await makeService(store, barrier).finalizeCore(FINAL_CUT);

    expect(barrier).toHaveBeenCalledWith(1);
    const barrierOrder = barrier.mock.invocationCallOrder[0];
    expect(store.calls.readFinals.mock.invocationCallOrder[0]).toBeLessThan(barrierOrder);
    expect(barrierOrder).toBeLessThan(store.calls.insertFinals.mock.invocationCallOrder[0]);
  });

  it('no toma muestra de salud ni falsea las 21:00: measured_at es el reloj real (H4)', async () => {
    const store = new FakeSnapshotStore((_env, w) => sampleAggregates(w.end));

    const run = await makeService(store).finalizeCore(FINAL_CUT);

    for (const result of run.results) {
      expect(result.measured_at).toBe(NOW.toISOString());
      expect(result.measured_at).not.toBe(FINAL_CUT.end.toISOString());
    }
  });
});
