// NUT-85 — Módulo KPI (design D1–D4, D10). Global: registra el middleware HTTP para todas las rutas
// (incluidas las no matcheadas) y GET /health; drena el escritor (acotado) al cerrar la app.
import { Global, Inject, Logger, Module, RequestMethod } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule, OnApplicationShutdown } from '@nestjs/common';
import { resolveKpiConfig } from './config/kpi-config';
import type { KpiConfig } from './config/kpi-config';
import { createKpiPrismaClient, disposeKpiPrismaClient } from './db/kpi-prisma';
import { KPI_DRAIN_TIMEOUT_MS, NoopKpiEventWriter, PrismaKpiEventWriter } from './events/kpi-event-writer';
import type { KpiEventWriter } from './events/kpi-event-writer';
import { PgDbHealthProbe } from './health/db-health-probe';
import { HealthController } from './health/health.controller';
import { KpiHttpMiddleware } from './http/kpi-http.middleware';
import { DB_HEALTH_PROBE, KPI_CONFIG, KPI_EVENT_WRITER } from './kpi.tokens';

const logger = new Logger('KpiModule');

function kpiConfigFactory(): KpiConfig {
  const config = resolveKpiConfig(process.env);
  // Un único log técnico al arrancar; nunca el valor recibido.
  if (config.disabledReason !== null) logger.error(config.disabledReason);
  return config;
}

function kpiEventWriterFactory(config: KpiConfig): KpiEventWriter {
  if (!config.enabled) return new NoopKpiEventWriter();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.error('KPI_DATABASE_URL_MISSING');
    return new NoopKpiEventWriter();
  }
  // El pool no conecta hasta la primera escritura.
  const handle = createKpiPrismaClient(databaseUrl);
  return new PrismaKpiEventWriter(handle.prisma, () => disposeKpiPrismaClient(handle));
}

@Global()
@Module({
  controllers: [HealthController],
  providers: [
    { provide: KPI_CONFIG, useFactory: kpiConfigFactory },
    { provide: KPI_EVENT_WRITER, useFactory: kpiEventWriterFactory, inject: [KPI_CONFIG] },
    { provide: DB_HEALTH_PROBE, useFactory: () => new PgDbHealthProbe(process.env.DATABASE_URL) },
    KpiHttpMiddleware,
  ],
  exports: [KPI_CONFIG, KPI_EVENT_WRITER],
})
export class KpiModule implements NestModule, OnApplicationShutdown {
  constructor(@Inject(KPI_EVENT_WRITER) private readonly writer: KpiEventWriter) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(KpiHttpMiddleware).forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.writer.drain(KPI_DRAIN_TIMEOUT_MS);
    await this.writer.dispose?.();
  }
}
