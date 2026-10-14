# NUT-85 — Plan de implementación (explorer backend)

Generado: 2026-10-09T21:27:20Z (explorer backend). Rama: `mariajoserosalestorres/nut-85-implementar-telemetria-tablas-y-migracion-de-kpis-con-github`.
Insumos: `ticket.md` (fuente de verdad), `checklist.md` (A1..J3), `design.md` (D1..D24). `bundles/agent-libraries.json` no existe en el repo.
Rutas relativas a la raíz del repo salvo indicación. `api/` = `apps/api/`.

---

## 0. Hechos verificados en el código (referencias)

### 0.1 Registro de módulos, middleware y /health
- `apps/api/src/app.module.ts:10-23` — `AppModule` importa `ConfigModule.forRoot({ isGlobal: true })` (l.12), `PrismaModule` (l.13) y los módulos de negocio. **Acá se agrega `KpiModule`** (único cambio en este archivo).
- `apps/api/src/main.ts:7-22` — `bootstrap()`: `NestFactory.create`, `app.enableCors(...)` (l.10), `app.use(cookieParser())` (l.11), `ValidationPipe` global (l.12-18), `app.listen(PORT)` (l.21). **Sin prefijo global, sin guard global, sin `enableShutdownHooks`**. El archivo tiene BOM al inicio. **No hace falta tocarlo**: el middleware KPI se registra desde el módulo (`NestModule.configure`), que Nest monta en `listen()` *después* de CORS/cookieParser (por eso un preflight `OPTIONS` lo resuelve CORS antes; D8 igual lo excluye).
- **No existe ningún `/health`**: controllers actuales `auth` (`src/modules/auth/auth.controller.ts:20`), `ingredients` (`src/modules/ingredient/ingredient.controller.ts:8`), `nutrition-profile` (`src/modules/nutrition-profile/nutrition-profile.controller.ts:7`), `meal-plans` (`src/modules/plans/plans.controller.ts:13`, regenerate en l.68 `@Post(':planId/regenerate')`), `recipes` (`src/modules/recipe/recipe.controller.ts:9`). Ninguno bajo `/kpi`.
- Versiones: `@nestjs/core` 11.2.1, `@nestjs/platform-express` 11.2.1 (path-to-regexp v8: el comodín es `'*path'` / `'{*splat}'`, no `'*'`), Node local v24.11.1.

### 0.2 Prisma / adapter-pg
- `apps/api/src/prisma/prisma.service.ts:7-24` — `PrismaService extends PrismaClient` (import `@/generated/prisma/client`, l.2), `new Pool({ connectionString: process.env.DATABASE_URL })` (l.10) + `new PrismaPg(pool)` (l.11), sin timeouts. `prisma.module.ts:4-9` es `@Global()`. **El escritor KPI no reutiliza este servicio** (D3): crea su propio `Pool` + `PrismaPg` + `PrismaClient`.
- `apps/api/prisma/schema.prisma` — generator `prisma-client`, `output = "../src/generated/prisma"`, `moduleFormat = "cjs"`; datasource sin URL (la da `prisma.config.ts`).
- `apps/api/prisma.config.ts:2` `import "dotenv/config"`; l.6 `databaseUrl = DATABASE_URL_UNPOOLED || DATABASE_URL`; `schema: "prisma/"`, `migrations.path: "prisma/migrations"`. dotenv **no pisa** variables ya definidas ⇒ para cualquier comando Prisma CLI sobre el Postgres desechable hay que setear **ambas** variables explícitamente (si sólo se setea `DATABASE_URL`, el `DATABASE_URL_UNPOOLED` del `.env` ganaría y apuntaría a Neon).
- Modelos multi-archivo: `apps/api/prisma/models/*.prisma`. Negocio a tocar SOLO con `@@index([createdAt])`:
  - `apps/api/prisma/models/mealPlan.prisma:14` (`createdAt`), bloque de índices l.27-30 (`@@map("meal_plans")` l.30).
  - `apps/api/prisma/models/recipe.prisma:32` (`createdAt`), índices l.37-38 (`@@map("recipes")` l.38).
  - Columnas de negocio en camelCase sin `@map` (`"createdAt"`); nombres por defecto de Prisma ⇒ `meal_plans_createdAt_idx`, `recipes_createdAt_idx`.
- Última migración: `apps/api/prisma/migrations/20260930220304_add_recipe_image`. La nueva debe ser **posterior** (`2026100X......_add_kpi_telemetry`). Ninguna migración califica con `"public".` (verificado: 0 ocurrencias) ⇒ aplicarlas con `search_path` en un schema descartable funciona. Ojo: `20260921121000_enable_unaccent/migration.sql:1` hace `CREATE EXTENSION IF NOT EXISTS unaccent;` (se instala en el primer schema del `search_path`; ver T1 helper).

### 0.3 Deploy ejecuta migraciones
- `apps/api/vercel.json`: `"buildCommand": "pnpm prisma:deploy && pnpm build"`; `apps/api/package.json` `"prisma:deploy": "prisma migrate deploy"`. **Mergear la migración la aplica en el ambiente del deploy** ⇒ gate humano del TL (D18).
- `.github/workflows/ci.yml`: Node `'24'` vía `env.NODE_VERSION`, `pnpm/action-setup@v4`, `actions/setup-node@v4`, `pnpm install --frozen-lockfile`, `pnpm --filter api run prisma:generate`, `pnpm lint`, `pnpm test`, `pnpm build`. Plantilla de estilo para `kpi-telemetry.yml`.

### 0.4 Compilación, lint y tests
- `apps/api/tsconfig.json`: `rootDir ./src`, `baseUrl ./src`, `paths @/* → *`, `include: ["src/**/*.ts"]`, `strict`, `types: ["node","jest"]`, `ignoreDeprecations "6.0"` (TypeScript 6.0.3).
- `apps/api/tsconfig.build.json` excluye `**/*spec.ts` y `**/*.fixture.ts` ⇒ helpers de test van como `*.fixture.ts` (patrón existente: `src/modules/unsplash/unsplash-search.fixture.ts`).
- `api` scripts: `lint = prisma:generate && tsc --noEmit` (**los specs SÍ se typecheckean en lint**), `build = prisma:generate && nest build`, `test = jest`. No hay script `kpi:telemetry` ni `tsx` (pendiente de Lara; prohibido tocar `package.json`).
- `apps/api/jest.config.js`: `rootDir: 'src'`, `testRegex: '.*\\.spec\\.ts$'`, `ts-jest` (con type-check), `moduleNameMapper '^@/(.*)$'`. Los specs importan con rutas relativas o `@/` (ej. `src/modules/plans/tests/gemini-meal-plan.spec.ts:3` relativo). Para KPI: **sólo relativos** (D22).
- Patrón de app Nest real en tests sin supertest: `apps/api/src/config/cors.config.spec.ts:123-135` (`Test.createTestingModule` → `createNestApplication()` → `listen(0, '127.0.0.1')` + `fetch`).
- Patrón de test estático de migración: `apps/api/src/prisma/tests/recipe-image-migration.spec.ts` (lee `migration.sql`/`.prisma` como texto, busca carpeta por patrón de nombre posterior a una baseline).
- Spec focalizada: `pnpm --filter api exec jest --testPathPattern "<patrón>"` (o `pnpm --filter api test -- <patrón>`). Con integración (bash): `KPI_TEST_DATABASE_URL=postgresql://kpitest:kpitest@localhost:55432/kpitest pnpm --filter api exec jest --testPathPattern "<patrón>"`. PowerShell: `$env:KPI_TEST_DATABASE_URL='postgresql://kpitest:kpitest@localhost:55432/kpitest'; pnpm --filter api exec jest --testPathPattern "<patrón>"`.
- Contenedor desechable verificado corriendo: `nutria-kpi-test-pg` en `0.0.0.0:55432->5432`.

