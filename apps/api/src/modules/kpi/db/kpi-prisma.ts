// NUT-85 — Cliente Prisma propio del escritor KPI (design D3): pool dedicado y chico, separado del de negocio.
// Sin parámetros de arranque (PgBouncer de Neon): el statement_timeout va como SET LOCAL en cada escritura (D27).
// No conecta al construirse.
import { Logger } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import type { PoolConfig } from 'pg';
import { PrismaClient } from '../../../generated/prisma/client';

export const KPI_POOL_MAX = 2;
export const KPI_CLIENT_TIMEOUT_MS = 150;
// Conexión separada de la consulta (D32): abrir una conexión en frío suele tardar más de 150 ms. El negocio no
// espera esto: lo protege la espera acotada del middleware; la escritura termina en vuelo.
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
  // Un cliente inactivo que pierde la conexión no debe tirar el proceso; sólo código técnico.
  pool.on('error', (error: Error & { code?: unknown }) => {
    logger.warn(`KPI_POOL_ERROR code=${typeof error.code === 'string' ? error.code : 'none'}`);
  });
  // errorFormat 'minimal': sin code frame del call-site (lectura sincrónica de fuentes/stack al fallar), que
  // bloquearía el event loop más allá de la espera acotada; además el escritor nunca usa el mensaje del error.
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool), errorFormat: 'minimal' });
  return { prisma, pool };
}

/** Libera el cliente y el pool sin propagar errores. */
export async function disposeKpiPrismaClient(handle: KpiPrismaHandle): Promise<void> {
  await handle.prisma.$disconnect().catch(() => undefined);
  await handle.pool.end().catch(() => undefined);
}
