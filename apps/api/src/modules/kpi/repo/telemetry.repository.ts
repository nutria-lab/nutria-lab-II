// NUT-85 — Agregados de telemetría en SQL (design D12, §6.9). Ventana [start, end), filtrada por ambiente.
// Consultas parametrizadas con $queryRaw (tagged template): nunca se concatena SQL.
// Tablas sin calificar por schema (resuelven por search_path).
// Snapshots (D13, D14), muestras de salud (§6.4) y purga por lotes (D16): también SQL parametrizado.
import { randomUUID } from 'crypto';
import type { PrismaClient } from '../../../generated/prisma/client';
import type { KpiEnvironment, KpiId, KpiResult } from '../kpi-contract';
import { INSTRUMENTATION_DISABLED } from '../calc/telemetry-formulas';
import type { HealthOutcome, TelemetryAggregates, TelemetryWindow } from '../calc/telemetry-formulas';
import type { PurgeCutoff, PurgeTable } from '../cli/purge-policy';
import type { SnapshotCut, SnapshotTx } from '../snapshots/telemetry-snapshot.service';

/** Cliente Prisma o cliente de transacción: sólo SQL crudo parametrizado (tagged template). */
export type KpiQueryClient = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;

export interface HealthSampleInput {
  environment: KpiEnvironment;
  scheduledFor: Date;
  measuredAt: Date;
  apiOk: boolean | null;
  databaseOk: boolean | null;
  outcome: HealthOutcome;
  reason: string | null;
}

interface FinalRow {
  kpi_id: KpiId;
  value: number | null;
  quality: KpiResult['quality'];
  reason: string | null;
  sample_count: string;
  measured_at: Date;
}

interface HttpRow {
  success: number;
  client_error: number;
  server_error: number;
  network_error: number;
  timeout: number;
  other: number;
  p95_duration_ms: number | null;
}

interface CountRow {
  count: number;
}

interface LastSuccessRow {
  last_success: Date | null;
}

interface DependencyRow {
  success: number;
  error: number;
  timeout: number;
}

interface LatestHealthRow {
  outcome: HealthOutcome;
  measured_at: Date;
  scheduled_for: Date;
}

interface HealthCountRow {
  healthy: number;
  unhealthy: number;
  unknown: number;
}

export class TelemetryRepository implements SnapshotTx {
  constructor(private readonly prisma: KpiQueryClient) {}

