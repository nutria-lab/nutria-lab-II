// NUT-85 — Middleware HTTP KPI (design D4–D8, §6.1).
// pending (esperado, acotado) → handler dentro del contexto de request → end diferido hasta el UPDATE de cierre
// (esperado, acotado). Un solo cierre por request. Deshabilitado o excluido ⇒ pass-through.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { performance } from 'perf_hooks';
import type { KpiConfig } from '../config/kpi-config';
import { KPI_WRITE_WAIT_MS, awaitWriteBounded } from '../events/kpi-event-writer';
import type { KpiEventWriter } from '../events/kpi-event-writer';
import { KPI_CONFIG, KPI_EVENT_WRITER } from '../kpi.tokens';
import type { KpiEnvironment } from '../kpi-contract';
import {
  UNMATCHED_OPERATION,
  UNRESOLVED_OPERATION,
  classifyHttpOutcome,
  isExcludedFromTraffic,
  normalizeOperation,
} from './http-outcome';
import type { HttpOutcomeInput } from './http-outcome';
import { runWithKpiRequestContext } from './kpi-request-context';

function routeOf(req: Request): { path?: unknown } | undefined {
  return (req as Request & { route?: { path?: unknown } }).route;
}

/** Guarda propia del middleware por si el escritor inyectado no respeta su límite (design D5: ≤ 250 ms por paso). */
const MIDDLEWARE_WAIT_MS = KPI_WRITE_WAIT_MS;

@Injectable()
export class KpiHttpMiddleware implements NestMiddleware {
  private readonly logger = new Logger('KpiHttpMiddleware');

  constructor(
    @Inject(KPI_CONFIG) private readonly config: KpiConfig,
    @Inject(KPI_EVENT_WRITER) private readonly writer: KpiEventWriter,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const environment = this.config.environment;
    if (!this.config.enabled || environment === null || isExcludedFromTraffic(req.method, req.originalUrl ?? req.url)) {
      next();
      return;
    }
    this.instrument(environment, req, res, next).catch(() => {
      this.logger.warn('KPI_MIDDLEWARE_FAILED');
    });
  }

  private async instrument(environment: KpiEnvironment, req: Request, res: Response, next: NextFunction) {
    // Nest monta el middleware como una ruta comodín: esa ruta propia no cuenta como match del negocio.
    const middlewareRoute = routeOf(req);
    const id = randomUUID();
    const startedAt = new Date();
    const startedMono = performance.now();

    await awaitWriteBounded(
      () => this.writer.insertHttpPending({ id, environment, operation: UNRESOLVED_OPERATION, startedAt }),
      'insert_http',
      MIDDLEWARE_WAIT_MS,
    );

    let closing: Promise<void> | undefined;
    let serverTimedOut = false;

    const close = (input: HttpOutcomeInput): Promise<void> => {
      if (closing) return closing;
      const durationMs = Math.max(0, performance.now() - startedMono);
      const finishedAt = new Date(startedAt.getTime() + durationMs);
      const { outcome, httpStatus } = classifyHttpOutcome(input);
      const route = routeOf(req);
      const operation =
        route && route !== middlewareRoute && typeof route.path === 'string'
          ? normalizeOperation(req.method, `${req.baseUrl ?? ''}${route.path}`)
          : UNMATCHED_OPERATION;
      closing = awaitWriteBounded(
        () => this.writer.closeHttp({ id, operation, outcome, httpStatus, finishedAt, durationMs }),
        'close_http',
        MIDDLEWARE_WAIT_MS,
      );
      return closing;
    };

    // Timeout del socket señalado por el propio servidor (timeout confirmado). Un listener en el socket no
    // cambia el comportamiento por defecto de Node (que destruye el socket).
    const socket = req.socket;
    const onSocketTimeout = () => {
      serverTimedOut = true;
    };
    socket?.on('timeout', onSocketTimeout);

    res.once('close', () => {
      socket?.removeListener('timeout', onSocketTimeout);
      if (!res.writableFinished && !closing) {
        void close(serverTimedOut ? { statusCode: null, serverTimedOut: true } : { statusCode: null, clientDisconnected: true });
      }
    });

    // Difiere el end real hasta que el cierre se haya persistido (acotado).
    const originalEnd = res.end;
    let endCalled = false;
    res.end = function deferredEnd(this: Response, ...args: unknown[]) {
      if (endCalled) return res;
      endCalled = true;
      void close({ statusCode: res.statusCode }).then(() => {
        (originalEnd as (...endArgs: unknown[]) => Response).apply(res, args);
      });
      return res;
    } as Response['end'];

    runWithKpiRequestContext({ operationId: id, attempts: new Map() }, () => next());
  }
}
