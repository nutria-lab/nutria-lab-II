# ADR — API-first para telemetría y estado de publicación

Fecha: 2026-10-15  
Estado: Aprobado por Majo en la conversación de implementación de NUT-85.

## Contexto

Las GitHub Actions necesitan registrar muestras, materializar snapshots y reunir los diez valores del lote. La base operativa es PostgreSQL/Prisma de NutrIA. Majo decidió que la Action consulte primero la API de NutrIA y use `DATABASE_URL` directamente solo si la API no devuelve respuesta por timeout o error de red.

Una respuesta HTTP, incluso 4xx/5xx, es una respuesta del servicio y no habilita acceso directo a DB. Esto evita ocultar errores de autenticación, contrato, lógica o persistencia mediante una ruta alternativa.

## Decisión

- Las rutas internas protegidas de NutrIA reciben las muestras de salud, materializan preview/final, calculan los KPIs y gestionan las transiciones de `kpi_publication`.
- Las Actions y CLIs usan `KPI_API_BASE_URL` con `KPI_INTERNAL_TOKEN` primero.
- Solo `KpiTransportError` (timeout o fallo de red sin respuesta HTTP) activa el adaptador local Prisma; `KpiResponseError`, incluyendo toda respuesta HTTP no exitosa o inválida, termina la corrida sin fallback.
- El POST a Supabase continúa ejecutándose desde el Publisher en GitHub Actions; el backend no publica por cada petición de negocio.
- La creación de clientes/pools locales queda diferida hasta invocar fallback. Los endpoints de reporte se excluyen de la instrumentación de tráfico.

## Alternativas evaluadas

1. Mantener Prisma directo como vía primaria desde cada Action: simple, pero las Actions acceden a DB incluso cuando NutrIA está disponible y duplican responsabilidad de cálculo.
2. Hacer que una llamada de negocio publique externamente desde el backend: reduce pasos del CLI, pero acopla el servicio web a la publicación programada y a credenciales Supabase.
3. API-first para muestra, colección y estado; Publisher conserva el POST externo y DB directa queda como recuperación de transporte: elegida por mantener el cron/reintentos existentes y la propiedad de DB en NutrIA.

## Consecuencias y riesgos

- Backend y GitHub Environment deben compartir `KPI_ENV`, `KPI_API_BASE_URL`, token interno y la DB del mismo ambiente.
- Los endpoints son síncronos; una llamada que exceda el timeout puede seguir procesándose mientras la Action inicia fallback. Las restricciones únicas, escrituras condicionales e idempotencia deben mantener una sola fila/lote.
- Si el backend devuelve HTTP 4xx/5xx, la Action falla visiblemente aunque la DB local sea accesible; no se interpreta una respuesta del servicio como caída de transporte.
- El token interno habilita operaciones de escritura de telemetría/estado y debe guardarse como secret por GitHub Environment y no registrarse.

## Migración y rollback

- No se cambia el esquema ni se crea una migración nueva para este ADR; la migración existente de las cinco tablas ya fue aplicada por el responsable.
- Rollback operativo: deshabilitar los workflows o apagar `KPI_INSTRUMENTATION_ENABLED`; conservar tablas y datos. La implementación local queda disponible únicamente como fallback ante timeout/red, no se ejecutan `DROP`, reset ni migraciones desde los cron.
- Engram no está disponible en las herramientas de esta sesión; este ADR queda como registro versionado de la decisión.
