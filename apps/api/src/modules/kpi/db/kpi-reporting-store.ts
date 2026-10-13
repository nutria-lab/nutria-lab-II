// Pool propio: los agregados y la purga necesitan más margen que el escritor de eventos; sin parámetros de arranque (poolers).
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
  // false: el bucket ya estaba registrado y la muestra original no cambia.
  insertHealthSample(sample: HealthSampleInput): Promise<boolean>;
  close(): Promise<void>;
}

export function createReportingStore(databaseUrl: string): TelemetryCliStore {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: REPORTING_POOL_MAX,
    connectionTimeoutMillis: REPORTING_CONNECT_TIMEOUT_MS,
    query_timeout: REPORTING_QUERY_TIMEOUT_MS,
    idleTimeoutMillis: 1000,
  });
  // Sin este listener, un error de un cliente inactivo tiraría el proceso.
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