### 0.5 Puntos de red externos (para T4)
- **Gemini** — `apps/api/src/modules/plans/gemini/gemini.service.ts`:
  - `GeminiService` l.30, constructor l.34 (`(private configService: ConfigService)`; lanza si falta `GEMINI_API_KEY`).
  - `generateMealPlan` l.42-48 y `generateReplacementMeal` l.51-58 → ambos delegan en **`private async generateText(responseSchema, prompt)` l.61-85** (único punto de ejecución). `AbortController` l.67, `setTimeout(..., TIMEOUT_MS)` l.68 (`TIMEOUT_MS = 15000` l.16), `model.generateContent(..., { signal })` dentro del `try`; `catch` lanza `AiProviderUnavailableError(signal.aborted ? 'AI_TIMEOUT' : 'AI_PROVIDER_ERROR')`; `finally clearTimeout`.
- **Regeneración con 2 llamadas** (cadena exacta):
  `plans.controller.ts:68` → `MealPlanRegenerationService.regenerate` (`meal-plan-regeneration.service.ts:42`) → `regenerateForRun` l.117 → **`firstDifferentProposal(() => this.composer.composeWeeklyProposal(...), ...)` l.122-125** → `proposal-difference.ts:41-50` (`for (attempt = 1; attempt <= maxAttempts(=2); ...) await compose()`) → `GeminiWeeklyProposalComposer.composeWeeklyProposal` (`weekly-proposal.composer.ts:50`, llamada `this.gemini.generateMealPlan(...)` l.53) → `GeminiService.generateText` l.61. **No se instrumenta ninguna de las capas superiores**; las 2 filas salen del contador por request en `generateText`.
  - Otros callers de Gemini: `plans.service.ts:188` (generación inicial vía composer) y `meal-replacement.service.ts:275` (`generateReplacementMeal`).
- **Unsplash** — `apps/api/src/modules/unsplash/unsplash.service.ts`:
  - `resolveWithBoundedConcurrency` l.15 (`UNSPLASH_MAX_CONCURRENT_REQUESTS = 3`), `UNSPLASH_TIMEOUT_MS = 5000` l.46, `UNSPLASH_SEARCH_URL` l.51.
  - `UnsplashService` l.96, constructor l.102 (`(private readonly configService: ConfigService)`).
  - Search: públicos `searchAndSelectCandidate` l.106 y `searchAndSelectImages` l.114 (concurrencia l.132-133) → **`private async searchCandidate(title)` l.215-295**: salidas sin intento (sin key l.217-220, cuota l.224-229) ⇒ sin fila; `AbortController` l.238; **`fetch(url, ...)` l.243** + `response.json()` (~l.262) bajo el mismo `try`; el método **traga todos los errores y devuelve `null`** ⇒ el wrapper NO puede envolver `searchCandidate` entero (perdería la clasificación). Hay que envolver sólo el intercambio de red (fetch + json) — ver T4.
  - Download tracking: **`async trackDownload(persisted)` l.162-212**: sin intento si URL inválida (l.170-175) o sin key (l.177-183); `AbortController` l.185; **`fetch(trackingUrl, ...)` l.189**; `!response.ok` ⇒ FAILED; `catch` AbortError ⇒ timeout; nunca lanza.
  - Callers (no instrumentar): `plans/recipe-images.service.ts:41-43`, `recipe/recipe.service.ts:85`.
- Construcciones manuales que deben seguir compilando sin cambios (dependencia opcional, D9): `prisma/recover-unsplash-tracking.ts:39` (`new UnsplashService(createMinimalConfigService())`), `src/modules/plans/tests/gemini-meal-plan.spec.ts:10`, `gemini-replacement.spec.ts:9`, `plans-update-image-preservation.spec.ts:113`, `plans.service.spec.ts:1023`, `recipe/tests/recipe.service.spec.ts:332`, `unsplash/unsplash.service.spec.ts:83,103,124,138,153`.
- `PlansModule` (`plans/plans.module.ts`) provee `GeminiService`; `UnsplashModule` (`unsplash/unsplash.module.ts`) provee `UnsplashService`. Como `KpiModule` será `@Global()` y exporta el token de instrumentación, **no hace falta tocar esos módulos**.

### 0.6 Contrato de Lara (no se modifica)
- `apps/api/src/modules/kpi/kpi-contract.ts` (60 líneas): `KpiEnvironment` l.5, `KpiId` l.7-17 (10 ids; los 8 de Telemetry son `operations_count, error_rate, latency_p95_ms, health_status, last_success_age_seconds, timeout_rate, dependency_error_rate, availability_rate`), `CollectionContext` l.19-26, `KpiResult` l.28-35, `KpiLogger` l.37-39. Se importa por ruta relativa. **No editar** (J1).

---

## 1. Árbol de archivos nuevos (todos bajo `apps/api/`)

```
prisma/models/kpi.prisma                                   (T1)
prisma/migrations/<YYYYMMDDHHMMSS>_add_kpi_telemetry/migration.sql   (T1)
src/modules/kpi/
  kpi.module.ts                       KpiModule (@Global, NestModule)            (T3)
  kpi.tokens.ts                       KPI_CONFIG, KPI_EVENT_WRITER, DEPENDENCY_INSTRUMENTATION, DB_HEALTH_PROBE (T3)
  config/kpi-config.ts                resolveKpiConfig(env) → {enabled, environment|null, disabledReason}  (T3)
  db/kpi-prisma.ts                    createKpiPrismaClient(url, opts) (Pool max 2, statement_timeout 100, query_timeout 150, connectionTimeoutMillis 150) (T3)
  events/kpi-event-writer.ts          interface KpiEventWriter; PrismaKpiEventWriter; NoopKpiEventWriter; registro en vuelo + drain(1s) (T3)
  http/kpi-request-context.ts         AsyncLocalStorage {operationId, attempts: Map} (T3; usado en T4)
  http/http-outcome.ts                classifyHttpOutcome, normalizeOperation, isExcludedFromTraffic (T3)
  http/kpi-http.middleware.ts         KpiHttpMiddleware (pending → end diferido → UPDATE) (T3)
  health/db-health-probe.ts           DbHealthProbe interface + PgDbHealthProbe (SELECT 1, 2s) (T3; reutilizado por el sampler en T5)
  health/health.controller.ts         @Controller('health') @Get() (T3)
  dependencies/dependency-instrumentation.ts  interface DependencyInstrumentation, NOOP_DEPENDENCY_INSTRUMENTATION, KpiDependencyInstrumentation, classifyDependencyOutcome (T4)
  window/kpi-window.ts                windowForDate, parseReportDate, resolveFinalizeDate, resolvePreviewWindow, scheduledBucket (T2)
  calc/telemetry-formulas.ts          TELEMETRY_KPI_IDS, TelemetryAggregates, buildTelemetryResults, assertFinite (T2)
  repo/telemetry.repository.ts        aggregates SQL, snapshots, health samples, purge (T5; aggregates usados por T2-integración)
  snapshots/telemetry-snapshot.service.ts   preview (upsert, 1 tx) / finalizeCore (RR, insert-only, 3 intentos) (T5)
  telemetry-logger.ts                 TelemetryLogger implements KpiLogger (T5)
  cli/telemetry-cli.ts                runTelemetryCli(argv, env, deps) → exit code (T5)
  cli/health-sampler.ts               API /health 5s + DB probe 2s → muestra (T5)
  cli/purge-policy.ts                 computePurgeCutoff(now) (T5)
  cli/diagnostics.ts                  buildDiagnostics / writeDiagnostics (best effort) (T5)
  tests/kpi-test-db.fixture.ts        helper integración (excluido del build por *.fixture.ts) (T1)
  tests/*.spec.ts                     ver cada tanda
scripts/kpi/telemetry.ts              entrypoint delgado (T5)
.github/workflows/kpi-telemetry.yml   (raíz del repo, T6)
```

