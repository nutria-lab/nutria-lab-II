# NUT-85 — Evidencia

Rama local `mariajoserosalestorres/nut-85-implementar-telemetria-tablas-y-migracion-de-kpis-con-github`, creada desde `origin/main` (`9a5890f`) y sin upstream. Sin push, PR, merge ni cambios en Linear. Fecha de cierre: 2026-10-12.

## Commits locales (uno por tanda + correcciones)

| Commit | Tanda | Ítems |
|---|---|---|
| `00ca8cf` | T1 esquema y migración | A1–A4 |
| `917226f` | T2 ventana y fórmulas | E1–E2, F1–F7 |
| `47af740` | T3 escritor, HTTP y /health | B1–B8, D1 |
| `f76f1fa` | T4 dependencias (Gemini/Unsplash) | C1–C2 |
| `468f834` | T5 snapshots, collect, CLI y purga | G1–G4, H1–H6 |
| `3e56d56` | T6 workflow | I1–I3 |
| `f02a765` | Correcciones de la revisión (D27–D30) | B6, D1, F2, G4, H1, H6, I1 |

Flujo por tanda: `nutria_backend_tester` (rojo por la razón correcta: TS2307 por módulos faltantes o aserciones) → `nutria_backend_implementer` (verde) → commit.

## Comandos finales y resultados (2026-10-12, una corrida cada uno, `NODE_OPTIONS=--max-old-space-size=2048`)

```
$ pnpm --filter api test -- --maxWorkers=2
Test Suites: 7 skipped, 74 passed, 74 of 81 total
Tests:       197 skipped, 1369 passed, 1566 total
Time:        45.1 s
exit: 0
```
Las 7 suites salteadas son las de integración: sin `KPI_TEST_DATABASE_URL` hacen skip limpio.

```
$ KPI_TEST_DATABASE_URL=postgresql://kpitest:***@localhost:55432/kpitest \
  pnpm --filter api exec jest src/modules/kpi/tests --runInBand
Test Suites: 29 passed, 29 total
Tests:       713 passed, 713 total
```
Re-ejecutada en la sesión de cierre (2026-10-12, exit 0, 57.8 s; también la corrió el implementer al cerrar la ronda de correcciones), contra el Postgres desechable `nutria-kpi-test-pg` (`postgres:16-alpine`, localhost:55432). Cada suite crea un schema `kpi_it_*` descartable y lo borra.

```
$ pnpm --filter api lint      # prisma generate + tsc --noEmit
✔ Generated Prisma Client (7.9.1)
exit: 0

$ pnpm --filter api build     # prisma generate + nest build
✔ Generated Prisma Client (7.9.1)
exit: 0
```

Migración (A4): `prisma migrate deploy` sobre las bases desechables `kpi_empty` y `kpi_withdata` del mismo contenedor, con `DATABASE_URL` y `DATABASE_URL_UNPOOLED` puestas explícitamente apuntando a localhost. Conteos y md5 de users/recipes/meal_plans iguales antes y después, y `prisma migrate diff` sin diferencias. Detalle en [evidence-t1-a4.md](evidence-t1-a4.md).

Nota de entorno: `apps/api/node_modules/.bin/tsc` era un enlace viejo (creado desde WSL) que apuntaba a TypeScript 5.9.3 y rompía el lint (`TS5103 ignoreDeprecations`). Se borró ese enlace generado: en una instalación limpia no existe y se usa el TS 6.0.3 de la raíz. En un worktree limpio de `origin/main` el lint daba exit 0. No se tocó ningún archivo versionado.

## Mapeo ítem → test (rutas bajo `apps/api/src/modules/kpi/`)

