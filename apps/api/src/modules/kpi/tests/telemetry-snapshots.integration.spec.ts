import { randomUUID } from 'crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { TELEMETRY_KPI_IDS } from '../calc/telemetry-formulas';
import type { CollectionContext, KpiLogger, KpiResult } from '../kpi-contract';
import { PrismaSnapshotStore, TelemetrySnapshotService } from '../snapshots/telemetry-snapshot.service';
import type { SnapshotCut } from '../snapshots/telemetry-snapshot.service';
import { TelemetryLogger } from '../telemetry-logger';
import { windowForDate } from '../window/kpi-window';
import { DisposableSchema, applyMigrations, createDisposableSchema, describeIfKpiDb } from './kpi-test-db.fixture';

jest.setTimeout(120_000);

const DAY = '2026-10-11';
const CANON = windowForDate(DAY);
const FINAL_CUT: SnapshotCut = { environment: 'dev', date: DAY, start: CANON.start, end: CANON.end };
const CLOSED_PORT_URL = 'postgresql://kpi:kpi@127.0.0.1:1/kpi';

interface SnapshotRow {
  id: string;
  kpi_id: string;
  snapshot_kind: string;
  value: number | null;
  quality: string;
  sample_count: string;
  measured_at: Date;
  window_end: Date;
}

function clockAt(iso: string): () => Date {
  return () => new Date(iso);
}

