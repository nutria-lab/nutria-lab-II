// NUT-85 — GET /health (design D10, §6.3). 200 tras SELECT 1; 503 si la DB falla o tarda más de 2 s.
// Body exacto, Cache-Control: no-store, sin detalle del error ni credenciales. No depende de la config KPI.
import { Controller, Get, Header, Inject, Logger, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DB_HEALTH_PROBE } from '../kpi.tokens';
import { HEALTH_DB_TIMEOUT_MS } from './db-health-probe';
import type { DbHealthProbe } from './db-health-probe';

const OK_BODY = { status: 'ok', database: 'ok' } as const;
const ERROR_BODY = { status: 'error', database: 'error' } as const;

type ProbeResult = 'ok' | 'HEALTH_DB_ERROR' | 'HEALTH_DB_TIMEOUT';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger('HealthController');

  constructor(@Inject(DB_HEALTH_PROBE) private readonly probe: DbHealthProbe) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async check(@Res({ passthrough: true }) res: Response) {
    const result = await this.pingWithDeadline();
    if (result === 'ok') return OK_BODY;
    this.logger.warn(result);
    res.status(503);
    return ERROR_BODY;
  }

  private pingWithDeadline(): Promise<ProbeResult> {
    return new Promise<ProbeResult>(resolve => {
      const timer = setTimeout(() => resolve('HEALTH_DB_TIMEOUT'), HEALTH_DB_TIMEOUT_MS);
      let ping: Promise<void>;
      try {
        ping = this.probe.ping();
      } catch {
        ping = Promise.reject(new Error('HEALTH_DB_ERROR'));
      }
      ping.then(
        () => {
          clearTimeout(timer);
          resolve('ok');
        },
        () => {
          clearTimeout(timer);
          resolve('HEALTH_DB_ERROR');
        },
      );
    });
  }
}
