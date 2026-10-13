// NUT-85 — Store de reporting (snapshots, muestras de salud, purga) con su PROPIO pool (design D14, D16, D22).
// No reutiliza el pool del escritor de eventos (statement_timeout de 100 ms, pensado para escrituras en caliente):
// los agregados y la purga necesitan más margen. Respeta los parámetros de la URL (p. ej. options/search_path).
// Sólo límites del lado del cliente (sin statement_timeout como parámetro de arranque, por compatibilidad con poolers).
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../../generated/prisma/client';
import type { PurgePort } from '../cli/purge-policy';
import { TelemetryRepository } from '../repo/telemetry.repository';
import type { HealthSampleInput } from '../repo/telemetry.repository';
import { PrismaSnapshotStore } from '../snapshots/telemetry-snapshot.service';
import type { SnapshotStore } from '../snapshots/telemetry-snapshot.service';

export const REPORTING_POOL_MAX = 3;
export const REPORTING_CONNECT_TIMEOUT_MS = 5000;
export const REPORTING_QUERY_TIMEOUT_MS = 30_000;

export interface TelemetryCliStore extends SnapshotStore, PurgePort {
  /** false = bucket ya registrado (ON CONFLICT DO NOTHING): la muestra original no cambia. */
  insertHealthSample(sample: HealthSampleInput): Promise<boolean>;
  close(): Promise<void>;
}

/** No conecta al construirse: la primera conexión ocurre en la primera consulta. */
export function createReportingStore(databaseUrl: string): TelemetryCliStore {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: REPORTING_POOL_MAX,
    connectionTimeoutMillis: REPORTING_CONNECT_TIMEOUT_MS,
    query_timeout: REPORTING_QUERY_TIMEOUT_MS,
    idleTimeoutMillis: 1000,
  });
  // Un cliente inactivo que pierde la conexión no debe tirar el proceso.
  pool.on('error', () => undefined);
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool), errorFormat: 'minimal' });
  const snapshots = new PrismaSnapshotStore(prisma);
  const repository = new TelemetryRepository(prisma);
  return {
    transaction: (isolation, fn) => snapshots.transaction(isolation, fn),
    insertHealthSample: sample => repository.insertHealthSample(sample),
    purgeBatch: (table, environment, cutoff, limit) => repository.purgeBatch(table, environment, cutoff, limit),
    close: async () => {
      await prisma.$disconnect().catch(() => undefined);
      await pool.end().catch(() => undefined);
    },
  };
}
