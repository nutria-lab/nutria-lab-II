import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  ACCESS_GATE_COOKIE,
  ACCESS_GATE_REQUIRED_CODE,
  AccessGateService,
} from './access-gate.service';

const PUBLIC_PATHS = new Set(['/access/status', '/access/verify', '/health']);
// Machine-to-machine routes still apply their own bearer-token guard in NestJS.
const INTERNAL_KPI_PATHS = new Set(['/kpi/telemetry/sample', '/kpi/telemetry/finalize']);

@Injectable()
export class AccessGateMiddleware implements NestMiddleware {
  constructor(private readonly accessGateService: AccessGateService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    if (
      request.method === 'OPTIONS'
      || !this.accessGateService.isRequired()
      || PUBLIC_PATHS.has(request.path)
      || (request.method === 'POST' && INTERNAL_KPI_PATHS.has(request.path))
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
