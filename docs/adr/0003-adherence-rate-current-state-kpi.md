# ADR-0003: `adherence_rate` observada al recolectar

**Estado:** Aprobada para NUT-98 por la decisión humana del TL/PO del 2026-10-29.

## Contexto

El publisher identifica cada ejecución con una fecha de reporte y una ventana que
cierra a las 21:00 de Buenos Aires. Las comidas y su completion actuales se guardan
en tablas de negocio, pero no existe historia durable de cada cambio. Por eso la base
actual no puede reconstruir qué estado tenía una comida al cierre de una fecha
anterior. Se necesita agregar `adherence_rate` al conjunto existente de KPIs sin
presentar el estado actual como si fuera una captura histórica.

## Decisión

- `adherence_rate` se calcula con el estado válido que la base asociada al ambiente
  del logger contiene al comenzar `collect`. La fecha del reporte y su ventana no
  seleccionan la población de este KPI.
- Es elegible cada comida de un plan vigente cuya fecha civil almacenada sea menor o
  igual a la fecha actual de `America/Argentina/Buenos_Aires`. Las comidas de hoy se
  incluyen y las futuras se excluyen. No se asigna una hora individual de comida.
- `effectiveMealStatus` decide si cada completion sigue correspondiendo al contenido
  planificado. Sólo un `COMPLETED` efectivo suma al numerador. Toda comida elegible
  suma una vez al denominador, incluso si está `SKIPPED`, `NOT_LOGGED` o tiene un
  snapshot stale. Planes y versiones no vigentes quedan fuera.
- Se suman comidas en toda la población del ambiente: `100 * C / N`; no se promedian
  tasas por usuario. `0/N` con `N > 0` es cero observado. `0/0` es unavailable con
  `NO_ELIGIBLE_MEALS`. Si falla la fuente, ambos conteos son desconocidos, no cero,
  con `SOURCE_UNAVAILABLE`.
- Los lotes nuevos contienen los once KPIs: los diez IDs existentes más
  `adherence_rate`. El valor escalar forma parte del payload de mediciones. Los
  conteos, calidad, motivo, fecha e instante de colección y ambiente se conservan
  sólo en el JSON de diagnóstico interno; no se agregan al payload externo ni
  incluyen identificadores de usuarios, comidas o recetas.
- Un retry utiliza exactamente el lote ya congelado. Los lotes legacy de diez IDs se
  pueden leer, verificar y reintentar con sus bytes/SHA originales; no se recalculan
  ni se les agrega `adherence_rate`. Un lote nuevo o una nueva congelación debe tener
  los once IDs completos. El publisher intenta enviar los once en una sola solicitud.
  Si el servicio remoto rechaza ese contrato, la ejecución queda fallida y el lote
  permanece disponible para el retry actual; no se divide ni se marca como aceptado.

## Alternativas consideradas

1. **Inferir el estado del corte con el estado actual o `updatedAt < cutoff`.**
   Descartada: no conserva versiones pasadas y no prueba qué estado existía al
   corte.
2. **Usar una transacción Repeatable Read como historial.** Descartada: estabiliza
   las lecturas concurrentes de una transacción, pero no recupera datos ya
   reemplazados o modificados.
3. **Persistir snapshots periódicos o historial de estados.** Fuera de esta fase:
   requiere una decisión de retención, modelo y despliegue que no forma parte de la
   decisión de cálculo al recolectar.
4. **Reemplazar uno de los diez KPIs, publicar un subconjunto o dividir la solicitud.**
   Descartada: perdería o alteraría el contrato y la identidad de publicación.

## Consecuencias

El KPI es una observación del estado disponible al recolectar, no una medición
histórica del corte del reporte. El reporte puede tener una fecha distinta de
`collection_date`; ambos significados se guardan por separado. La lectura de
`meal_plan_days.date` compara su fecha civil PostgreSQL (`TIMESTAMP WITHOUT TIME
ZONE`) con una fecha ISO de Buenos Aires, sin conversión por la zona de sesión.

`KpiPublication.frozenBatch` ya usa JSONB, así que la evidencia agregada se persiste
sin agregar columnas ni una migración. El payload externo mantiene su shape escalar.
El pipeline local conoce los once IDs y permite sólo el set completo de diez para
leer/reintentar lotes congelados anteriores. Un rechazo real del servicio externo a
once IDs sigue siendo una dependencia visible; esta decisión no cambia sus tablas,
límites, secretos ni configuración.

## Migración y rollback

No hay cambio de esquema ni migración Prisma. Para revertir el cálculo y su
publicación se revierte el cambio de código como una unidad; los lotes nuevos ya
congelados conservan los once valores y su evidencia agregada, mientras que los
legacy de diez permanecen intactos. No borrar ni reescribir filas de publicación.
La adopción en un entorno compartido debe pasar por el flujo de revisión y despliegue
habitual. No se ejecutó una escritura remota como parte de esta decisión.
