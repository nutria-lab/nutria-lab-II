import { Module } from '@nestjs/common';

import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';

import { CompositeKpiLogger } from './composite-kpi.logger';
import { DataKpiLogger } from './data-kpi.logger';
import { KpiModule } from './kpi.module';
import { PrismaPublicationRepository } from './prisma-publication.repository';
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
  ],
  exports: [CompositeKpiLogger, PrismaPublicationRepository],
})
export class KpiPublisherModule {}