Archivos existentes a modificar (y SOLO estos):
- `apps/api/prisma/models/mealPlan.prisma` y `recipe.prisma`: `@@index([createdAt])` (T1).
- `apps/api/src/app.module.ts`: import de `KpiModule` (T3).
- `apps/api/src/modules/plans/gemini/gemini.service.ts` (T4).
- `apps/api/src/modules/unsplash/unsplash.service.ts` (T4).

Prohibido tocar: `package.json` (raíz y api), `kpi-contract.ts`, `vercel.json`, `prisma.config.ts`, `main.ts` (no es necesario), columnas de negocio.

---

## 2. Tandas

Regla para todas: el tester escribe primero el/los `*.spec.ts` y reporta el rojo; el implementer hace el mínimo cambio a verde. Specs bajo `apps/api/src/modules/kpi/tests/` salvo indicación. Unit tests sin red ni DB; integración con `describe.skip` si falta `KPI_TEST_DATABASE_URL` y **fallo explícito** si el host no es `localhost`/`127.0.0.1`/`::1` (D17). Ni los specs ni el módulo KPI importan `dotenv`. Mientras falten módulos, `pnpm --filter api lint` también queda rojo (los specs se typecheckean): esperado en fase roja.

### T1 — Esquema + migración (A1, A2, A3, A4; base de J2)

**Crear**
- `apps/api/prisma/models/kpi.prisma`: `KpiHttpEvent`, `KpiDependencyEvent`, `KpiHealthSample`, `KpiSnapshot`, `KpiPublication` según design §5.1/§5.3/D19 (`@@map("kpi_http_event")` etc.; `String @id @db.Uuid` sin default; `@db.Timestamptz(3)`, `@db.Date`, `@db.DoublePrecision`, `@db.JsonB`, `@db.SmallInt`, `BigInt` para `sample_count`; `@@unique(..., map: "...")` e `@@index(..., map: "...")` con nombres explícitos; sin relaciones; enums como `String`; `updatedAt` con `@default(now())` y sin `@updatedAt`).
- `apps/api/prisma/migrations/<ts>_add_kpi_telemetry/migration.sql`: 5 `CREATE TABLE` sin calificar schema, PK, 4 UNIQUE, índices, todos los CHECK nombrados `kpi_<tabla>_<regla>_check` (design §5.1 + D20/D21), y `CREATE INDEX "meal_plans_createdAt_idx" ON "meal_plans"("createdAt");` + `CREATE INDEX "recipes_createdAt_idx" ON "recipes"("createdAt");`. Nada de DROP/ALTER/TRUNCATE/DELETE/UPDATE/EXTENSION/TRIGGER.
- `apps/api/src/modules/kpi/tests/kpi-test-db.fixture.ts`: `kpiTestDatabaseUrl()` (lee sólo `KPI_TEST_DATABASE_URL`), `assertLocalHost(url)`, `describeIfKpiDb` (= `describe` o `describe.skip`), `createDisposableSchema()` → `kpi_it_<random>`; antes de aplicar migraciones ejecuta `CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA public` y usa `search_path = kpi_it_x, public` (para que `unaccent` no quede dentro de un schema que luego se borra con CASCADE y suites paralelas no choquen); `applyMigrations(client, { upTo?, from? })` lee `prisma/migrations/*/migration.sql` en orden lexicográfico; `dropSchema()` en `afterAll`. Helper para crear `Pool` con `options: '-c search_path=...'`.

**Modificar**
- `apps/api/prisma/models/mealPlan.prisma`: agregar `@@index([createdAt])` en el bloque l.27-30.
- `apps/api/prisma/models/recipe.prisma`: agregar `@@index([createdAt])` en el bloque l.37-38.

**Specs**
- `kpi-schema.spec.ts` (estático, siempre corre)
  - `kpi.prisma define los 5 modelos con @@map a los nombres del contrato`
  - `usa Timestamptz(3), Date, Uuid, DoublePrecision, JsonB y SmallInt donde corresponde`
  - `declara PK, UNIQUE e índices con map explícito`
  - `ningún modelo KPI tiene relaciones (@relation) ni FK`
  - `ninguna columna KPI tiene nombre de PII/URL/clave (user, email, url, token, key, title, query)` (J2)
  - `los modelos de negocio sólo ganan @@index([createdAt]) en meal_plans y recipes`
- `kpi-migration-sql.spec.ts` (estático)
  - `existe exactamente una migración *_add_kpi_telemetry posterior a 20260930220304_add_recipe_image`
  - `crea las 5 tablas kpi_ sin calificar schema`
  - `contiene cada CHECK por nombre` (tabla de nombres esperados, uno por regla de §5.1/D20/D21)
  - `contiene las 4 UNIQUE y los índices con los nombres del esquema Prisma`
  - `crea los índices createdAt de meal_plans y recipes`
  - `no contiene DROP, TRUNCATE, DELETE, UPDATE, RENAME, ALTER COLUMN, ALTER TABLE sobre tablas de negocio, CREATE EXTENSION ni TRIGGER` (A3)
- `kpi-migration.integration.spec.ts` (integración)
  - `schema vacío: aplicar todas las migraciones crea 5 tablas, columnas/tipos, constraints (pg_constraint) e índices (pg_indexes)`
  - `schema con datos: conteos y contenido de users/recipes/meal_plans idénticos antes y después de la migración NUT-85` (aplica hasta la baseline, inserta sintéticos, aplica la nueva, compara ids/updatedAt)
- `kpi-constraints.integration.spec.ts` (integración; `it.each` por regla)
  - `rechaza con 23514 <regla>` y `acepta la contraparte válida de <regla>` para cada CHECK (ciclo de vida pending/terminal, duration≥0/<Infinity, http_status 100..599, status por outcome, finished≥started, attempt≥1, operation 1..200, healthy/unhealthy/unknown, alineación 30 min, measured≥scheduled, snapshot observed/unavailable, %≤100, salud 0/1, NaN/Infinity, publication estados/lote+hash/64 hex minúscula/accepted_at/delivered_at/attempt_count 0..3, window_start<window_end)
  - `UNIQUE duplicada ⇒ 23505` (dependency, health, snapshot, publication)

