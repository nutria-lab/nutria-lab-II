import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OpenAIService } from './openai.service';
import { KpiModule } from '../kpi/kpi.module';

@Module({ imports: [ConfigModule, KpiModule], providers: [OpenAIService], exports: [OpenAIService] })
export class OpenAIModule {}
