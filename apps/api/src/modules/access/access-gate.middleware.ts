import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  ACCESS_GATE_COOKIE,
  ACCESS_GATE_REQUIRED_CODE,
  AccessGateService,
} from './access-gate.service';

const PUBLIC_PATHS = new Set(['/access/status', '/access/verify', '/health']);
// These POST handlers require KpiInternalAuthGuard instead of a browser access cookie.
// Keep the list explicit so future, potentially unguarded KPI routes remain gated.
const KPI_INTERNAL_POST_PATHS = new Set([
  '/kpi/telemetry/sample',
  '/kpi/collect',
  '/kpi/publications/reserve',
  '/kpi/publications/get',
  '/kpi/publications/freeze',
  '/kpi/publications/claim-attempt',
  '/kpi/publications/manual-recovery',
  '/kpi/publications/mark-accepted',
  '/kpi/publications/mark-delivered',
  '/kpi/publications/mark-failed',
]);

@Injectable()
export class AccessGateMiddleware implements NestMiddleware {
  constructor(private readonly accessGateService: AccessGateService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    if (
      request.method === 'OPTIONS'
      || !this.accessGateService.isRequired()
      || PUBLIC_PATHS.has(request.path)
      || (request.method === 'POST' && KPI_INTERNAL_POST_PATHS.has(request.path))
      || this.accessGateService.isValidToken(request.cookies?.[ACCESS_GATE_COOKIE])
    ) {
      next();
      return;
    }

    response.status(401).json({
      code: ACCESS_GATE_REQUIRED_CODE,
      message: 'Access password required.',
    });
  }
}
