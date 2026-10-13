import { AsyncLocalStorage } from 'async_hooks';

export interface KpiRequestContext {
  operationId: string;
  attempts: Map<string, number>;
}

const storage = new AsyncLocalStorage<KpiRequestContext>();

export function runWithKpiRequestContext<T>(context: KpiRequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getKpiRequestContext(): KpiRequestContext | undefined {
  return storage.getStore();
}
