# NUT-85 — Pendientes que requieren a una persona

Nada de esto bloquea el cierre de código del ticket; sí bloquea el merge o la activación en prod donde se indica.

## Antes del merge (condiciones del PR)

1. **Aprobación del TL para la migración `20261009213000_add_kpi_telemetry`.** `apps/api/vercel.json` corre `pnpm prisma:deploy && pnpm build`, así que cualquier build de Vercel (incluidos los Preview que salen al hacer push) aplica la migración contra la `DATABASE_URL` de ese ambiente.
   - Confirmar antes del push que la DB de los Preview de Vercel es una rama Neon aislada.
   - Después del primer push, no editar `migration.sql`: un cambio va en una migración nueva, porque si no cambia el checksum de una migración ya aplicada.
   - Adjuntar al PR el tamaño de `meal_plans` y `recipes`. Los índices `createdAt` se crean sin `CONCURRENTLY` y bloquean escrituras mientras se crean.
2. **Entrada `kpi:telemetry` y `tsx` en `apps/api/package.json` (le toca a Lara, NUT-86).** Sin eso, el cron `*/30` falla cada 30 minutos en prod apenas se haga merge. Opciones:
   - mergear en el mismo release que el cambio de Lara;
   - o dejar el workflow deshabilitado en GitHub hasta entonces.
3. **`kpi-contract.ts`.** En esta rama hay una versión mínima solo con los tipos textuales del ticket, porque el archivo no existía. Coordinar con Lara: su versión entra primero y esta rama hace rebase, o en el conflicto add/add se toma su archivo sin mezclar contenidos.
4. **GitHub Environments `dev` y `prod`.** Crear el secret `DATABASE_URL` y las variables `KPI_ENV` (`dev`/`prod`) y `KPI_API_BASE_URL`. Si `prod` no existe, GitHub lo crea vacío y el CLI sale con exit 2 (`KPI_ENV_MISSING`).
5. **Variables del backend en Vercel.** `KPI_ENV` es obligatorio (`dev`/`prod`). `KPI_INSTRUMENTATION_ENABLED` es opcional; con `false` se apaga la instrumentación (rollback operativo, requiere redeploy).

## Después del merge

6. **Corrida manual real de la Action en dev** (`workflow_dispatch`, mode sample y luego finalize), con el comando, el resultado y el enlace del run en el cierre del ticket. El workflow hace checkout de la rama default, así que va después del merge.
   - **Verificar con la URL del pooler de Neon** (`pgbouncer=true`) que se escriben filas en `kpi_http_event`/`kpi_dependency_event` y que `/health` responde 200. La corrección D27 saca `statement_timeout` del arranque de la conexión y lo aplica con `SET LOCAL` dentro de cada escritura. Los tests corren contra un Postgres local sin pooler, por eso hay que confirmarlo contra el pooler real.
   - Medir en dev la latencia agregada por la instrumentación con la DB KPI real (peor caso esperado: ~500 ms por request y ~500 ms por intento de Gemini/Unsplash si la DB KPI está lenta).
7. **Integración con el contrato real de Lara** (Composite/Publisher llamando `TelemetryLogger.collect`) y el PR.
8. **Aplicar la migración en dev/prod** con aprobación del TL (lo hace el build de Vercel; ver punto 1).
9. **actionlint** sobre `.github/workflows/kpi-telemetry.yml`. No está instalado localmente; el YAML se validó con un test que lo lee como texto.

## Riesgos aceptados y documentados (no corregidos en esta rama)

- **Fallas del escritor con la instrumentación encendida todavía no se detectan (D31).** El caso de instrumentación apagada (switch `false` o `KPI_ENV` faltante/inválido) ya no publica "0 observado": `/health` lo avisa con `X-KPI-Instrumentation: disabled`, la muestra queda con `reason = INSTRUMENTATION_DISABLED` y los 6 KPIs de eventos salen `unavailable`. Si en cambio la instrumentación está encendida pero el escritor falla (DB KPI caída o rechazando conexiones), `operations_count` puede seguir saliendo `observed` con un subconteo. Mitigación: revisar los logs `KPI_WRITE_FAILED` y el artifact de diagnóstico antes de publicar ese día. Un heartbeat del escritor queda para un ticket aparte.
- **Con la DB caída no se puede guardar la muestra `unhealthy`.** La Action falla visiblemente (exit 1, artifact), pero ese bucket no aparece como caída en `availability_rate`. El contrato lo pide así: no hay backfill ni observaciones ficticias.
- **Sin circuit breaker en el escritor.** Si la DB KPI está lenta, cada escritura espera como máximo 250 ms. Si en dev se ve degradación, evaluar un breaker por instancia en un ticket aparte.
- **El timer de abort de Gemini/Unsplash corre mientras se espera el insert `pending`** (hasta 250 ms menos de presupuesto para el proveedor).
- **`app.enableShutdownHooks()` no está en `main.ts`.** El drain del escritor corre con `app.close()`, no con SIGTERM.
- **Actions del workflow fijadas por tag (`@v4`)**, igual que `ci.yml`, no por SHA.
- **Arranque en frío del escritor (D32).** El timeout de conexión del pool KPI pasó de 150 ms a 1500 ms (`KPI_CONNECT_TIMEOUT_MS`), separado del `query_timeout` de 150 ms. El negocio sigue limitado por la espera de 250 ms, y la escritura termina en vuelo. Falta medirlo en dev (punto 6): la tasa de `KPI_WRITE_FAILED` y `KPI_WRITE_WAIT_EXCEEDED` en arranques en frío de Vercel con Neon. Límite conocido: al apagar, el drain de 1 s puede no esperar una conexión de 1,5 s.
- **Costo de `SET LOCAL` (D27, re-revisión de resiliencia).** Cada escritura KPI hace 4 viajes a la DB (BEGIN, SET LOCAL, escritura, COMMIT). Con el pool de 2 conexiones, bajo carga puede perder eventos (`KPI_WRITE_FAILED`), sin afectar al negocio. Medirlo en la corrida de dev (punto 6). Si molesta, poner el límite del lado del servidor con un rol dedicado (`ALTER ROLE … SET statement_timeout='100ms'`) o usar el endpoint directo de Neon.
- **Transacción huérfana en el pool (adapter-pg 7.9.1).** Si un statement supera el `query_timeout` del cliente (150 ms) antes que el límite del servidor (100 ms), una conexión puede volver al pool con la transacción abierta. El daño está acotado: las escrituras son idempotentes, y una transacción abortada hace que el pool destruya esa conexión. Verificarlo en dev contra el pooler real.
- **Coordinar con Lara (NUT-86):** desde D30, los errores de esquema (SQLSTATE 42xxx, p.ej. migración no aplicada) se propagan desde `collect` como excepción. El Composite tiene que capturarlos por logger.
