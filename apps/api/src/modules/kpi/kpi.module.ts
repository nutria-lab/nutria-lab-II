// @Global para que Gemini y Unsplash reciban DEPENDENCY_INSTRUMENTATION sin importar KpiModule (inyección @Optional).
import { Global, Inject, Logger, Module, RequestMethod } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule, OnApplicationShutdown } from '@nestjs/common';
import { resolveKpiConfig } from './config/kpi-config';
import type { KpiConfig } from './config/kpi-config';
import { KpiDependencyInstrumentation } from './dependencies/dependency-instrumentation';
import { createKpiPrismaClient, disposeKpiPrismaClient } from './db/kpi-prisma';
import { createReportingStore } from './db/kpi-reporting-store';
import { KPI_DRAIN_TIMEOUT_MS, NoopKpiEventWriter, PrismaKpiEventWriter } from './events/kpi-event-writer';
import type { KpiEventWriter } from './events/kpi-event-writer';
import { PgDbHealthProbe } from './health/db-health-probe';
import { HealthController } from './health/health.controller';
import { KpiHttpMiddleware } from './http/kpi-http.middleware';
import {
  DB_HEALTH_PROBE,
  DEPENDENCY_INSTRUMENTATION,
  KPI_CONFIG,
  KPI_EVENT_WRITER,
  KPI_REPORTING_STORE,
} from './kpi.tokens';
import { TelemetrySnapshotService } from './snapshots/telemetry-snapshot.service';
import type { SnapshotStore } from './snapshots/telemetry-snapshot.service';
import { TelemetryLogger } from './telemetry-logger';

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
  const handle = createKpiPrismaClient(databaseUrl);
  return new PrismaKpiEventWriter(handle.prisma, () => disposeKpiPrismaClient(handle));
}

type ReportingStore = SnapshotStore & { close(): Promise<void> };

function reportingStoreFactory(): ReportingStore {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    // Sin DB: collect traduce la falla a SOURCE_UNAVAILABLE.
    return {
      transaction: () => Promise.reject(new Error('KPI_DATABASE_URL_MISSING')),
      close: async () => undefined,
    };
  }
  return createReportingStore(databaseUrl);
}

@Global()
@Module({
  controllers: [HealthController],
  providers: [
    { provide: KPI_CONFIG, useFactory: kpiConfigFactory },
    { provide: KPI_EVENT_WRITER, useFactory: kpiEventWriterFactory, inject: [KPI_CONFIG] },
    {
      provide: DEPENDENCY_INSTRUMENTATION,
      useFactory: (config: KpiConfig, writer: KpiEventWriter) => new KpiDependencyInstrumentation(config, writer),
      inject: [KPI_CONFIG, KPI_EVENT_WRITER],
    },
    { provide: DB_HEALTH_PROBE, useFactory: () => new PgDbHealthProbe(process.env.DATABASE_URL) },
    KpiHttpMiddleware,
    { provide: KPI_REPORTING_STORE, useFactory: reportingStoreFactory },
    {
      provide: TelemetryLogger,
      useFactory: (store: ReportingStore, config: KpiConfig) =>
        new TelemetryLogger(new TelemetrySnapshotService(store, () => new Date()), config),
      inject: [KPI_REPORTING_STORE, KPI_CONFIG],
    },
  ],
  exports: [KPI_CONFIG, KPI_EVENT_WRITER, DEPENDENCY_INSTRUMENTATION, TelemetryLogger],
})
export class KpiModule implements NestModule, OnApplicationShutdown {
  constructor(
    @Inject(KPI_EVENT_WRITER) private readonly writer: KpiEventWriter,
    @Inject(KPI_REPORTING_STORE) private readonly reportingStore: ReportingStore,
  ) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(KpiHttpMiddleware).forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.writer.drain(KPI_DRAIN_TIMEOUT_MS);
    await this.writer.dispose?.();
    await this.reportingStore.close().catch(() => undefined);
  }
}