**Comando focalizado**
`KPI_TEST_DATABASE_URL=postgresql://kpitest:kpitest@localhost:55432/kpitest pnpm --filter api exec jest --testPathPattern "modules/kpi/tests/kpi-(schema|migration|constraints)"` y además sin la variable (las de integración deben quedar skipped). `pnpm --filter api run prisma:generate` debe pasar.

**Generación de la migración (sin bases compartidas)** — en una base scratch del contenedor, ambas variables explícitas:
```bash
docker exec nutria-kpi-test-pg psql -U kpitest -d kpitest -c "CREATE DATABASE kpi_scratch"
export KPI_LOCAL=postgresql://kpitest:kpitest@localhost:55432/kpi_scratch
cd apps/api
DATABASE_URL=$KPI_LOCAL DATABASE_URL_UNPOOLED=$KPI_LOCAL pnpm exec prisma migrate status   # confirmar que dice localhost:55432 / kpi_scratch
DATABASE_URL=$KPI_LOCAL DATABASE_URL_UNPOOLED=$KPI_LOCAL pnpm exec prisma migrate deploy   # aplica las 11 existentes (ANTES de crear la carpeta nueva)
DATABASE_URL=$KPI_LOCAL DATABASE_URL_UNPOOLED=$KPI_LOCAL pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma --script   # base del SQL; luego agregar CHECKs a mano
```
(Verificar los nombres de flags de `migrate diff` con `pnpm exec prisma migrate diff --help` en Prisma 7.9; alternativa: `prisma migrate dev --create-only --name add_kpi_telemetry` con las mismas dos variables apuntando a `kpi_scratch`.)

**A4 — evidencia manual `migrate deploy` (implementer, no el explorer)**
```bash
# 1) bases desechables
docker exec nutria-kpi-test-pg psql -U kpitest -d kpitest -c "CREATE DATABASE kpi_empty"
docker exec nutria-kpi-test-pg psql -U kpitest -d kpitest -c "CREATE DATABASE kpi_withdata"
cd apps/api
E=postgresql://kpitest:kpitest@localhost:55432/kpi_empty
W=postgresql://kpitest:kpitest@localhost:55432/kpi_withdata
# 2) base vacía: todas las migraciones
DATABASE_URL=$E DATABASE_URL_UNPOOLED=$E pnpm exec prisma migrate status
DATABASE_URL=$E DATABASE_URL_UNPOOLED=$E pnpm exec prisma migrate deploy
# 3) base con datos: primero sólo las 11 previas
#    Opción preferida: correrlo ANTES de crear la carpeta *_add_kpi_telemetry.
#    Si la carpeta ya existe: aplicar con psql los 11 migration.sql en orden y marcarlos con
#    `DATABASE_URL=$W DATABASE_URL_UNPOOLED=$W pnpm exec prisma migrate resolve --applied <nombre>` para cada uno.
#    Insertar sintéticos (columnas camelCase entre comillas):
docker exec nutria-kpi-test-pg psql -U kpitest -d kpi_withdata -c "INSERT INTO users (id,email,\"passwordHash\",\"updatedAt\") VALUES ('u1','a@example.test','x',now()),('u2','b@example.test','x',now()); INSERT INTO recipes (id,title,description,\"prepMinutes\",\"cookMinutes\",ingredients,instructions,\"updatedAt\") VALUES ('r1','t','d',1,1,'[]','{}',now()); INSERT INTO meal_plans (id,\"userId\",\"startDate\",\"endDate\",\"updatedAt\") VALUES ('p1','u1',now(),now(),now());"
docker exec nutria-kpi-test-pg psql -U kpitest -d kpi_withdata -c "SELECT (SELECT count(*) FROM users) u,(SELECT count(*) FROM recipes) r,(SELECT count(*) FROM meal_plans) p, md5(string_agg(id||\"updatedAt\"::text, ',' ORDER BY id)) FROM users"
DATABASE_URL=$W DATABASE_URL_UNPOOLED=$W pnpm exec prisma migrate deploy        # aplica sólo NUT-85
# repetir el SELECT de conteos/huella; deben ser iguales
# 4) verificación de estructura en ambas
docker exec nutria-kpi-test-pg psql -U kpitest -d kpi_empty -c "\dt kpi_*" -c "SELECT conname FROM pg_constraint WHERE conrelid::regclass::text LIKE 'kpi_%' ORDER BY 1" -c "SELECT indexname FROM pg_indexes WHERE tablename LIKE 'kpi_%' OR indexname LIKE '%createdAt_idx' ORDER BY 1"
# 5) sin drift Prisma (CHECK invisibles para Prisma; índices/uniques deben coincidir)
DATABASE_URL=$E DATABASE_URL_UNPOOLED=$E pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma --exit-code
```
PowerShell equivalente: `$env:DATABASE_URL='postgresql://kpitest:kpitest@localhost:55432/kpi_empty'; $env:DATABASE_URL_UNPOOLED=$env:DATABASE_URL; pnpm --filter api exec prisma migrate deploy` (cada llamada al tool es un proceso nuevo, las variables no persisten). Nunca correr sin las dos variables: el `.env` de la API apunta a Neon.

**Criterio de cierre T1**: las 4 specs verdes con DB (y las 2 de integración skipped sin DB); `prisma generate` OK; salida de A4 (vacía + con datos, conteos iguales, `migrate diff --exit-code` = 0) pegada en evidence; revisión del SQL citada para A3.

---

### T2 — Ventana temporal + fórmulas (E1, E2, F1-F7)

**Crear**: `src/modules/kpi/window/kpi-window.ts`, `src/modules/kpi/calc/telemetry-formulas.ts`, y la parte de agregados de `src/modules/kpi/repo/telemetry.repository.ts` (`loadAggregates(env, window)`: conteos por outcome HTTP terminal en `[start,end)` por `finished_at`, `percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms)`, `max(finished_at)` de success con `finished_at < end`, conteos de dependencias, última muestra de salud por `measured_at DESC, scheduled_for DESC`, conteo healthy/unhealthy, `http_pending_incomplete`). SQL parametrizado vía `$queryRaw` con tablas sin calificar.
- Ventana con `Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', ... })` para resolver offset por instante (D11); sin librerías nuevas.

**Specs**
- `kpi-window.spec.ts` (unit)
  - `D=2026-10-09 ⇒ 2026-10-09T03:00:00.000Z – 2026-10-10T00:00:00.000Z` (E1)
  - `sin fecha a 2026-10-10T00:05Z ⇒ D=2026-10-09`
  - `scheduler atrasado a 2026-10-10T02:00Z ⇒ D=2026-10-09`
  - `a 2026-10-09T23:59Z ⇒ D=2026-10-08`
  - `fecha explícita cuyo corte no ocurrió ⇒ FUTURE_CUT`
  - `fecha mal formada o inexistente (2026-02-30, 2026-1-5) ⇒ rechazo`
  - `preview: end = min(now, 21:00 D); start(D) > now ⇒ FUTURE_DATE; end ≤ start ⇒ NO_POSITIVE_WINDOW`
  - `bucket = floor(now/30min) en UTC`
