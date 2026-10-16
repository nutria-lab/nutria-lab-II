import type { KpiId } from './kpi-contract';

export type KpiCatalogKind = 'technical' | 'health' | 'business';

export interface KpiCatalogDefinition {
  id: KpiId;
  kind: KpiCatalogKind;
  unit: string;
  description: string;
  source: string;
  justification: string;
}

/** Versioned contract definitions; p95 is intentionally a precomputed scalar, not an API average. */
export const KPI_CATALOG_DEFINITIONS: readonly KpiCatalogDefinition[] = [
  {
    id: 'operations_count', kind: 'technical', unit: '{request}',
    description: 'Cantidad de solicitudes HTTP terminales en la ventana parcial [00:00, 21:00) de Argentina.',
    source: 'kpi_http_event: COUNT(*) por environment y finished_at en [window_start, window_end), excluyendo health y reporting.',
    justification: 'Mide el volumen de operaciones completadas sin contar intentos pendientes ni endpoints de telemetría.',
  },
  {
    id: 'error_rate', kind: 'technical', unit: '%',
    description: 'Porcentaje de solicitudes terminales server_error, network_error o timeout en la ventana parcial [00:00, 21:00) de Argentina.',
    source: 'kpi_http_event: (server_error + network_error + timeout) / operaciones terminales * 100.',
    justification: 'Cuantifica errores técnicos observados; 4xx no se consideran fallos del servidor.',
  },
  {
    id: 'latency_p95_ms', kind: 'technical', unit: 'ms',
    description: 'Percentil discreto 95 de duration_ms de solicitudes HTTP terminales en la ventana parcial [00:00, 21:00) de Argentina.',
    source: 'kpi_http_event: percentile_disc(0.95) sobre duration_ms de terminales; escalar calculado localmente.',
    justification: 'Reporta la cola de latencia calculada por NutrIA; no aplicar aggregation=avg en el servicio externo.',
  },
  {
    id: 'health_status', kind: 'health', unit: '1',
    description: 'Estado de la última muestra de salud válida dentro de la ventana parcial [00:00, 21:00) de Argentina: healthy=1, unhealthy=0.',
    source: 'kpi_health_sample: última observación por measured_at; muestras unknown o antiguas producen unavailable local.',
    justification: 'Representa la muestra de salud más reciente, no una afirmación de uptime continuo.',
  },
  {
    id: 'last_success_age_seconds', kind: 'technical', unit: 's',
    description: 'Segundos entre el corte parcial de las 21:00 de Argentina y el último éxito HTTP 2xx conocido antes del corte.',
    source: 'kpi_http_event: window_end - MAX(finished_at) para http_status 200..299 antes de window_end.',
    justification: 'Incluye éxitos anteriores al inicio de la ventana para conservar la antigüedad real del último éxito.',
  },
  {
    id: 'timeout_rate', kind: 'technical', unit: '%',
    description: 'Porcentaje de timeouts HTTP confirmados entre solicitudes terminales en la ventana parcial [00:00, 21:00) de Argentina.',
    source: 'kpi_http_event: timeout / operaciones terminales * 100.',
    justification: 'Solo cuenta timeouts confirmados; solicitudes pending no se deducen como timeout.',
  },
  {
    id: 'dependency_error_rate', kind: 'technical', unit: '%',
    description: 'Porcentaje de intentos terminales de dependencia con error o timeout en la ventana parcial [00:00, 21:00) de Argentina.',
    source: 'kpi_dependency_event: (error + timeout) / intentos terminales * 100.',
    justification: 'Cuenta cada intento externo por separado para hacer visibles los reintentos.',
  },
  {
    id: 'availability_rate', kind: 'health', unit: '%',
    description: 'Porcentaje de muestras de salud healthy entre muestras healthy y unhealthy en la ventana parcial [00:00, 21:00) de Argentina.',
    source: 'kpi_health_sample: healthy / (healthy + unhealthy) * 100; unknown y ausentes no integran el denominador.',
    justification: 'Es una proporción de muestras, no una duración continua de disponibilidad.',
  },
  {
    id: 'initial_plans_count', kind: 'business', unit: '{plan}',
    description: 'Conteo de MealPlan todavía existente, creado en la ventana parcial [00:00, 21:00) de Argentina, ligado a generación inicial exitosa.',
    source: 'meal_plans JOIN generation_runs: kind=MEAL_PLAN_INITIAL, status=SUCCEEDED y createdAt en [start, end).',
    justification: 'No cuenta regeneraciones, generaciones fallidas o pendientes; un plan luego supersedido sigue contando si existe.',
  },
  {
    id: 'manual_recipes_count', kind: 'business', unit: '{recipe}',
    description: 'Conteo de Recipe todavía existente, origin=MANUAL y creada en la ventana parcial [00:00, 21:00) de Argentina.',
    source: 'recipes: origin=MANUAL y createdAt en [start, end).',
    justification: 'Excluye recetas AI y ediciones de recetas previas; cuenta filas existentes al leer.',
  },
];

export function validateKpiCatalogDefinitions(definitions: readonly KpiCatalogDefinition[] = KPI_CATALOG_DEFINITIONS): void {
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id) || definition.description.length < 5 || definition.description.length > 500 ||
      !definition.source.trim() || !definition.justification.trim() || !definition.unit.trim()) {
      throw new TypeError('KPI_CATALOG_DEFINITIONS_INVALID');
    }
    ids.add(definition.id);
  }
  if (ids.size !== 10) throw new TypeError('KPI_CATALOG_DEFINITIONS_INVALID');
}
