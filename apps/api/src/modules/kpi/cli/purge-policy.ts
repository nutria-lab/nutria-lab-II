import type { KpiEnvironment } from '../kpi-contract';
import { localDateOf, resolveFinalizeDate, windowForDate } from '../window/kpi-window';

export const PURGE_START_DATE = '2027-01-01';
export const PURGE_BATCH_SIZE = 1000;
// Tope total por corrida sumando todas las tablas; el resto queda para la siguiente.
export const PURGE_MAX_BATCHES = 100;
export const PURGE_TABLES = ['kpi_http_event', 'kpi_dependency_event', 'kpi_health_sample'] as const;

export type PurgeTable = (typeof PURGE_TABLES)[number];

export interface PurgeCutoff {
  date: string;
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

// Aritmética en UTC al mediodía para no depender del DST.
function previousDate(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00.000Z`) - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Nunca alcanza el día anterior al día en preparación: se conserva el último éxito previo a su start.
export function computePurgeCutoff(now: Date): PurgeCutoff | null {
  const today = localDateOf(now);
  if (today < PURGE_START_DATE) return null;
  const quarter = quarterStart(today);
  const dayBeforePreparing = previousDate(resolveFinalizeDate(now).date);
  const date = quarter < dayBeforePreparing ? quarter : dayBeforePreparing;
  return { date, start: windowForDate(date).start };
}

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