| Ítem | Implementación | Tests |
|---|---|---|
| A1 | `prisma/models/kpi.prisma` | `tests/kpi-schema.spec.ts` |
| A2 | `prisma/migrations/20261009213000_add_kpi_telemetry/migration.sql` (41 CHECK con nombre) | `tests/kpi-migration-sql.spec.ts`, `tests/kpi-constraints.integration.spec.ts` |
| A3 | índices `meal_plans_createdAt_idx`, `recipes_createdAt_idx` | `tests/kpi-migration-sql.spec.ts` (sin DROP/ALTER de negocio) |
| A4 | — | `tests/kpi-migration.integration.spec.ts`, evidence-t1-a4.md |
| B1, B3 | `events/kpi-event-writer.ts`, `http/kpi-http.middleware.ts` | `tests/kpi-http.middleware.spec.ts`, `tests/kpi-event-writer.integration.spec.ts` |
| B2 | `http/http-outcome.ts` | `tests/http-outcome.spec.ts`, `tests/kpi-http.middleware.spec.ts` |
| B4, B5 | `http/http-outcome.ts` | `tests/http-outcome.spec.ts`, `tests/kpi-http.middleware.spec.ts` |
| B6 | `events/kpi-event-writer.ts` (`SET LOCAL statement_timeout`, espera de 250 ms, drain) | `tests/kpi-event-writer.spec.ts`, `tests/kpi-event-writer.integration.spec.ts`, `tests/kpi-http.middleware.spec.ts` |
| B7, B8 | `config/kpi-config.ts`, `kpi.module.ts` | `tests/kpi-config.spec.ts`, `tests/kpi-http.middleware.spec.ts` |
| C1, C2 | `dependencies/dependency-instrumentation.ts`, `plans/gemini/gemini.service.ts`, `unsplash/unsplash.service.ts` | `tests/dependency-instrumentation.spec.ts`, `tests/gemini-instrumentation.spec.ts`, `tests/unsplash-instrumentation.spec.ts`, `tests/regeneration-dependency-attempts.spec.ts`, `tests/dependency-event.integration.spec.ts` |
| D1 | `health/health.controller.ts`, `health/db-health-probe.ts` | `tests/health.controller.spec.ts`, `tests/health-single-flight.spec.ts`, `tests/db-health-probe.spec.ts`, `tests/health.integration.spec.ts` |
| E1, E2 | `window/kpi-window.ts` | `tests/kpi-window.spec.ts` |
| F1–F7 | `calc/telemetry-formulas.ts`, `repo/telemetry.repository.ts` | `tests/telemetry-formulas.spec.ts`, `tests/telemetry-aggregates.integration.spec.ts` |
| G1, G2 | `snapshots/telemetry-snapshot.service.ts` | `tests/telemetry-snapshot.service.spec.ts`, `tests/telemetry-snapshots.integration.spec.ts` |
| G3 | — | `tests/telemetry-snapshots.integration.spec.ts` › G3 (Postgres real) |
| G4 | `telemetry-logger.ts` | `tests/telemetry-logger.spec.ts` (Composite falso), `tests/telemetry-snapshots.integration.spec.ts` |
| H1–H5 | `cli/telemetry-cli.ts`, `apps/api/scripts/kpi/telemetry.ts` | `tests/telemetry-cli.spec.ts`, `tests/telemetry-cli.integration.spec.ts`, `tests/kpi-cli-entrypoint.spec.ts` |
| H6 | `cli/purge-policy.ts` | `tests/purge-policy.spec.ts`, `tests/telemetry-cli.integration.spec.ts` › H6 |
| I1–I3 | `.github/workflows/kpi-telemetry.yml` | `tests/kpi-telemetry-workflow.spec.ts` |
| J1 | `git diff --stat origin/main...HEAD` no incluye ningún `package.json`; `kpi-contract.ts` es la versión mínima con los tipos textuales del ticket (no existía) | revisión del diff |
| J2 | sin columnas de PII/URL/claves; filas con ruta normalizada y nombres fijos de dependencia | `tests/kpi-schema.spec.ts` (PII), `tests/http-outcome.spec.ts` (B4), `tests/dependency-instrumentation.spec.ts` (sin secretos) |
| J3 | — | salidas de test, lint y build de arriba |

## Resumen de la revisión (4 reviewers en paralelo + re-revisión de lo afectado)

| Reviewer | Primera pasada | Después de `f02a765` |
|---|---|---|
| Riesgo | 0 blocker/critical; 3 major (cron rojo sin el script de Lara, /health sin pool, migración aplicada por el build de Vercel), 7 minor | — (los major pasan a pending-human) |
| Legibilidad | 0 blocker/critical; 2 major (descripción "UTC" del input date → corregida; doble espera acotada), 7 minor, 6 nit | — |
| Confiabilidad | **1 critical** (`statement_timeout` como parámetro de arranque con el pooler de Neon), 1 major (D25 impedía recomputar previews históricos), 5 minor | **0 blocker/critical**, 1 minor, 2 nit |
| Resiliencia | **1 critical** (el mismo), 4 major (instrumentación apagada se ve como 0, sin breaker, /health sin single-flight, finalize sobre fechas purgadas), 5 minor | **0 blocker/critical**, 2 minor, 2 nit |

Corregido en `f02a765` con tester → implementer:
- **D27:** `SET LOCAL statement_timeout` dentro de la transacción de cada escritura, sin parámetro de arranque.
- **D28:** /health con single-flight y caché de 5 s.
- **D29:** `PURGED_WINDOW` y corte de purga ≤ D−1.
- **D30:** 408 ⇒ `client_error`; los SQLSTATE estructurales (42xxx, 23xxx salvo 23505) se propagan.
- **D25:** ya no aplica con `--date`.
- Descripción del input `date` del workflow.

Riesgos aceptados y lo que necesita a una persona: [pending-human.md](pending-human.md).

**Veredicto:** no queda ningún hallazgo blocker ni critical.
