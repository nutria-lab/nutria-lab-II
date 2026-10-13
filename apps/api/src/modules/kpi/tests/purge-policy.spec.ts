// NUT-85 T5 — Política de purga trimestral (H6; design D16). Unit, sin DB.
// API fijada (cli/purge-policy.ts):
//   PURGE_START_DATE = '2027-01-01'; PURGE_BATCH_SIZE = 1000; PURGE_MAX_BATCHES = 100 (por corrida, todas las tablas)
//   PURGE_TABLES = ['kpi_http_event', 'kpi_dependency_event', 'kpi_health_sample', 'kpi_snapshot'] (nunca kpi_publication)
//   interface PurgeCutoff { date: string /* YYYY-MM-DD local */; start: Date /* 00:00 local de date, en UTC */ }
//   computePurgeCutoff(now): PurgeCutoff | null
//     null si la fecha local de hoy < 2027-01-01; si no, min(primer día del trimestre local, día en preparación),
//     donde día en preparación = D del último corte de las 21:00 locales ya ocurrido.
//   interface PurgePort { purgeBatch(table, environment, cutoff, limit): Promise<number> }
//   runPurge(port, environment, cutoff): Promise<{ cutoff: string; deleted: Record<PurgeTable, number>; batches: number }>
//     bucle por tabla hasta 0 filas (o un lote incompleto), lotes de 1000, tope total de 100 lotes por corrida.
import {
  PURGE_BATCH_SIZE,
  PURGE_MAX_BATCHES,
  PURGE_START_DATE,
  PURGE_TABLES,
  computePurgeCutoff,
  runPurge,
} from '../cli/purge-policy';
import type { PurgeCutoff } from '../cli/purge-policy';
import { resolveFinalizeDate } from '../window/kpi-window';

describe('computePurgeCutoff (H6)', () => {
  it('constantes del contrato', () => {
    expect(PURGE_START_DATE).toBe('2027-01-01');
    expect(PURGE_BATCH_SIZE).toBe(1000);
    expect(PURGE_MAX_BATCHES).toBe(100);
    expect([...PURGE_TABLES].sort()).toEqual(
      ['kpi_dependency_event', 'kpi_health_sample', 'kpi_http_event', 'kpi_snapshot'].sort(),
    );
    expect(PURGE_TABLES).not.toContain('kpi_publication');
  });

  it.each(['2026-10-12T15:00:00.000Z', '2026-12-31T23:59:59.999Z'])('antes de 2027-01-01 no purga (%s)', now => {
    expect(computePurgeCutoff(new Date(now))).toBeNull();
  });

  it('2027-01-01T00:10Z (todavía 2026-12-31 en AR) no purga', () => {
    expect(computePurgeCutoff(new Date('2027-01-01T00:10:00.000Z'))).toBeNull();
  });

  it('2027-04-02 ⇒ corte = 2027-04-01 local (00:00 AR en UTC)', () => {
    expect(computePurgeCutoff(new Date('2027-04-02T15:00:00.000Z'))).toEqual({
      date: '2027-04-01',
      start: new Date('2027-04-01T03:00:00.000Z'),
    });
  });

  it('mitad de trimestre ⇒ corte = primer día del trimestre', () => {
    expect(computePurgeCutoff(new Date('2027-05-20T15:00:00.000Z'))?.date).toBe('2027-04-01');
  });

  it('2027-01-01 al mediodía: el día en preparación (2026-12-31) acota el corte', () => {
    expect(computePurgeCutoff(new Date('2027-01-01T15:00:00.000Z'))?.date).toBe('2026-12-31');
  });

  it.each([
    '2027-01-01T15:00:00.000Z',
    '2027-04-01T12:00:00.000Z',
    '2027-04-02T00:30:00.000Z',
    '2027-07-01T23:59:00.000Z',
    '2027-10-01T02:59:00.000Z',
  ])('nunca alcanza el día en preparación (%s)', now => {
    const instant = new Date(now);
    const cutoff = computePurgeCutoff(instant);
    const preparing = resolveFinalizeDate(instant).date;
    expect(cutoff).not.toBeNull();
    expect((cutoff as PurgeCutoff).date <= preparing).toBe(true);
  });
});

describe('runPurge (H6)', () => {
  const CUTOFF: PurgeCutoff = { date: '2027-04-01', start: new Date('2027-04-01T03:00:00.000Z') };

  it('2500 filas en una tabla ⇒ 3 lotes de ≤ 1000, sólo las 4 tablas y nunca kpi_publication', async () => {
    const remaining: Record<string, number> = { kpi_http_event: 2500 };
    const purgeBatch = jest.fn(async (table: string, _env: string, _cutoff: PurgeCutoff, limit: number) => {
      const deleted = Math.min(limit, remaining[table] ?? 0);
      remaining[table] = (remaining[table] ?? 0) - deleted;
      return deleted;
    });

    const result = await runPurge({ purgeBatch }, 'prod', CUTOFF);

    expect(result.deleted).toEqual({
      kpi_http_event: 2500,
      kpi_dependency_event: 0,
      kpi_health_sample: 0,
      kpi_snapshot: 0,
    });
    expect(result.cutoff).toBe('2027-04-01');
    for (const [table, env, cutoff, limit] of purgeBatch.mock.calls) {
      expect(PURGE_TABLES).toContain(table);
      expect(env).toBe('prod');
      expect(cutoff).toEqual(CUTOFF);
      expect(limit).toBe(1000);
    }
    const httpCalls = purgeBatch.mock.calls.filter(([table]) => table === 'kpi_http_event');
    expect(httpCalls.length).toBeGreaterThanOrEqual(3);
    expect(httpCalls.length).toBeLessThanOrEqual(4);
    expect(new Set(purgeBatch.mock.calls.map(([table]) => table))).toEqual(new Set(PURGE_TABLES));
  });

  it('tope de 100 lotes por corrida aunque queden filas', async () => {
    const purgeBatch = jest.fn(async (_t: string, _e: string, _c: PurgeCutoff, limit: number) => limit);

    const result = await runPurge({ purgeBatch }, 'prod', CUTOFF);

    expect(purgeBatch).toHaveBeenCalledTimes(100);
    expect(result.batches).toBe(100);
  });

  it('un fallo de lote se propaga (el CLI lo convierte en exit 1)', async () => {
    const purgeBatch = jest.fn(async () => {
      throw new Error('db down');
    });
    await expect(runPurge({ purgeBatch }, 'prod', CUTOFF)).rejects.toThrow();
  });
});