- `telemetry-formulas.spec.ts` (unit)
  - `devuelve exactamente los 8 códigos de Telemetry ordenados por kpi_id`
  - `10 operaciones con 1 timeout y 1 server_error ⇒ error_rate 20, timeout_rate 10` (F2)
  - `client_error y other suman al denominador pero no a errores` (F2)
  - `0 operaciones ⇒ operations_count observed 0 y error/timeout/p95 unavailable NO_OPERATIONS` (F7)
  - `p95 del agregado pasa tal cual` (F1 unit)
  - `2 fallos sobre 8 intentos ⇒ dependency_error_rate 25; 0 intentos ⇒ NO_DEPENDENCY_ATTEMPTS` (F3)
  - `last_success_age_seconds = (end − max finished_at)/1000; sin éxito ⇒ NO_SUCCESS_KNOWN` (F4)
  - `health_status: healthy=1, unhealthy=0; última unknown ⇒ HEALTH_UNKNOWN; >60 min ⇒ HEALTH_SAMPLE_STALE; exactamente 60 min ⇒ válida; sin muestras ⇒ NO_HEALTH_SAMPLE` (F5)
  - `availability: 2 healthy + 1 unhealthy (+unknown) ⇒ 66.666…; sólo unknown ⇒ NO_VALID_HEALTH_SAMPLES` (F6)
  - `unavailable ⇒ value null y reason no vacío; NaN/Infinity ⇒ throw KPI_NON_FINITE` (F7)
- `telemetry-aggregates.integration.spec.ts` (integración)
  - `20 duraciones 1..20 ms ⇒ p95 = 19` (F1)
  - `fixtures F2 sobre la DB: pending excluidos, 4xx no suma errores`
  - `F3 sobre la DB`
  - `éxito anterior a start se usa para last_success_age` (F4)
  - `muestras insertadas fuera de orden: toma la de mayor measured_at` (F5)
  - `F6 sobre la DB`
  - `filtra por ambiente`

**Comando**: `KPI_TEST_DATABASE_URL=... pnpm --filter api exec jest --testPathPattern "modules/kpi/tests/(kpi-window|telemetry-formulas|telemetry-aggregates)"`.
**Cierre T2**: verde con y sin DB; E1/E2/F1-F7 marcables.

---

### T3 — Escritor + HTTP + /health (B1-B8, D1)

**Crear**: `kpi.tokens.ts`, `config/kpi-config.ts`, `db/kpi-prisma.ts`, `events/kpi-event-writer.ts`, `http/kpi-request-context.ts`, `http/http-outcome.ts`, `http/kpi-http.middleware.ts`, `health/db-health-probe.ts`, `health/health.controller.ts`, `kpi.module.ts`.
- `kpi.module.ts`: `@Global() @Module({ controllers: [HealthController], providers: [KPI_CONFIG (useFactory: resolveKpiConfig(process.env) + log único KPI_ENV_MISSING/KPI_ENV_INVALID/KPI_SWITCH_INVALID), KPI_EVENT_WRITER (Noop si deshabilitado; pool lazy), DEPENDENCY_INSTRUMENTATION (T4), DB_HEALTH_PROBE, KpiHttpMiddleware, TelemetryLogger (T5)], exports: [DEPENDENCY_INSTRUMENTATION, TelemetryLogger] })`, `implements NestModule, OnApplicationShutdown` con `configure(consumer) { consumer.apply(KpiHttpMiddleware).forRoutes({ path: '*path', method: RequestMethod.ALL }) }` y drain acotado (1 s) del registro en vuelo. El tester debe confirmar con un 404 de ruta inexistente que el middleware corre también sin match (B2); si no, alternativa documentada: `forRoutes('{*splat}')`.
- Middleware: `operation` al cierre = `req.method + ' ' + (req.baseUrl + req.route.path)` si `req.route` existe, si no `UNMATCHED`; insert con `UNRESOLVED` (D7). Exclusiones: path `/health`, prefijo `/kpi`, método `OPTIONS` (D8). Intercepta `res.end`; escucha `res.on('close')` sin `writableFinished` ⇒ `network_error`; `req.setTimeout`/`res` timeout del server ⇒ `timeout`.
- Escritor: `pg.Pool({ connectionString: DATABASE_URL, max: 2, connectionTimeoutMillis: 150, query_timeout: 150, statement_timeout: 100 })` + `PrismaPg` + `PrismaClient` de `../../generated/prisma/client` (relativo). Close: `UPDATE kpi_http_event SET ... WHERE id = $1 AND outcome = 'pending'`. Riesgo a verificar por implementer/reviewers: si el pooler de Neon rechaza el parámetro de arranque `statement_timeout`, usar `SET statement_timeout` en el evento `pool.on('connect')` (sigue siendo de sesión, no por escritura).
- Health: `@Controller('health') @Get() @Header('Cache-Control','no-store')`; 503 con `res.status(503)` o `ServiceUnavailableException({status:'error',database:'error'})` (Nest serializa el objeto tal cual). Sonda con `pg.Client` efímero (`connectionTimeoutMillis/query_timeout/statement_timeout` 2000 + deadline 2 s, `end()` en `finally`). No depende de `KPI_CONFIG` ni de módulos de IA.

**Modificar**: `apps/api/src/app.module.ts:11-19` — agregar `KpiModule` a `imports`.

**Specs**
- `kpi-config.spec.ts` (unit; B7, B8, D1, D2)
  - `KPI_ENV ausente ⇒ deshabilitado con KPI_ENV_MISSING`
  - `KPI_ENV 'production' | 'PROD' | ' prod' ⇒ KPI_ENV_INVALID sin incluir el valor`
  - `NODE_ENV=production sin KPI_ENV no habilita nada`
  - `dev|qa|prod válidos ⇒ habilitado`
  - `KPI_INSTRUMENTATION_ENABLED=false ⇒ deshabilitado; valor inválido ⇒ deshabilitado + KPI_SWITCH_INVALID; ausente/true ⇒ habilitado`
- `http-outcome.spec.ts` (unit puro; B2, B4, D6, D7)
  - `200⇒success, 404⇒client_error, 500⇒server_error, 408/504⇒timeout, 503⇒server_error, 1xx/3xx⇒other`
  - `socket cerrado ⇒ network_error con http_status null`
  - `normalizeOperation usa método + plantilla, sin query, sin barra final, ≤200 chars`
  - `URL con UUID, token y query nunca aparece en operation`
  - `sin ruta ⇒ UNMATCHED; pending ⇒ UNRESOLVED`
  - `excluye /health, /kpi/* y OPTIONS`
- `kpi-http.middleware.spec.ts` (unit con app Nest real `listen(0)` + `fetch`, escritor fake; patrón `src/config/cors.config.spec.ts:123-135`)
  - `inserta pending antes del handler y cierra el mismo id UUID con duration ≥ 0` (B1)
  - `200/404/ruta inexistente/500/408/504 cierran con el outcome esperado` (B2)
  - `cliente que corta el socket ⇒ network_error` (B2)
  - `handler que nunca termina ⇒ sólo existe el insert pending` (B2)
  - `operation es la plantilla de ruta (GET /meal-plans/:planId…)` (B4)
  - `/health, /kpi y OPTIONS no llaman al escritor` (B5)
  - `escritor lento: la respuesta llega con el status de negocio dentro del límite acotado` (B6)
  - `escritor que falla: status de negocio intacto y log con código técnico` (B6)
  - `tras la respuesta el registro en vuelo queda vacío` (B6)
  - `instrumentación deshabilitada ⇒ 0 llamadas al escritor y la ruta responde igual` (B8)
