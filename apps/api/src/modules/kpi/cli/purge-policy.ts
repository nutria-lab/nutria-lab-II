// NUT-85 — Purga trimestral conservadora (design D16). Funciones puras + bucle por lotes sobre un puerto.
// Nunca toca kpi_publication ni tablas de negocio: sólo la lista blanca PURGE_TABLES.
import type { KpiEnvironment } from '../kpi-contract';
import { localDateOf, resolveFinalizeDate, windowForDate } from '../window/kpi-window';

export const PURGE_START_DATE = '2027-01-01';
export const PURGE_BATCH_SIZE = 1000;
/** Tope de lotes por corrida, sumando todas las tablas (el resto queda para la siguiente). */
export const PURGE_MAX_BATCHES = 100;
export const PURGE_TABLES = ['kpi_http_event', 'kpi_dependency_event', 'kpi_health_sample', 'kpi_snapshot'] as const;

export type PurgeTable = (typeof PURGE_TABLES)[number];

export interface PurgeCutoff {
  /** YYYY-MM-DD local: se borra lo anterior a este día. */
  date: string;
  /** 00:00 local de `date`, en UTC. */
  start: Date;
}

export interface PurgePort {
  purgeBatch(table: PurgeTable, environment: KpiEnvironment, cutoff: PurgeCutoff, limit: number): Promise<number>;
}

export interface PurgeResult {
  cutoff: string;
  deleted: Record<PurgeTable, number>;
  batches: number;
}

function quarterStart(localDate: string): string {
  const [year, month] = localDate.split('-').map(Number);
  const firstMonth = Math.floor((month - 1) / 3) * 3 + 1;
  return `${year}-${String(firstMonth).padStart(2, '0')}-01`;
}

/** YYYY-MM-DD del día calendario anterior (aritmética en UTC al mediodía, sin DST). */
function previousDate(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00.000Z`) - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * null antes del 2027-01-01 local. Si no, el más temprano entre el primer día del trimestre local actual
 * y el día ANTERIOR al día en preparación (D del último corte de las 21:00 ya ocurrido): así nunca se borra
 * el día en preparación ni el último éxito previo a su start (D29).
 */
export function computePurgeCutoff(now: Date): PurgeCutoff | null {
  const today = localDateOf(now);
  if (today < PURGE_START_DATE) return null;
  const quarter = quarterStart(today);
  const dayBeforePreparing = previousDate(resolveFinalizeDate(now).date);
  const date = quarter < dayBeforePreparing ? quarter : dayBeforePreparing;
  return { date, start: windowForDate(date).start };
}

/** Lotes de PURGE_BATCH_SIZE por tabla hasta un lote incompleto; tope total PURGE_MAX_BATCHES. Un fallo se propaga. */
export async function runPurge(port: PurgePort, environment: KpiEnvironment, cutoff: PurgeCutoff): Promise<PurgeResult> {
  const deleted = Object.fromEntries(PURGE_TABLES.map(table => [table, 0])) as Record<PurgeTable, number>;
  let batches = 0;
  for (const table of PURGE_TABLES) {
    while (batches < PURGE_MAX_BATCHES) {
      const count = await port.purgeBatch(table, environment, cutoff, PURGE_BATCH_SIZE);
      batches += 1;
      deleted[table] += count;
      if (count < PURGE_BATCH_SIZE) break;
    }
  }
  return { cutoff: cutoff.date, deleted, batches };
}
