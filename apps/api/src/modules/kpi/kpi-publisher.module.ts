import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';

import { CompositeKpiLogger } from './composite-kpi.logger';
import { DataKpiLogger } from './data-kpi.logger';
import { KpiModule } from './kpi.module';
import { PrismaPublicationRepository } from './prisma-publication.repository';
import { KpiPublisher } from './kpi-publisher';
import { SupabaseKpiRemoteClient } from './supabase-kpi-remote-client';
import { FileKpiArtifactWriter } from './file-kpi-artifact-writer';
import { TelemetryLogger } from './telemetry-logger';

/** Publisher dependencies are separate from telemetry collection. */
@Module({
  imports: [PrismaModule, KpiModule],
  providers: [
    {
      provide: DataKpiLogger,
      useFactory: (prisma: PrismaService) => new DataKpiLogger(prisma),
      inject: [PrismaService],
    },
    {
      provide: CompositeKpiLogger,
      useFactory: (telemetry: TelemetryLogger, data: DataKpiLogger) => new CompositeKpiLogger(telemetry, data),
      inject: [TelemetryLogger, DataKpiLogger],
    },
    {
      provide: PrismaPublicationRepository,
      useFactory: (prisma: PrismaService) => new PrismaPublicationRepository(prisma),
      inject: [PrismaService],
    },
    {
      provide: SupabaseKpiRemoteClient,
      useFactory: () => new SupabaseKpiRemoteClient({
        baseUrl: process.env.KPI_API_BASE_URL ?? '',
        publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
        projectKey: process.env.PROJECT_KEY ?? '',
      }),
    },
    {
      provide: KpiPublisher,
      useFactory: (repository: PrismaPublicationRepository, logger: CompositeKpiLogger, remoteClient: SupabaseKpiRemoteClient) => new KpiPublisher({
        repository,
        logger,
        remoteClient,
        artifactWriter: new FileKpiArtifactWriter(process.env.KPI_ARTIFACT_DIR ?? 'kpi-artifacts'),
        clock: { now: () => new Date() },
        idGenerator: { next: randomUUID },
      }),
      inject: [PrismaPublicationRepository, CompositeKpiLogger, SupabaseKpiRemoteClient],
    },
  ],
  exports: [CompositeKpiLogger, PrismaPublicationRepository, KpiPublisher],
})
export class KpiPublisherModule {}