- `kpi-event-writer.spec.ts` (unit, cliente fake + fake timers; B6)
  - `nunca rechaza ante error del cliente`
  - `resuelve en ≤ 250 ms aunque la query no termine y limpia el temporizador`
  - `loguea KPI_WRITE_TIMEOUT/KPI_WRITE_FAILED/KPI_WRITE_WAIT_EXCEEDED con SQLSTATE sin mensaje ni URL`
  - `cierre duplicado no hace INSERT (sólo UPDATE condicional)` (B3 unit)
- `kpi-event-writer.integration.spec.ts` (integración; B1, B3, B6)
  - `pending + close actualizan la misma fila (una sola fila)`
  - `segundo cierre afecta 0 filas y no cambia outcome/finished_at/http_status` (B3)
  - `con la tabla bloqueada por otra conexión ⇒ KPI_WRITE_TIMEOUT en ~100 ms y espera total ≤ 250 ms` (B6)
- `health.controller.spec.ts` (unit con sonda fake; D1)
  - `sonda ok ⇒ 200 {"status":"ok","database":"ok"} con Cache-Control no-store`
  - `sonda error ⇒ 503 {"status":"error","database":"error"} sin mensaje de error`
  - `sonda > 2 s ⇒ 503 (fake timers)`
  - `funciona con KPI_ENV ausente e instrumentación apagada`
- `health.integration.spec.ts` (integración)
  - `SELECT 1 real ⇒ 200`
  - `URL a puerto cerrado ⇒ 503 en ≤ 2 s + margen`

**Comando**: `pnpm --filter api exec jest --testPathPattern "modules/kpi/tests/(kpi-config|http-outcome|kpi-http.middleware|kpi-event-writer|health)"` (+ variante con `KPI_TEST_DATABASE_URL`). Correr además la suite completa: `pnpm --filter api test` (no deben romperse specs existentes por el import de `KpiModule`).
**Cierre T3**: verde con y sin DB; B1-B8 y D1 marcables.

---

### T4 — Dependencias (C1, C2)

**Crear**: `src/modules/kpi/dependencies/dependency-instrumentation.ts`
- `interface DependencyInstrumentation { run<T>(dependency: 'gemini'|'unsplash_search'|'unsplash_download', call: (signal-agnóstico) => Promise<T>, classify: (r: { ok: true; value: T } | { ok: false; error: unknown }) => 'success'|'error'|'timeout'): Promise<T> }`.
- `NOOP_DEPENDENCY_INSTRUMENTATION` (ejecuta `call()` directo). `KpiDependencyInstrumentation` usa `kpi-request-context` (operation_id/attempts; fuera de request ⇒ UUID nuevo por invocación), incrementa `attempt` **sincrónicamente** antes del primer `await`, `insertDependencyPending` → `call()` → `closeDependency`, y devuelve/relanza exactamente lo mismo.

**Modificar**
- `apps/api/src/modules/plans/gemini/gemini.service.ts`
  - Constructor l.34: agregar `@Optional() @Inject(DEPENDENCY_INSTRUMENTATION) private readonly instrumentation: DependencyInstrumentation = NOOP_DEPENDENCY_INSTRUMENTATION` (import relativo `../../kpi/...`).
  - `generateText` l.61-85: envolver **sólo** `model.generateContent(...)` (dentro del `try` existente) con `this.instrumentation.run('gemini', () => model.generateContent(...), r => r.ok ? 'success' : (abortController.signal.aborted ? 'timeout' : 'error'))`. El `catch`/`finally` existentes quedan iguales.
  - `generateMealPlan` l.42 / `generateReplacementMeal` l.51: sin cambios.
- `apps/api/src/modules/unsplash/unsplash.service.ts`
  - Constructor l.102: mismo parámetro opcional (import relativo `../kpi/...`).
  - `searchCandidate` l.215-295: extraer el intercambio de red (fetch l.243 + chequeo de status + `response.json()`) a un paso envuelto con `run('unsplash_search', ...)` cuya clasificación sea: 200 + JSON leído ⇒ success (incluye 0 resultados); status ≠ 200 ⇒ error; abort ⇒ timeout; otro error/JSON inválido ⇒ error. El método conserva su contrato (devuelve `null` en fallas, mismos logs, `applyQuotaFromResponse` igual). Las salidas tempranas (sin key l.217-220, cuota l.224-229) quedan **antes** del wrapper ⇒ sin fila.
  - `trackDownload` l.162-212: envolver sólo el `fetch(trackingUrl, ...)` l.189 con `run('unsplash_download', ...)`: `response.ok` ⇒ success, no ok ⇒ error, abort ⇒ timeout, otro ⇒ error. Validación de URL (l.170) y key (l.177) antes del wrapper. Sigue sin lanzar.
  - `resolveWithBoundedConcurrency` l.15, `searchAndSelectCandidate` l.106, `searchAndSelectImages` l.114: sin cambios.
- No tocar: `weekly-proposal.composer.ts`, `proposal-difference.ts`, `meal-plan-regeneration.service.ts`, `meal-replacement.service.ts`, `plans.service.ts`, `recipe-images.service.ts`, `recipe.service.ts`, `plans.module.ts`, `unsplash.module.ts`, `prisma/recover-unsplash-tracking.ts`.

**Specs**
- `dependency-instrumentation.spec.ts` (unit; C1, C2)
  - `noop ejecuta la llamada sin escribir`
  - `attempts 1,2,3 por (operation_id, dependency) dentro de una request`
  - `concurrencia 3 produce attempts únicos`
  - `fuera de request genera un operation_id nuevo por invocación`
  - `abort por timeout ⇒ timeout; error ⇒ error; ok ⇒ success`
  - `devuelve el mismo valor y relanza el mismo error`
  - `deshabilitada ⇒ 0 llamadas al escritor`
  - `las filas no contienen URL, query ni claves`
- `gemini-instrumentation.spec.ts` (unit, SDK mockeado como en `plans/tests/gemini-meal-plan.spec.ts:9-13`)
  - `generateMealPlan y generateReplacementMeal llaman al wrapper con 'gemini' una vez por llamada`
  - `timeout del AbortController ⇒ outcome timeout y sigue lanzando AiProviderUnavailableError('AI_TIMEOUT')`
  - `error del SDK ⇒ outcome error`
  - `construido sin instrumentación (new GeminiService(config)) funciona igual`
- `unsplash-instrumentation.spec.ts` (unit, `fetch` mockeado como en `unsplash/unsplash.service.spec.ts`)
  - `search 200 (incluso sin resultados) ⇒ success con 'unsplash_search'`
  - `search 403/500 ⇒ error; abort ⇒ timeout; JSON inválido ⇒ error`
  - `sin key o cuota agotada ⇒ wrapper no se llama`
  - `trackDownload ok ⇒ success con 'unsplash_download'; no ok ⇒ error; abort ⇒ timeout`
  - `URL de tracking inválida o sin key ⇒ wrapper no se llama`
  - `searchAndSelectImages con 4 títulos ⇒ 4 attempts únicos en la misma request`
