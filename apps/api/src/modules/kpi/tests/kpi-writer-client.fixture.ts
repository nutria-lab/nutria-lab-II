import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../../generated/prisma/client';
import type { KpiPrismaHandle } from '../db/kpi-prisma';
import type { DisposableSchema } from './kpi-test-db.fixture';

// Explicit client override for tests exercising PostgreSQL SQLSTATEs or shorter client deadlines.
export const TEST_WRITER_QUERY_TIMEOUT_MS = 5000;

export function createWideTimeoutKpiPrismaClient(
  db: DisposableSchema,
  queryTimeoutMs: number = TEST_WRITER_QUERY_TIMEOUT_MS,
): KpiPrismaHandle {
  const pool = new Pool(
    db.poolConfig({ max: 2, query_timeout: queryTimeoutMs, connectionTimeoutMillis: queryTimeoutMs }),
  );
  pool.on('error', () => undefined);
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool), errorFormat: 'minimal' });
  return { prisma, pool };
}
