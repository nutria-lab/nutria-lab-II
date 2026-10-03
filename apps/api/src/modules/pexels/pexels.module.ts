import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PexelsService } from './pexels.service';

@Module({
  imports: [ConfigModule],
  providers: [PexelsService],
  exports: [PexelsService],
})
export class PexelsModule {}