  async loadAggregates(environment: KpiEnvironment, window: TelemetryWindow): Promise<TelemetryAggregates> {
    const start = window.start.toISOString();
    const end = window.end.toISOString();

    const [http] = await this.prisma.$queryRaw<HttpRow[]>`
      SELECT
        count(*) FILTER (WHERE outcome = 'success')::int        AS success,
        count(*) FILTER (WHERE outcome = 'client_error')::int   AS client_error,
        count(*) FILTER (WHERE outcome = 'server_error')::int   AS server_error,
        count(*) FILTER (WHERE outcome = 'network_error')::int  AS network_error,
        count(*) FILTER (WHERE outcome = 'timeout')::int        AS timeout,
        count(*) FILTER (WHERE outcome = 'other')::int          AS other,
        percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms
      FROM kpi_http_event
      WHERE environment = ${environment}
        AND outcome <> 'pending'
        AND finished_at >= ${start}::timestamptz
        AND finished_at < ${end}::timestamptz`;

    const [pending] = await this.prisma.$queryRaw<CountRow[]>`
      SELECT count(*)::int AS count
      FROM kpi_http_event
      WHERE environment = ${environment}
        AND outcome = 'pending'
        AND started_at >= ${start}::timestamptz
        AND started_at < ${end}::timestamptz`;

    const [lastSuccess] = await this.prisma.$queryRaw<LastSuccessRow[]>`
      SELECT max(finished_at) AS last_success
      FROM kpi_http_event
      WHERE environment = ${environment}
        AND outcome = 'success'
        AND finished_at < ${end}::timestamptz`;

    const [dependency] = await this.prisma.$queryRaw<DependencyRow[]>`
      SELECT
        count(*) FILTER (WHERE outcome = 'success')::int AS success,
        count(*) FILTER (WHERE outcome = 'error')::int   AS error,
        count(*) FILTER (WHERE outcome = 'timeout')::int AS timeout
      FROM kpi_dependency_event
      WHERE environment = ${environment}
        AND outcome <> 'pending'
        AND finished_at >= ${start}::timestamptz
        AND finished_at < ${end}::timestamptz`;

    const [latestHealth] = await this.prisma.$queryRaw<LatestHealthRow[]>`
      SELECT outcome, measured_at, scheduled_for
      FROM kpi_health_sample
      WHERE environment = ${environment}
        AND measured_at >= ${start}::timestamptz
        AND measured_at < ${end}::timestamptz
      ORDER BY measured_at DESC, scheduled_for DESC
      LIMIT 1`;

    const [health] = await this.prisma.$queryRaw<HealthCountRow[]>`
      SELECT
        count(*) FILTER (WHERE outcome = 'healthy')::int   AS healthy,
        count(*) FILTER (WHERE outcome = 'unhealthy')::int AS unhealthy,
        count(*) FILTER (WHERE outcome = 'unknown')::int   AS unknown
      FROM kpi_health_sample
      WHERE environment = ${environment}
        AND measured_at >= ${start}::timestamptz
        AND measured_at < ${end}::timestamptz`;

    const [disabled] = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM kpi_health_sample
      WHERE environment = ${environment}
        AND reason = ${INSTRUMENTATION_DISABLED}
        AND measured_at >= ${start}::timestamptz
        AND measured_at < ${end}::timestamptz`;

    return {
      http: {
        success: http.success,
        clientError: http.client_error,
        serverError: http.server_error,
        networkError: http.network_error,
        timeout: http.timeout,
        other: http.other,
        p95DurationMs: http.p95_duration_ms === null ? null : Number(http.p95_duration_ms),
        pendingIncomplete: pending.count,
      },
      lastSuccessFinishedAt: lastSuccess.last_success === null ? null : new Date(lastSuccess.last_success),
      dependency: { success: dependency.success, error: dependency.error, timeout: dependency.timeout },
      latestHealth: latestHealth
        ? {
            outcome: latestHealth.outcome,
            measuredAt: new Date(latestHealth.measured_at),
            scheduledFor: new Date(latestHealth.scheduled_for),
          }
        : null,
      health: { healthy: health.healthy, unhealthy: health.unhealthy, unknown: health.unknown },
      instrumentationDisabledSamples: disabled.count,
    };
  }

  /** Finales del corte (environment, report_date, window_end), ordenados por kpi_id. */
  async readFinals(cut: SnapshotCut): Promise<KpiResult[]> {
    const rows = await this.prisma.$queryRaw<FinalRow[]>`
      SELECT kpi_id, value, quality, reason, sample_count::text AS sample_count, measured_at
      FROM kpi_snapshot
      WHERE environment = ${cut.environment}
        AND report_date = ${cut.date}::date
        AND window_end = ${cut.end.toISOString()}::timestamptz
        AND snapshot_kind = 'final'
      ORDER BY kpi_id`;
    return rows.map(row => ({
      kpi_id: row.kpi_id,
      value: row.value === null ? null : Number(row.value),
      quality: row.quality,
      reason: row.reason,
      sample_count: Number(row.sample_count),
      measured_at: new Date(row.measured_at).toISOString(),
    }));
  }

  /** INSERT plano de los finales (sin ON CONFLICT): un conflicto debe fallar la transacción entera (D14). */
  async insertFinals(cut: SnapshotCut, results: readonly KpiResult[]): Promise<void> {
    for (const r of results) {
      await this.prisma.$executeRaw`
        INSERT INTO kpi_snapshot (id, environment, report_date, window_start, window_end, snapshot_kind,
                                  kpi_id, value, quality, reason, sample_count, measured_at)
        VALUES (${randomUUID()}::uuid, ${cut.environment}, ${cut.date}::date, ${cut.start.toISOString()}::timestamptz,
                ${cut.end.toISOString()}::timestamptz, 'final', ${r.kpi_id}, ${r.value}::double precision,
                ${r.quality}, ${r.reason}, ${r.sample_count}::bigint, ${r.measured_at}::timestamptz)`;
    }
  }

  /** Upsert de previews por corte (D13); el llamador lo ejecuta dentro de una única transacción. */
  async upsertPreviews(cut: SnapshotCut, results: readonly KpiResult[]): Promise<void> {
    for (const r of results) {
      await this.prisma.$executeRaw`
        INSERT INTO kpi_snapshot (id, environment, report_date, window_start, window_end, snapshot_kind,
                                  kpi_id, value, quality, reason, sample_count, measured_at)
        VALUES (${randomUUID()}::uuid, ${cut.environment}, ${cut.date}::date, ${cut.start.toISOString()}::timestamptz,
                ${cut.end.toISOString()}::timestamptz, 'preview', ${r.kpi_id}, ${r.value}::double precision,
                ${r.quality}, ${r.reason}, ${r.sample_count}::bigint, ${r.measured_at}::timestamptz)
        ON CONFLICT (environment, report_date, window_end, snapshot_kind, kpi_id) DO UPDATE
           SET window_start = EXCLUDED.window_start,
               value = EXCLUDED.value,
               quality = EXCLUDED.quality,
               reason = EXCLUDED.reason,
               sample_count = EXCLUDED.sample_count,
               measured_at = EXCLUDED.measured_at`;
    }
  }

  /** Inserta la muestra del bucket; false si el bucket ya estaba registrado (la original no cambia). */
  async insertHealthSample(sample: HealthSampleInput): Promise<boolean> {
    const inserted = await this.prisma.$executeRaw`
      INSERT INTO kpi_health_sample (id, environment, scheduled_for, measured_at, api_ok, database_ok, outcome, reason)
      VALUES (${randomUUID()}::uuid, ${sample.environment}, ${sample.scheduledFor.toISOString()}::timestamptz,
              ${sample.measuredAt.toISOString()}::timestamptz, ${sample.apiOk}::boolean, ${sample.databaseOk}::boolean,
              ${sample.outcome}, ${sample.reason})
      ON CONFLICT (environment, scheduled_for) DO NOTHING`;
    return inserted === 1;
  }

  /**
   * Borra un lote (≤ limit) del ambiente, anterior al corte. El nombre de tabla nunca se interpola:
   * cada tabla de la lista blanca tiene su propia sentencia fija.
   */
  async purgeBatch(table: PurgeTable, environment: KpiEnvironment, cutoff: PurgeCutoff, limit: number): Promise<number> {
    const start = cutoff.start.toISOString();
    switch (table) {
      case 'kpi_http_event':
        return this.prisma.$executeRaw`
          DELETE FROM kpi_http_event WHERE id IN (
            SELECT id FROM kpi_http_event
            WHERE environment = ${environment} AND started_at < ${start}::timestamptz
            LIMIT ${limit}::int)`;
      case 'kpi_dependency_event':
        return this.prisma.$executeRaw`
          DELETE FROM kpi_dependency_event WHERE id IN (
            SELECT id FROM kpi_dependency_event
            WHERE environment = ${environment} AND started_at < ${start}::timestamptz
            LIMIT ${limit}::int)`;
      case 'kpi_health_sample':
        return this.prisma.$executeRaw`
          DELETE FROM kpi_health_sample WHERE id IN (
            SELECT id FROM kpi_health_sample
            WHERE environment = ${environment} AND scheduled_for < ${start}::timestamptz
            LIMIT ${limit}::int)`;
      case 'kpi_snapshot':
        return this.prisma.$executeRaw`
          DELETE FROM kpi_snapshot WHERE id IN (
            SELECT id FROM kpi_snapshot
            WHERE environment = ${environment} AND report_date < ${cutoff.date}::date
            LIMIT ${limit}::int)`;
      default: {
        const unexpected: never = table;
        throw new Error(`KPI_PURGE_TABLE_NOT_ALLOWED ${String(unexpected)}`);
      }
    }
  }
}
