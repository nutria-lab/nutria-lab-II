# NUT-85 — Checklist verificable

Fuente de verdad: `ticket.md` de esta carpeta. Cada ítem se marca `[x]` SOLO con la referencia al test, comando o archivo que lo demuestra (`→ archivo.spec.ts › nombre del test`). Lo que de verdad requiere a una persona se marca `[P]` y se copia a `pending-human.md` con el motivo. Los ítems marcados con ★ NO pueden ir a `[P]`.

## A. Esquema y migración
- [x] A1 ★ `kpi.prisma` con los 5 modelos y `@@map` (`kpi_http_event`, `kpi_dependency_event`, `kpi_health_sample`, `kpi_snapshot`, `kpi_publication`), tipos `Timestamptz(3)`, `Date`, `Uuid`, `DoublePrecision`, `JsonB`; PK/UNIQUE/índices reflejados en Prisma. Sin FK a usuario ni a negocio. → `apps/api/prisma/models/kpi.prisma`; `src/modules/kpi/tests/kpi-schema.spec.ts`
- [x] A2 ★ UNA migración aditiva con todos los CHECK del ticket: enums como text+CHECK; pending⇒finished/duration nulos y terminal⇒ambos completos; duration≥0; http_status 100..599; finished≥started; attempt≥1; reglas healthy/unhealthy/unknown; snapshot observed/unavailable, % 0..100, salud 0/1; publication: estados, lote+hash (64 hex) según estado, accepted_at/delivered_at, attempt_count 0..3; window_start<window_end. → `migrations/20261009213000_add_kpi_telemetry/migration.sql`; `kpi-migration-sql.spec.ts` › contiene cada CHECK por nombre; `kpi-constraints.integration.spec.ts` › rechaza con 23514 / acepta la contraparte válida
- [x] A3 ★ Índices `createdAt` en meal_plans y recipes. El SQL no contiene DROP, ni ALTER destructivo, ni cambios a columnas de negocio (revisión del SQL citada en evidence.md). → `kpi-migration-sql.spec.ts` › crea los índices createdAt / no contiene DROP…; revisión en `evidence-t1-a4.md` §5
- [x] A4 `migrate deploy` sobre un Postgres DESECHABLE vacío y sobre otro con datos de NutrIA: existen 5 tablas/CHECK/UNIQUE/índices; los conteos de users/recipes/meal_plans son iguales antes y después. → `evidence-t1-a4.md` (kpi_empty y kpi_withdata en Postgres desechable, conteos/md5 iguales); `kpi-migration.integration.spec.ts`

## B. Instrumentación HTTP
- [ ] B1 ★ Inserta `pending` al comenzar y cierra el MISMO id con UPDATE: una sola fila por request; id UUID y duration ≥ 0.
- [ ] B2 ★ Outcomes: 200→success, 404→client_error, 500→server_error, desconexión→network_error, timeout confirmado→timeout, sin cierre→queda pending (nunca timeout inferido).
- [ ] B3 ★ Un cierre duplicado no crea otra fila ni pisa el cierre original.
- [ ] B4 ★ `operation` es la ruta normalizada (plantilla), sin query, userId ni token; si la ruta no matchea, un valor fijo.
- [ ] B5 ★ `/health` y el tráfico de reporting quedan excluidos.
- [ ] B6 ★ Cada escritura tiene timeout SQL de 100ms y espera acotada; si la DB falla o está lenta, el negocio responde igual y se loguea un código técnico. No quedan promesas sueltas (todo se espera antes de terminar).
- [ ] B7 ★ `KPI_ENV` es obligatorio y se valida (dev|qa|prod); nunca se infiere de NODE_ENV.
- [ ] B8 ★ Existe un interruptor para desactivar la instrumentación (rollback operativo) y, desactivada, la app funciona sin tocar tablas.

## C. Dependencias externas
- [ ] C1 ★ Wrapper aplicado donde se ejecuta la llamada: Gemini (`generateText`) y Unsplash (search y trackDownload), sin instrumentar también la capa superior.
- [ ] C2 ★ Cada intento genera su propia fila con attempt incremental (incluye las 2 llamadas de la regeneración); outcome success/error/timeout; sin URL ni claves.

## D. GET /health
- [ ] D1 ★ 200 `{"status":"ok","database":"ok"}` después de `SELECT 1`; 503 `{"status":"error","database":"error"}` si la DB falla o tarda más de 2s. No invoca IA ni expone excepciones o credenciales.

## E. Ventana temporal
- [ ] E1 ★ D=2026-10-09 ⇒ start=2026-10-09T03:00:00Z, end=2026-10-10T00:00:00Z (America/Argentina/Buenos_Aires, 00:00–21:00).
- [ ] E2 ★ Sin fecha explícita se toma el último corte de las 21:00 que ya pasó; un atraso del scheduler no cambia D; se rechaza una fecha futura o un corte que todavía no ocurrió.

