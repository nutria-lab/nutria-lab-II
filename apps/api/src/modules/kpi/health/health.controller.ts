// El resultado no depende de la config KPI; sólo el header X-KPI-Instrumentation la refleja.
import { Controller, Get, Header, Inject, Logger, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { KpiConfig } from '../config/kpi-config';
import { DB_HEALTH_PROBE, KPI_CONFIG } from '../kpi.tokens';
import { HEALTH_DB_TIMEOUT_MS, HEALTH_RESULT_TTL_MS } from './db-health-probe';
import type { DbHealthProbe } from './db-health-probe';

const OK_BODY = { status: 'ok', database: 'ok' } as const;
const ERROR_BODY = { status: 'error', database: 'error' } as const;

export const KPI_INSTRUMENTATION_HEADER = 'X-KPI-Instrumentation';

type ProbeResult = 'ok' | 'HEALTH_DB_ERROR' | 'HEALTH_DB_TIMEOUT';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger('HealthController');

  constructor(
    @Inject(DB_HEALTH_PROBE) private readonly probe: DbHealthProbe,
    @Inject(KPI_CONFIG) private readonly config: KpiConfig,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async check(@Res({ passthrough: true }) res: Response) {
    const result = await this.pingWithDeadline();
    res.setHeader(KPI_INSTRUMENTATION_HEADER, this.config.enabled ? 'enabled' : 'disabled');
    if (result === 'ok') return OK_BODY;
    this.logger.warn(result);
    res.status(503);
    return ERROR_BODY;
  }

  private inFlight: Promise<ProbeResult> | null = null;
  private cached: { result: ProbeResult; at: number } | null = null;

  private pingWithDeadline(): Promise<ProbeResult> {
    if (this.cached && Date.now() - this.cached.at < HEALTH_RESULT_TTL_MS) return Promise.resolve(this.cached.result);
    if (!this.inFlight) {
      const flight = this.withDeadline(this.startProbe()).then(result => {
        this.cached = { result, at: Date.now() };
        this.inFlight = null;
        return result;
      });
      this.inFlight = flight;
    }
    return this.withDeadline(this.inFlight);
  }

  private startProbe(): Promise<ProbeResult> {
    let ping: Promise<void>;
    try {
      ping = this.probe.ping();
    } catch {
      ping = Promise.reject(new Error('HEALTH_DB_ERROR'));
    }
    return ping.then(
      () => 'ok' as const,
      () => 'HEALTH_DB_ERROR' as const,
    );
  }

  private withDeadline(result: Promise<ProbeResult>): Promise<ProbeResult> {
    return new Promise<ProbeResult>(resolve => {
      const timer = setTimeout(() => resolve('HEALTH_DB_TIMEOUT'), HEALTH_DB_TIMEOUT_MS);
      void result.then(value => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }
}
