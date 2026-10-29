import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth/auth.module';
import { AdherenceController } from './adherence.controller';
import { ADHERENCE_CLOCK, AdherenceRepository } from './adherence.repository';
import { AdherenceService } from './adherence.service';

@Module({
  imports: [AuthModule],
  controllers: [AdherenceController],
  providers: [
    AdherenceService,
    AdherenceRepository,
    { provide: ADHERENCE_CLOCK, useValue: () => new Date() },
  ],
})
export class AdherenceModule {}
