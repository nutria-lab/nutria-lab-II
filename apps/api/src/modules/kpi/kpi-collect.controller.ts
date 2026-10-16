import { BadRequestException, Body, Controller, Inject, InternalServerErrorException, Post, UseGuards } from '@nestjs/common';
import { CompositeKpiLogger } from './composite-kpi.logger';
import type { CollectionContext } from './kpi-contract';
import { KpiInternalAuthGuard } from './kpi-internal-auth.guard';
import { KPI_CONFIG } from './kpi.tokens';
import type { KpiConfig } from './config/kpi-config';
import { KpiWindowError, parseReportDate, windowForDate } from './window/kpi-window';

@Controller('kpi')
@UseGuards(KpiInternalAuthGuard)
export class KpiCollectController {
  constructor(
    @Inject(CompositeKpiLogger) private readonly logger: CompositeKpiLogger,
    @Inject(KPI_CONFIG) private readonly config: KpiConfig,
  ) {}

  @Post('collect')
  async collect(@Body() body: unknown) {
    const context = parseContext(body);
    if (this.config.environment === null) throw new InternalServerErrorException('KPI_ENV_MISSING');
    if (context.environment !== this.config.environment) throw new BadRequestException('KPI_ENV_MISMATCH');
    return this.logger.collect(context);
  }
}

function parseContext(value: unknown): CollectionContext {
  if (typeof value !== 'object' || value === null) throw new BadRequestException('KPI_CONTEXT_INVALID');
  const body = value as Record<string, unknown>;
  let expectedWindow;
  try {
    expectedWindow = windowForDate(parseReportDate(typeof body.date === 'string' ? body.date : ''));
  } catch (error) {
    if (error instanceof KpiWindowError) throw new BadRequestException(error.code);
    throw error;
  }
  if (
    body.contract_version !== '1' ||
    !['dev', 'qa', 'prod'].includes(String(body.environment)) ||
    typeof body.window_start !== 'string' ||
    Date.parse(body.window_start) !== expectedWindow.start.getTime() ||
    typeof body.window_end !== 'string' ||
    Date.parse(body.window_end) !== expectedWindow.end.getTime() ||
    expectedWindow.end.getTime() > Date.now() ||
    typeof body.run_id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.run_id)
  ) throw new BadRequestException('KPI_CONTEXT_INVALID');
  return body as unknown as CollectionContext;
}
