import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';
import type { KpiConfig } from '../config/kpi-config';
import { awaitWriteBounded } from '../events/kpi-event-writer';
import type { KpiEventWriter } from '../events/kpi-event-writer';
import { getKpiRequestContext } from '../http/kpi-request-context';

export type KpiDependency = 'gemini' | 'unsplash_search' | 'unsplash_download';
export type DependencyTerminalOutcome = 'success' | 'error' | 'timeout';
export type DependencyCallResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

export interface DependencyInstrumentation {
  run<T>(
    dependency: KpiDependency,
    call: () => Promise<T>,
    classify: (result: DependencyCallResult<T>) => DependencyTerminalOutcome,
  ): Promise<T>;
}

// Las filas sólo llevan nombres fijos de dependencia: nunca URL, query, prompt, modelo ni claves.

// No-op por defecto: construcciones manuales, tests y scripts no escriben eventos.
export const NOOP_DEPENDENCY_INSTRUMENTATION: DependencyInstrumentation = {
  run: (_dependency, call) => call(),
};

export class KpiDependencyInstrumentation implements DependencyInstrumentation {
  constructor(
    private readonly config: KpiConfig,
    private readonly writer: KpiEventWriter,
  ) {}

  async run<T>(
    dependency: KpiDependency,
    call: () => Promise<T>,
    classify: (result: DependencyCallResult<T>) => DependencyTerminalOutcome,
  ): Promise<T> {
    const environment = this.config.environment;
    if (!this.config.enabled || environment === null) return call();

    // Sincrónico, antes del primer await: dos llamadas concurrentes nunca comparten attempt.
    const context = getKpiRequestContext();
    const operationId = context?.operationId ?? randomUUID();
    let attempt = 1;
    if (context) {
      attempt = (context.attempts.get(dependency) ?? 0) + 1;
      context.attempts.set(dependency, attempt);
    }

    const id = randomUUID();
    const startedAt = new Date();
    await awaitWriteBounded(
      () => this.writer.insertDependencyPending({ id, environment, operationId, dependency, attempt, startedAt }),
      'insert_dependency',
    );

    const callStart = performance.now();
    let result: DependencyCallResult<T>;
    try {
      result = { ok: true, value: await call() };
    } catch (error) {
      result = { ok: false, error };
    }
    const durationMs = Math.max(0, performance.now() - callStart);

    let outcome: DependencyTerminalOutcome;
    try {
      outcome = classify(result);
    } catch {
      outcome = 'error';
    }

    await awaitWriteBounded(
      () => this.writer.closeDependency({ id, outcome, finishedAt: new Date(), durationMs }),
      'close_dependency',
    );

    if (result.ok) return result.value;
    throw result.error;
  }
}