## F. Fórmulas (fixtures exactos del ticket)
- [ ] F1 ★ 20 duraciones 1..20ms ⇒ p95 = 19 (percentile_disc 0.95).
- [ ] F2 ★ 1 timeout + 1 server_error sobre 10 operaciones ⇒ error_rate 20, timeout_rate 10; un 4xx no suma errores; los pending no entran.
- [ ] F3 ★ 2 fallos sobre 8 intentos ⇒ dependency_error_rate 25.
- [ ] F4 ★ last_success_age_seconds usa un éxito anterior a start; sin éxito conocido ⇒ unavailable.
- [ ] F5 ★ health_status toma la última muestra por tiempo real; si tiene más de 60 min antes del corte o es unknown ⇒ unavailable.
- [ ] F6 ★ Dos healthy + una unhealthy ⇒ availability 66.666…; unknown no cuenta; sin muestras válidas ⇒ unavailable.
- [ ] F7 ★ unavailable ⇒ value null + reason no vacío; un 0 medido queda `observed`; NaN/Infinity lanza error (no se oculta).

## G. Snapshots y collect
- [ ] G1 ★ Los 8 previews se guardan en UNA transacción e idempotentes por corte; los previews de distintos cortes coexisten.
- [ ] G2 ★ finalize corre en transacción REPEATABLE READ; los finales son inmutables; si ya existen los 8, se devuelven sin recalcular.
- [ ] G3 Dos finalizaciones concurrentes contra Postgres real ⇒ exactamente 8 finales iguales, sin mezcla de corridas.
- [ ] G4 ★ `TelemetryLogger.collect(context)` usa el mismo código que finalize, respeta el corte fijo del contexto y devuelve exactamente los 8 códigos de Telemetry. Probado con un Composite falso.

## H. CLI `scripts/kpi` (sample/finalize)
- [ ] H1 ★ sample: bucket = floor(nowUTC/30min); API /health con timeout 5s y DB SELECT 1 con 2s; una fila por bucket con ON CONFLICT DO NOTHING (reejecutar no la modifica); timeout/5xx ⇒ unhealthy; no rellena buckets viejos.
- [ ] H2 ★ Si no se puede guardar la muestra porque la DB cayó ⇒ exit ≠ 0, sin observación ficticia.
- [ ] H3 ★ preview con end = min(ahora, 21:00 de D); si todavía no hay intervalo positivo, solo guarda la muestra y sale.
- [ ] H4 ★ finalize no toma una muestra nueva de health ni falsea el timestamp de las 21:00.
- [ ] H5 ★ Cada corrida escribe un JSON de diagnóstico no sensible (ventana, cantidad de muestras, calidad, errores técnicos); ante fallo de telemetría, exit ≠ 0.
- [ ] H6 ★ Purga: no hace nada antes de 2027-01-01; desde ahí borra el trimestre cerrado de las 4 tablas crudas/snapshots en lotes de 1000; nunca toca kpi_publication ni el día en preparación.

## I. Workflow `.github/workflows/kpi-telemetry.yml`
- [ ] I1 ★ cron `*/30 * * * *`; workflow_dispatch con environment (dev/prod), date opcional y mode (sample/finalize); el schedule siempre usa prod; usa GitHub Environments.
- [ ] I2 ★ concurrency por ambiente con cancel-in-progress=false; permissions contents:read; timeout-minutes 10; checkout de la rama default; Node 24; pnpm --frozen-lockfile; prisma generate antes del script; sin migrate ni seed.
- [ ] I3 ★ Sube el artifact de diagnóstico con retention-days 90; usa solo los secrets/variables del contrato. Verificado con un test que parsea el YAML o con actionlint.

## J. Límites
- [ ] J1 ★ No se modificaron package.json ni los archivos de Lara (salvo un kpi-contract.ts mínimo con los tipos textuales del ticket, si no existía).
- [ ] J2 ★ Ninguna tabla kpi_ guarda PII, URLs, claves ni datos de dominio.
- [ ] J3 ★ `pnpm --filter api test`, `pnpm --filter api lint` y `pnpm --filter api build` terminan con exit 0 (salida en evidence.md).

## Pendientes humanos esperados (no bloquean el /goal)
- Aplicar la migración en dev/prod con aprobación del TL.
- La ejecución manual real de la Action en dev, con su enlace (el workflow hace checkout de la rama default, así que en la práctica va después del merge).
- La entrada `kpi:telemetry` en package.json y `tsx` como devDependency (le toca a Lara).
- La integración con el contrato real de Lara y el PR.
