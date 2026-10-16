import type { KpiId } from './kpi-contract';

export interface KpiCatalogDefinition {
  id: KpiId;
  kind: 'technical' | 'health' | 'business';
  unit: string;
  description: string;
  source: string;
  justification: string;
  aggregation?: 'sum' | 'avg' | 'min' | 'max' | 'last' | 'count';
}

/** Versioned, inert contract. Registration only happens through kpi:catalog. */
export const KPI_CATALOG: readonly KpiCatalogDefinition[] = [
  { id: 'operations_count', kind: 'technical', unit: '{request}', description: 'Count of terminal API telemetry events in the Argentina [00:00, 21:00) reporting window.', source: 'Telemetry snapshots', justification: 'Tracks completed system throughput.', aggregation: 'sum' },
  { id: 'error_rate', kind: 'technical', unit: '%', description: 'Server, network, and timeout terminal events divided by all terminal API events in the Argentina [00:00, 21:00) reporting window, as a percentage.', source: 'Telemetry snapshots', justification: 'Signals request reliability.', aggregation: 'last' },
  { id: 'latency_p95_ms', kind: 'technical', unit: 'ms', description: 'The 95th percentile of terminal API duration_ms samples in the Argentina [00:00, 21:00) reporting window.', source: 'Telemetry snapshots', justification: 'Captures tail latency without averaging the percentile.' },
  { id: 'health_status', kind: 'health', unit: '1', description: 'Latest valid health sample within the Argentina [00:00, 21:00) reporting window: healthy is 1 and unhealthy is 0.', source: 'Health probe', justification: 'Provides a simple service health signal.' },
  { id: 'last_success_age_seconds', kind: 'technical', unit: 's', description: 'Seconds from the latest successful API event to the 21:00 cutoff of the Argentina [00:00, 21:00) window; the successful event may predate the window.', source: 'Telemetry snapshots', justification: 'Shows freshness of successful work at the reporting cutoff.' },
  { id: 'timeout_rate', kind: 'technical', unit: '%', description: 'Timeout terminal API events divided by all terminal API events in the Argentina [00:00, 21:00) reporting window, as a percentage.', source: 'Telemetry snapshots', justification: 'Surfaces timeout pressure.', aggregation: 'last' },
  { id: 'dependency_error_rate', kind: 'technical', unit: '%', description: 'Failed or timed-out dependency attempts divided by all terminal dependency attempts in the Argentina [00:00, 21:00) reporting window, as a percentage.', source: 'Dependency instrumentation', justification: 'Tracks dependency reliability.', aggregation: 'last' },
  { id: 'availability_rate', kind: 'health', unit: '%', description: 'Healthy samples divided by healthy plus unhealthy samples in the Argentina [00:00, 21:00) reporting window, as a percentage.', source: 'Health probe', justification: 'Summarizes sampled availability.', aggregation: 'last' },
  { id: 'initial_plans_count', kind: 'business', unit: '{plan}', description: 'MealPlan rows still present, created in the Argentina [00:00, 21:00) reporting window, whose GenerationRun is an initial successful plan.', source: 'Meal plan database', justification: 'Measures initial plan creation activity.', aggregation: 'sum' },
  { id: 'manual_recipes_count', kind: 'business', unit: '{recipe}', description: 'Recipe rows still present with origin MANUAL and created in the Argentina [00:00, 21:00) reporting window.', source: 'Recipe database', justification: 'Measures manual recipe creation activity.', aggregation: 'sum' },
];

/** Canonical KPI identity list derived from the versioned catalog definitions. */
export const KPI_IDS: readonly KpiId[] = KPI_CATALOG.map(definition => definition.id);

/** Reject partial, duplicated, deprecated, or incompatible active catalogues. */
export function hasCompleteKpiCatalog(entries: readonly Record<string, unknown>[]): boolean {
  if (entries.length !== KPI_IDS.length) return false;
  const expected = new Map<string, KpiCatalogDefinition>(KPI_CATALOG.map(definition => [definition.id, definition]));
  const seen = new Set<string>();
  return entries.every((entry) => {
    const id = entry.id;
    if (typeof id !== 'string' || seen.has(id)) return false;
    seen.add(id);
    const definition = expected.get(id);
    return definition !== undefined && entry.deprecated_at === null && entry.kind === definition.kind && entry.unit === definition.unit;
  }) && seen.size === KPI_IDS.length;
}
