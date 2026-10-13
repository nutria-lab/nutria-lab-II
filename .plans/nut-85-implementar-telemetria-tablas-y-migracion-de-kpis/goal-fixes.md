# NUT-85 — Correcciones post-revisión (goal)

Rama actual: `mariajoserosalestorres/nut-85-implementar-telemetria-tablas-y-migracion-de-kpis-con-github`. Fuente de verdad: `ticket.md` de esta carpeta. Primero leé este archivo completo y mostrá en la conversación la sección **TERMINADO**. Después reconstruí el estado con `git status` y `git log` y seguí.

## Fix 1: no publicar "observed 0" cuando la instrumentación está apagada

Problema: con `KPI_ENV` faltante/inválido o `KPI_INSTRUMENTATION_ENABLED=false`, la app no escribe eventos y `operations_count` sale `observed` = 0. Eso contradice el ticket ("no informar datos inventados como observed"; "falta de fuente ⇒ unavailable").

Enfoque (sin cambiar el esquema ni la migración):
1. `GET /health` agrega el header `X-KPI-Instrumentation: enabled|disabled` según la config KPI efectiva (disabled si `enabled=false` por cualquier motivo). El body sigue EXACTO (`{"status":"ok","database":"ok"}` / error) y el status no cambia.
2. El CLI `sample` lee ese header. Si viene `disabled`, guarda la muestra igual (la salud de API/DB no cambia) con `reason = 'INSTRUMENTATION_DISABLED'`. Si el header falta (versión vieja del backend), no se marca nada.
3. Fórmulas: si alguna muestra de salud con `measured_at` en la ventana tiene `reason = 'INSTRUMENTATION_DISABLED'`, los KPIs que dependen de eventos (`operations_count`, `error_rate`, `timeout_rate`, `latency_p95_ms`, `last_success_age_seconds`, `dependency_error_rate`) salen `unavailable` con reason `INSTRUMENTATION_DISABLED`. `health_status` y `availability_rate` no cambian.
4. Documentarlo como nueva decisión en `design.md` → Decisiones. En `pending-human.md`, sacar el riesgo aceptado "Instrumentación apagada se ve como 0" y reemplazarlo por la limitación que queda: fallas del escritor sin apagar la instrumentación todavía no se detectan.

Tests (rojo primero con `nutria_backend_tester`, después `nutria_backend_implementer`):
- `/health` devuelve el header correcto con la instrumentación habilitada, deshabilitada por switch, y sin `KPI_ENV`; el body sigue idéntico.
- `sample` con header `disabled` ⇒ muestra con reason `INSTRUMENTATION_DISABLED`; sin header ⇒ reason como antes.
- Fórmulas: ventana con una muestra `INSTRUMENTATION_DISABLED` ⇒ esos 6 KPIs `unavailable`/`INSTRUMENTATION_DISABLED`; sin esa muestra ⇒ `operations_count` 0 sigue `observed` (no romper F1–F7).
- Integración con el Postgres de pruebas para el agregado nuevo.

## Fix 2: no perder requests en arranque en frío (timeout de conexión del escritor)

Problema: `db/kpi-prisma.ts` usa `connectionTimeoutMillis: 150`. En Vercel+Neon, abrir una conexión nueva suele tardar más; el insert `pending` falla, el UPDATE de cierre afecta 0 filas y la request no queda registrada en ningún lado (subconteo silencioso).

Enfoque:
1. Separar el timeout de conexión del de consulta: nueva constante `KPI_CONNECT_TIMEOUT_MS = 1500` para `connectionTimeoutMillis`; `query_timeout` sigue en 150 y `SET LOCAL statement_timeout` en 100 ms.
2. El negocio sigue protegido por la espera acotada de 250 ms (`KPI_WRITE_WAIT_MS`), que NO cambia: si la conexión tarda, la respuesta sale igual y la escritura termina en vuelo; el cierre ya espera al insert del mismo id.
3. Documentarlo en `design.md` → Decisiones y actualizar el riesgo en `pending-human.md` (medir en dev la tasa de `KPI_WRITE_FAILED` en arranques en frío).

Tests:
- El pool del escritor se crea con `connectionTimeoutMillis = 1500` y `query_timeout = 150`.
- Con un cliente falso cuya conexión/insert tarda ~600 ms: la respuesta de negocio llega dentro del límite acotado, el insert `pending` termina después, el cierre se aplica sobre el mismo id y queda UNA fila terminal.

## MODO LIVIANO (obligatorio)

- Un solo comando pesado a la vez (test, tsc, build, prisma generate, docker). Nada en paralelo ni en segundo plano; no dejar procesos vivos.
- Tests focalizados con `pnpm --filter api exec jest <rutas> --maxWorkers=2`; los que usan Postgres, con `--runInBand`. Usar `NODE_OPTIONS=--max-old-space-size=2048`.
- Prohibido: modos watch, `pnpm install`, crear contenedores nuevos, buscar dentro de node_modules/dist/.turbo/.codegraph.
- Postgres de pruebas: reutilizar el contenedor que ya existe (ver `evidence.md`; si está detenido, `docker start` de ese contenedor). Usar `KPI_TEST_DATABASE_URL` apuntando a localhost.
- Sub-agentes de `.claude/agents`: tester y después implementer, uno por vez. Al final, `nutria_backend_review_reliability` y `nutria_backend_review_resilience` en paralelo, solo leyendo (sin correr tests ni builds); corregir cualquier blocker/critical.

## PROHIBIDO

- `prisma migrate dev/deploy/reset`, `db push` o seed contra `apps/api/.env` o cualquier base compartida/Neon (solo contra localhost).
- Modificar la migración `20261009213000_add_kpi_telemetry` o `kpi.prisma`.
- Push, PR, merge, Linear.
- Tocar `package.json` o los archivos de Lara.
- Mostrar o commitear secretos o `.env`.
- Llamar a Supabase.

Si hay una ambigüedad, elegir la opción más conservadora según el ticket y documentarla en Decisiones, sin preguntar. Hacer un commit local por fix.

## TERMINADO cuando

1. Fix 1 y Fix 2 están implementados, cada uno en su propio commit local, con sus tests en verde.
2. `pnpm --filter api test` (suite completa, una vez, con `KPI_TEST_DATABASE_URL` para incluir integración), `pnpm --filter api lint` y `pnpm --filter api build` terminan con exit 0, y la salida se muestra en la conversación.
3. Los 2 reviewers no dejan ningún blocker/critical.
4. `design.md` (decisiones nuevas), `evidence.md` (comandos, resultados y commits nuevos), `checklist.md` (referencias a los tests nuevos en B6, F7 y D1) y `pending-human.md` están actualizados.
5. Se muestra en la conversación un resumen de 5 líneas de lo que cambió.

O frenar a los 50 turnos dejando en `evidence.md` qué falta.