describeIfKpiDb('telemetry-snapshots (integración Postgres)', () => {
  let db: DisposableSchema;
  const clients: PrismaClient[] = [];

  function newPrisma(): PrismaClient {
    const prisma = new PrismaClient({ adapter: new PrismaPg(db.createPool({ max: 3 })) });
    clients.push(prisma);
    return prisma;
  }

  function newService(clockIso: string, afterFinalsRead?: (attempt: number) => Promise<void>) {
    return new TelemetrySnapshotService(
      new PrismaSnapshotStore(newPrisma()),
      clockAt(clockIso),
      afterFinalsRead ? { afterFinalsRead } : undefined,
    );
  }

  beforeAll(async () => {
    db = await createDisposableSchema();
    await applyMigrations(db.client);
  });

  afterAll(async () => {
    await Promise.all(clients.map(c => c.$disconnect().catch(() => undefined)));
    await db?.drop();
  });

  beforeEach(async () => {
    await db.client.query('TRUNCATE kpi_http_event, kpi_dependency_event, kpi_health_sample, kpi_snapshot');
  });

  async function insertSuccess(finishedAtIso: string, env = 'dev'): Promise<void> {
    const finished = Date.parse(finishedAtIso);
    await db.client.query(
      `INSERT INTO kpi_http_event (id, environment, operation, started_at, finished_at, duration_ms, http_status, outcome)
       VALUES ($1, $2, 'GET /x', $3, $4, 10, 200, 'success')`,
      [randomUUID(), env, new Date(finished - 10).toISOString(), finishedAtIso],
    );
  }

  async function snapshotRows(kind: 'preview' | 'final', date = DAY): Promise<SnapshotRow[]> {
    const { rows } = await db.client.query<SnapshotRow>(
      `SELECT id, kpi_id, snapshot_kind, value, quality, sample_count::text AS sample_count, measured_at, window_end
       FROM kpi_snapshot WHERE environment = 'dev' AND report_date = $1 AND snapshot_kind = $2
       ORDER BY window_end, kpi_id`,
      [date, kind],
    );
    return rows;
  }

  function valueOf(results: readonly KpiResult[], kpiId: string): number | null {
    return results.find(r => r.kpi_id === kpiId)?.value ?? null;
  }

  describe('preview (G1)', () => {
    const cutAt = (endIso: string): SnapshotCut => ({ ...FINAL_CUT, end: new Date(endIso) });

    it('escribe los 8 previews del corte', async () => {
      await insertSuccess('2026-10-11T12:00:00.000Z');
      await newService('2026-10-11T18:00:00.000Z').preview(cutAt('2026-10-11T18:00:00.000Z'));

      const rows = await snapshotRows('preview');
      expect(rows.map(r => r.kpi_id)).toEqual([...TELEMETRY_KPI_IDS]);
      expect(new Set(rows.map(r => r.window_end.toISOString()))).toEqual(new Set(['2026-10-11T18:00:00.000Z']));
    });

    it('si uno de los 8 falla no queda ninguno (una sola transacción)', async () => {
      const store = new PrismaSnapshotStore(newPrisma());
      const cut = cutAt('2026-10-11T19:00:00.000Z');
      const bad: KpiResult[] = TELEMETRY_KPI_IDS.map(kpiId => ({
        kpi_id: kpiId,
        value: kpiId === 'error_rate' ? 150 : 1, // viola kpi_snapshot_percentage_range_check
        quality: 'observed',
        reason: null,
        sample_count: 1,
        measured_at: '2026-10-11T19:00:00.000Z',
      }));

      await expect(store.transaction('ReadCommitted', tx => tx.upsertPreviews(cut, bad))).rejects.toBeDefined();

      expect(await snapshotRows('preview')).toHaveLength(0);
    });

    it('repetir el preview del mismo corte no duplica y actualiza valores; dos cortes ⇒ 16 filas', async () => {
      const cut = cutAt('2026-10-11T18:00:00.000Z');
      await insertSuccess('2026-10-11T12:00:00.000Z');
      await newService('2026-10-11T18:00:00.000Z').preview(cut);
      await insertSuccess('2026-10-11T13:00:00.000Z');
      await newService('2026-10-11T18:05:00.000Z').preview(cut);

      const sameCut = await snapshotRows('preview');
      expect(sameCut).toHaveLength(8);
      expect(sameCut.find(r => r.kpi_id === 'operations_count')?.value).toBe(2);
      expect(new Set(sameCut.map(r => r.measured_at.toISOString()))).toEqual(new Set(['2026-10-11T18:05:00.000Z']));

      await newService('2026-10-11T20:00:00.000Z').preview(cutAt('2026-10-11T20:00:00.000Z'));
      expect(await snapshotRows('preview')).toHaveLength(16);
    });
  });

  describe('finalize (G2)', () => {
    it('corre en REPEATABLE READ: un evento confirmado tras la lectura no entra en el cálculo', async () => {
      await insertSuccess('2026-10-11T12:00:00.000Z');
      const service = newService('2026-10-12T15:00:00.000Z', async attempt => {
        if (attempt === 1) await insertSuccess('2026-10-11T13:00:00.000Z'); // otra conexión, autocommit
      });

      const run = await service.finalizeCore(FINAL_CUT);

      expect(valueOf(run.results, 'operations_count')).toBe(1);
      const stored = await snapshotRows('final');
      expect(stored.find(r => r.kpi_id === 'operations_count')?.value).toBe(1);
    });

    it('con finales existentes no recalcula aunque cambien los eventos, y no los modifica', async () => {
      await insertSuccess('2026-10-11T12:00:00.000Z');
      const first = await newService('2026-10-12T15:00:00.000Z').finalizeCore(FINAL_CUT);
      const before = await snapshotRows('final');

      await insertSuccess('2026-10-11T14:00:00.000Z');
      await insertSuccess('2026-10-11T15:00:00.000Z');
      const second = await newService('2026-10-13T15:00:00.000Z').finalizeCore(FINAL_CUT);

      expect(first.reused).toBe(false);
      expect(second.reused).toBe(true);
      expect(second.results).toEqual(first.results);
      expect(await snapshotRows('final')).toEqual(before);
      expect(before).toHaveLength(8);
    });

    it('los finales conviven con previews del mismo corte sin pisarse', async () => {
      await insertSuccess('2026-10-11T12:00:00.000Z');
      await newService('2026-10-12T15:00:00.000Z').finalizeCore(FINAL_CUT);
      const finals = await snapshotRows('final');
      await insertSuccess('2026-10-11T13:00:00.000Z');
      await newService('2026-10-12T16:00:00.000Z').preview(FINAL_CUT);

      expect(await snapshotRows('final')).toEqual(finals);
      expect(await snapshotRows('preview')).toHaveLength(8);
    });
  });

  describe('concurrencia (G3)', () => {
    it('dos finalizaciones forzadas a solaparse ⇒ 8 finales iguales de una sola corrida', async () => {
      await insertSuccess('2026-10-11T12:00:00.000Z');
      let arrived = 0;
      let release!: () => void;
      const bothRead = new Promise<void>(resolve => {
        release = resolve;
      });
      const rendezvous = async (attempt: number): Promise<void> => {
        if (attempt !== 1) return;
        arrived += 1;
        if (arrived === 2) release();
        await bothRead;
      };

      const [a, b] = await Promise.all([
        newService('2026-10-12T15:00:00.001Z', rendezvous).finalizeCore(FINAL_CUT),
        newService('2026-10-12T15:00:00.002Z', rendezvous).finalizeCore(FINAL_CUT),
      ]);

      expect(arrived).toBe(2);
      expect(a.results).toEqual(b.results);
      expect([a.reused, b.reused].sort()).toEqual([false, true]);
      const rows = await snapshotRows('final');
      expect(rows.map(r => r.kpi_id)).toEqual([...TELEMETRY_KPI_IDS]);
      expect(new Set(rows.map(r => r.measured_at.toISOString())).size).toBe(1);
      expect(rows[0].measured_at.toISOString()).toBe(a.results[0].measured_at);
    });

    it('20 pares de finalize en paralelo sin barrera ⇒ siempre 8 finales de una sola corrida', async () => {
      for (let i = 1; i <= 20; i += 1) {
        const date = `2026-09-${String(i).padStart(2, '0')}`;
        const w = windowForDate(date);
        const cut: SnapshotCut = { environment: 'dev', date, start: w.start, end: w.end };
        await insertSuccess(new Date(w.start.getTime() + 3_600_000).toISOString());

        const [a, b] = await Promise.all([
          newService('2026-10-12T15:00:00.001Z').finalizeCore(cut),
          newService('2026-10-12T15:00:00.002Z').finalizeCore(cut),
        ]);

        expect(a.results).toEqual(b.results);
        const rows = await snapshotRows('final', date);
        expect(rows).toHaveLength(8);
        expect(new Set(rows.map(r => r.measured_at.toISOString())).size).toBe(1);
      }
    });
  });

  describe('collect (G4)', () => {
    const context: CollectionContext = {
      contract_version: '1',
      date: DAY,
      environment: 'dev',
      window_start: CANON.start.toISOString(),
      window_end: CANON.end.toISOString(),
      run_id: '6f1c2b2e-3f0a-4f7e-9a51-1b2c3d4e5f60',
    };

    const businessLogger: KpiLogger = {
      async collect(ctx) {
        return (['initial_plans_count', 'manual_recipes_count'] as const).map(kpiId => ({
          kpi_id: kpiId,
          value: 0,
          quality: 'observed' as const,
          reason: null,
          sample_count: 0,
          measured_at: ctx.window_end,
        }));
      },
    };

    it('Composite falso sobre la DB: 8 de Telemetry + 2 de negocio, y los 8 finales quedan guardados', async () => {
      await insertSuccess('2026-10-11T12:00:00.000Z');
      const clock = clockAt('2026-10-12T18:00:00.000Z');
      const telemetry = new TelemetryLogger(
        new TelemetrySnapshotService(new PrismaSnapshotStore(newPrisma()), clock),
        { environment: 'dev' },
        clock,
      );

      const merged = [...(await telemetry.collect(context)), ...(await businessLogger.collect(context))];
      const again = await telemetry.collect(context);

      expect(merged.map(r => r.kpi_id).sort()).toEqual(
        [...TELEMETRY_KPI_IDS, 'initial_plans_count', 'manual_recipes_count'].sort(),
      );
      expect(new Set(merged.map(r => r.kpi_id)).size).toBe(10);
      expect(again).toEqual(merged.slice(0, 8));
      const rows = await snapshotRows('final');
      expect(rows).toHaveLength(8);
      expect(rows.find(r => r.kpi_id === 'operations_count')?.value).toBe(1);
    });

    it('DB caída ⇒ 8 unavailable SOURCE_UNAVAILABLE sin guardar nada', async () => {
      const pool = new Pool({ connectionString: CLOSED_PORT_URL, connectionTimeoutMillis: 1000, max: 1 });
      pool.on('error', () => undefined);
      const downPrisma = new PrismaClient({ adapter: new PrismaPg(pool) });
      clients.push(downPrisma);
      const clock = clockAt('2026-10-12T18:00:00.000Z');
      const telemetry = new TelemetryLogger(
        new TelemetrySnapshotService(new PrismaSnapshotStore(downPrisma), clock),
        { environment: 'dev' },
        clock,
      );

      const results = await telemetry.collect(context);

      expect(results.map(r => r.kpi_id)).toEqual([...TELEMETRY_KPI_IDS]);
      expect(results.every(r => r.quality === 'unavailable' && r.reason === 'SOURCE_UNAVAILABLE')).toBe(true);
      expect(results.every(r => r.value === null && r.sample_count === 0)).toBe(true);
      expect(await snapshotRows('final')).toHaveLength(0);
    });
  });
});