- `regeneration-dependency-attempts.spec.ts` (unit; C2)
  - `una regeneración que genera 2 propuestas produce attempts 1 y 2 de gemini con el mismo operation_id` (composer real `GeminiWeeklyProposalComposer` + `GeminiService` con SDK mock que devuelve dos veces la misma propuesta, dentro de un contexto de request; reutilizar la base en memoria de `plans/tests/meal-plan-regeneration.flow.spec.ts` o fakes equivalentes)
  - `el composer y los servicios de plan no llaman al wrapper` (espía)
- `dependency-event.integration.spec.ts` (integración)
  - `UNIQUE (environment, operation_id, dependency, attempt) rechaza attempt repetido`
  - `pending + close de dependencia sobre la DB real`

**Comando**: `pnpm --filter api exec jest --testPathPattern "(modules/kpi/tests/(dependency|gemini-instrumentation|unsplash-instrumentation|regeneration-dependency)|modules/plans/tests/gemini|modules/unsplash|modules/plans/tests/meal-plan-regeneration|modules/recipe/tests/recipe.service)"` — incluye las specs existentes que construyen los adaptadores a mano.
**Cierre T4**: verde; specs existentes de Gemini/Unsplash/regeneración intactas y verdes; C1/C2 marcables.

---

### T5 — Snapshots + collect + CLI + purga (G1-G4, H1-H6)

**Crear**: completar `repo/telemetry.repository.ts` (upsert preview en 1 tx con `ON CONFLICT (environment, report_date, window_end, snapshot_kind, kpi_id) DO UPDATE`; lectura de finales; insert plano de finales; `insertHealthSample ... ON CONFLICT (environment, scheduled_for) DO NOTHING`; `purgeBatch(table, env, cutoff)` con `DELETE ... WHERE id IN (SELECT id ... LIMIT 1000)`), `snapshots/telemetry-snapshot.service.ts` (`preview`, `finalizeCore` con `$transaction(..., { isolationLevel: 'RepeatableRead' })`, reintento ante 23505/40001, máx 3, `KPI_FINAL_INCOMPLETE`, `KPI_FINALIZE_CONFLICT`; barrera inyectable entre lectura e inserción para G3), `telemetry-logger.ts` (`TelemetryLogger implements KpiLogger` de `../kpi-contract` o `./kpi-contract`, validaciones D15, traducción `SOURCE_UNAVAILABLE` sin persistir), `cli/health-sampler.ts`, `cli/purge-policy.ts`, `cli/diagnostics.ts`, `cli/telemetry-cli.ts` (`runTelemetryCli(argv, env, deps): Promise<number>`; códigos 0/1/2 de D23; `--mode`, `--environment`, `--date`, `--diagnostics-out`; diagnóstico en `finally`).
- `apps/api/scripts/kpi/telemetry.ts` (fuera de `rootDir`/`include` ⇒ ni `tsc --noEmit` ni `nest build` lo ven). Para minimizar el riesgo: (1) ≤ ~15 líneas, **sin lógica**; (2) un único import relativo `../../src/modules/kpi/cli/telemetry-cli` (sin `@/`, sin `dotenv`); (3) `runTelemetryCli(process.argv.slice(2), process.env, createDefaultDeps()).then(code => { process.exitCode = code; })`, y `createDefaultDeps` vive en `src` (typecheckeado); (4) todo el módulo KPI usa imports relativos para que `tsx` lo resuelva sin `paths`; (5) spec estático + typecheck dirigido (abajo); (6) evidencia manual: `pnpm --filter api exec tsc --noEmit --strict --module commonjs --target ES2021 --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --skipLibCheck --types node scripts/kpi/telemetry.ts`.
- `TelemetryLogger` registrado/exportado en `kpi.module.ts` (T3).

**Specs**
- `telemetry-snapshot.service.spec.ts` (unit, repo fake; G2, G4)
  - `finalize con 8 finales existentes los devuelve sin recalcular`
  - `1..7 finales ⇒ KPI_FINAL_INCOMPLETE`
  - `23505/40001 ⇒ reintenta y devuelve los del ganador; 3 conflictos ⇒ KPI_FINALIZE_CONFLICT`
  - `finalize no toma muestra de salud` (H4)
- `telemetry-logger.spec.ts` (unit con Composite falso; G4)
  - `devuelve exactamente los 8 códigos de Telemetry ordenados por kpi_id`
  - `usa el corte del contexto aunque el reloj esté horas después`
  - `contract_version ≠ '1', environment ≠ KPI_ENV, ventana no canónica o corte futuro ⇒ throw`
  - `fuente caída ⇒ 8 unavailable SOURCE_UNAVAILABLE sin persistir`
  - `Composite falso: conjunto de ids disjunto con initial_plans_count/manual_recipes_count y completo con ellos`
  - `comparte el núcleo de finalize (espía)`
- `telemetry-cli.spec.ts` (unit, deps fake: reloj, sonda API, sonda DB, repo, writer de diagnóstico)
  - `argumentos inválidos ⇒ exit 2`
  - `KPI_ENV faltante/inválido/distinto de --environment ⇒ exit 2 sin escrituras` (B7)
  - `KPI_API_BASE_URL faltante en sample ⇒ exit 2`
  - `sample: bucket floor(now/30min); API 5 s y DB 2 s` (H1)
  - `timeout o 5xx de API ⇒ unhealthy con reason` (H1)
  - `bucket ya registrado ⇒ exit 0, inserted:false, SAMPLE_BUCKET_ALREADY_RECORDED` (H1)
  - `nunca crea buckets anteriores` (H1)
  - `no se puede guardar la muestra ⇒ exit 1 sin observación ficticia` (H2)
  - `preview con end = min(now, 21:00 D); sin intervalo positivo ⇒ sólo muestra y exit 0` (H3)
  - `finalize no inserta en kpi_health_sample ni usa 21:00 como measured_at` (H4)
  - `--date con corte futuro ⇒ exit 2 FUTURE_CUT`
  - `diagnóstico siempre escrito (también ante fallo) con los campos de D24 y sin DATABASE_URL, KPI_API_BASE_URL ni mensajes de excepción` (H5)
  - `fallo de telemetría ⇒ exit 1` (H5)
- `purge-policy.spec.ts` (unit; H6)
  - `antes de 2027-01-01 no purga`
  - `2027-04-02 ⇒ corte = 2027-04-01 local`
  - `2027-01-01T00:10Z (todavía 2026-12-31 en AR) no purga ni toca el día en preparación`
  - `2500 filas ⇒ 3 lotes de ≤ 1000; tope 100 lotes`
- `kpi-cli-entrypoint.spec.ts` (estático)
  - `scripts/kpi/telemetry.ts sólo importa ../../src/modules/kpi/cli/telemetry-cli`
  - `no importa dotenv ni usa @/`
  - `setea process.exitCode con el resultado de runTelemetryCli`
  - `typecheckea sin errores` (API de `typescript` — `ts.createProgram([entry], { strict, module: CommonJS, target: ES2021, esModuleInterop, experimentalDecorators, emitDecoratorMetadata, skipLibCheck, types: ['node'], noEmit })` y `getPreEmitDiagnostics` vacío; `typescript` ya está resuelto por ts-jest, no se agrega dependencia)
