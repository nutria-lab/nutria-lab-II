// Helper de tests KPI (NUT-85, D32). Excluido del build por el sufijo *.fixture.ts.
// Cliente Prisma para el escritor KPI sobre la DB de prueba con un query_timeout de cliente AMPLIO: el
// query_timeout de 150 ms de producción es un temporizador del event loop que, bajo carga de la suite, vence
// aunque Postgres ya respondió. Los tests de integración que fijan un SQLSTATE real (23505, 57014) usan este
// cliente para que el resultado dependa de Postgres y no de la carga. El valor de producción (150 ms) queda
// fijado en el unit test de createKpiPrismaClient. Mismo search_path que el schema descartable de la suite.
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../../generated/prisma/client';
import type { KpiPrismaHandle } from '../db/kpi-prisma';
import type { DisposableSchema } from './kpi-test-db.fixture';

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
