// Sin parámetros de arranque (el pooler PgBouncer de Neon puede rechazarlos): el statement_timeout va como SET LOCAL.
import { Logger } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import type { PoolConfig } from 'pg';
import { PrismaClient } from '../../../generated/prisma/client';

export const KPI_POOL_MAX = 2;
export const KPI_CLIENT_TIMEOUT_MS = 150;
// Abrir una conexión en frío tarda más que una consulta; el negocio no la espera (lo protege la espera acotada).
export const KPI_CONNECT_TIMEOUT_MS = 1500;

export interface KpiPrismaHandle {
  prisma: PrismaClient;
  pool: Pool;
}

export type KpiPoolOverrides = Omit<
  PoolConfig,
  'connectionString' | 'max' | 'statement_timeout' | 'query_timeout' | 'connectionTimeoutMillis'
>;

const logger = new Logger('KpiPrisma');

export function createKpiPrismaClient(connectionString: string, overrides: KpiPoolOverrides = {}): KpiPrismaHandle {
  const pool = new Pool({
    ...overrides,
    connectionString,
    max: KPI_POOL_MAX,
    query_timeout: KPI_CLIENT_TIMEOUT_MS,
    connectionTimeoutMillis: KPI_CONNECT_TIMEOUT_MS,
  });
  // Sin este listener, un error de un cliente inactivo tiraría el proceso.
  pool.on('error', (error: Error & { code?: unknown }) => {
    logger.warn(`KPI_POOL_ERROR code=${typeof error.code === 'string' ? error.code : 'none'}`);
  });
  // errorFormat 'minimal': evita armar el code frame del call-site, que bloquea el event loop al fallar.
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool), errorFormat: 'minimal' });
  return { prisma, pool };
}

export async function disposeKpiPrismaClient(handle: KpiPrismaHandle): Promise<void> {
  await handle.prisma.$disconnect().catch(() => undefined);
  await handle.pool.end().catch(() => undefined);
}