- `telemetry-snapshots.integration.spec.ts` (integración)
  - `preview escribe los 8 en una transacción; si uno falla no queda ninguno` (G1)
  - `repetir el preview del mismo corte no duplica; dos cortes ⇒ 16 filas` (G1)
  - `finalize corre en REPEATABLE READ (current_setting('transaction_isolation'))` (G2)
  - `con finales existentes no recalcula aunque cambien los eventos y no los modifica` (G2)
  - `dos finalizaciones forzadas a solaparse con barrera ⇒ 8 finales iguales de una sola corrida (mismo measured_at)` (G3)
  - `20 pares de finalize en paralelo sin barrera ⇒ siempre 8 finales` (G3)
  - `collect sobre la DB con Composite falso` (G4)
- `telemetry-cli.integration.spec.ts` (integración)
  - `sample ON CONFLICT DO NOTHING conserva la muestra original (mismo measured_at)` (H1)
  - `DB inaccesible (puerto cerrado) ⇒ exit 1 y sin fila` (H2)
  - `purga: lotes de 1000, kpi_publication intacta, otro ambiente intacto, día en preparación intacto` (H6)

**Comando**: `KPI_TEST_DATABASE_URL=... pnpm --filter api exec jest --testPathPattern "modules/kpi/tests/(telemetry-|purge-policy|kpi-cli-entrypoint)"` (+ sin la variable).
**Cierre T5**: verde con y sin DB; G1-G4 y H1-H6 marcables; typecheck del entrypoint OK. El entrypoint no puede ejecutarse localmente vía `pnpm --filter api kpi:telemetry` hasta que Lara agregue el script y `tsx` (pendiente humano).

---

### T6 — Workflow (I1-I3)

**Crear**: `.github/workflows/kpi-telemetry.yml` (raíz del repo) siguiendo el estilo de `.github/workflows/ci.yml`:
- `on.schedule: - cron: '*/30 * * * *'`; `workflow_dispatch.inputs`: `environment` (choice `dev`/`prod`), `mode` (choice `sample`/`finalize`), `date` (string, `required: false`).
- `permissions: contents: read`; job con `environment: ${{ github.event_name == 'schedule' && 'prod' || inputs.environment }}`; `concurrency: { group: kpi-telemetry-<ambiente efectivo>, cancel-in-progress: false }`; `timeout-minutes: 10`.
- Pasos: `actions/checkout@v4` con `ref: ${{ github.event.repository.default_branch }}`; `pnpm/action-setup@v4`; `actions/setup-node@v4` con `node-version: '24'`; `pnpm install --frozen-lockfile`; `pnpm --filter api run prisma:generate`; ejecutar `pnpm --filter api kpi:telemetry --mode "$MODE" --environment "$ENVIRONMENT" ${DATE:+--date "$DATE"} --diagnostics-out "$RUNNER_TEMP/kpi-diagnostics"` con `env:` (`MODE`, `ENVIRONMENT`, `DATE` desde inputs/ternario; `DATABASE_URL: ${{ secrets.DATABASE_URL }}`, `KPI_ENV: ${{ vars.KPI_ENV }}`, `KPI_API_BASE_URL: ${{ vars.KPI_API_BASE_URL }}`) — nunca interpolar inputs en `run:`; `actions/upload-artifact@v4` con `if: always()`, `path: ${{ runner.temp }}/kpi-diagnostics`, `retention-days: 90`.
- Sin `migrate`, `seed`, `db push`.

**Specs**
- `kpi-telemetry-workflow.spec.ts` (estático; lee `path.resolve(__dirname, '../../../../../.github/workflows/kpi-telemetry.yml')` como texto, sin librerías YAML)
  - `cron exacto */30 * * * *`
  - `workflow_dispatch con environment (dev/prod), mode (sample/finalize) y date opcional`
  - `schedule resuelve prod y sample`
  - `el job usa environment: con el ambiente efectivo`
  - `concurrency por ambiente con cancel-in-progress false`
  - `permissions contents: read y timeout-minutes 10`
  - `checkout del default branch, Node 24 y pnpm install --frozen-lockfile`
  - `prisma generate aparece antes de kpi:telemetry`
  - `no contiene migrate, seed ni db push`
  - `inputs llegan por env y no se interpolan ${{ inputs.* }} dentro de run:`
  - `upload-artifact con if: always() y retention-days: 90`
  - `secrets.* ⊆ {DATABASE_URL} y vars.* ⊆ {KPI_ENV, KPI_API_BASE_URL}`

**Comando**: `pnpm --filter api exec jest --testPathPattern "modules/kpi/tests/kpi-telemetry-workflow"`. Evidencia opcional: `actionlint` si está instalado o `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7`.
**Cierre T6**: spec verde; (actionlint limpio si se corrió). La ejecución real en dev es pendiente humano post-merge.

---

## 3. Cierre global — J1-J3

- **J1**: `git diff --stat main...HEAD` y `git status` (sólo lectura) en la evidencia; deben aparecer únicamente: `apps/api/prisma/models/{kpi,mealPlan,recipe}.prisma`, la carpeta `*_add_kpi_telemetry`, `apps/api/src/app.module.ts`, `gemini.service.ts`, `unsplash.service.ts`, `apps/api/src/modules/kpi/**` (excepto `kpi-contract.ts` sin cambios), `apps/api/scripts/kpi/telemetry.ts`, `.github/workflows/kpi-telemetry.yml`, `.plans/...`. `package.json` (raíz y api) y `kpi-contract.ts` sin diff: `git diff --exit-code main -- package.json apps/api/package.json apps/api/src/modules/kpi/kpi-contract.ts pnpm-lock.yaml`.
- **J2**: `kpi-schema.spec.ts` (nombres de columnas) + `http-outcome.spec.ts` (operation sin query/UUID/token) + `dependency-instrumentation.spec.ts`/`unsplash-instrumentation.spec.ts` (sin URL/query/clave) + `telemetry-cli.spec.ts` (diagnóstico sin secretos).
- **J3** (sin y con DB local; salida a evidence):
  ```bash
  pnpm --filter api test
  KPI_TEST_DATABASE_URL=postgresql://kpitest:kpitest@localhost:55432/kpitest pnpm --filter api test
  pnpm --filter api lint
  pnpm --filter api build
  ```
  `lint` y `build` corren `prisma generate` (no tocan la DB). No correr `pnpm build` de Vercel ni `prisma:deploy`.

## 4. Riesgos a vigilar por reviewers
- Vercel aplica migraciones en el build (`vercel.json`) ⇒ merge sólo con aprobación del TL.
- Middleware de módulo con `'*path'` en Nest 11: confirmar que corre en 404 sin ruta (spec B2).
- `statement_timeout` como parámetro de arranque contra el pooler de Neon (ver T3).
- `unaccent` y schemas descartables en integración (ver helper T1).
- Diferir `res.end`: no hay código que lea `headersSent`/`writableEnded` tras `end` (verificar en review).
- El entrypoint de `scripts/kpi` no lo cubren `lint`/`build`: mitigado con spec estático + typecheck dirigido.
- `searchCandidate` traga errores: la clasificación depende de envolver sólo el intercambio de red (T4).
