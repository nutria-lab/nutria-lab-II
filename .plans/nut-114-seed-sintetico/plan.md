# NUT-114 — Plan de implementación (explorer backend)

Generado: 2026-11-11 (nutria_backend_explorer). Rama: `mariajoserosalestorres/nut-114-actualizar-script-de-mocking` (base: `origin/main` `d74a27d`, merge del PR #77 / NUT-98).
Entradas: `.plans/nut-114-seed-sintetico/design.md` + plan aprobado (`~/.claude/plans/pasted-content-id-c91e-work-on-crystalline-snowflake.md`). Todas las referencias de abajo se verificaron contra el código actual; las rutas son relativas a `apps/api/` salvo indicación.

Nota de proceso: `bundles/agent-libraries.json` y `bundles/development/AGENTS.md` **no existen** en el repo (solo `AGENTS.md` en la raíz, idéntico en flujo a `CLAUDE.md`). Se siguió `CLAUDE.md` + `.ai/`.

---

## 0. Hallazgos que cambian o condicionan el plan aprobado (leer primero)

| # | Hallazgo | Impacto | Recomendación |
|---|---|---|---|
| H1 | **`pnpm lint` (CI, `.github/workflows/ci.yml:88`) = `tsc --noEmit` sobre `tsconfig.json`**, que incluye `src/**/*.ts` (specs incluidos) y fija `"rootDir": "./src"` (`tsconfig.json:13`). Si un spec en `src/prisma/tests/` importa `../../../prisma/synthetic/*.ts` (o `prisma/seed.ts`), ese archivo entra al programa y tsc emite **TS6059 "File is not under rootDir"**. Verificado con tsc 6.0.3 (raíz): con `rootDir=src` → TS6059; con `rootDir=apps/api` → 0 errores (y `prisma/seed.ts` tipa limpio). | **Bloqueante para CI** si no se ajusta. Jest/ts-jest **sí** compila esos archivos (probado: un spec importó `prisma/seed.ts` y pasó). | Mover `"rootDir": "./src"` de `tsconfig.json` a `tsconfig.build.json` (`compilerOptions.rootDir`), dejando `outDir` y el resto igual. `nest build` usa `tsconfig.build.json` → `dist/` no cambia; lint pasa a tipar también `prisma/synthetic/**` alcanzado desde specs. **Son 2 archivos fuera de la lista aprobada → requiere OK de la usuaria.** Alternativa sin tocar config (no recomendada): specs cargan los módulos con `require()` sin tipos. |
| H2 | **Cliente Prisma generado local desactualizado**: `src/generated/prisma/models/` tiene `KpiSnapshot` y **no** tiene `MealCompletion` ni `ShoppingItemCheck`; `tsc --noEmit` hoy falla localmente en `adherence.repository.ts:2` (TS2305). `src/generated/` está en `.gitignore:11`. | Tests/lint locales fallan sin regenerar. CI no se ve afectado (genera antes). | Antes de rojo/verde: `pnpm --filter api run prisma:generate`. |
| H3 | `MEAL_ORDER` **no está exportado** (`src/modules/plans/weekly-proposal-assignment.ts:20`, `const`). | No se puede importar sin tocar el módulo de planes (fuera de alcance). | Reutilizar `buildWeeklySlots(weekStart: Date): WeeklyMealSlot[]` (exportado, `:23-37`): devuelve 28 slots en orden lunes→domingo × B/L/S/D con `{ key, date, day: DayOfWeek, mealType }`. Cumple D10 sin modificar src. |
| H4 | `mapRecipeNutritionToMeal` **lanza `TypeError`** si la receta no tiene `description` no vacía y `nutritionalValues.{calories,protein,fiber}` numéricos (`recipe-nutrition.mapper.ts:12-32`). `RECETA_POLLO_SEED` no tiene `fiber` (`seed-data.ts:34`). | Toda receta sintética y del catálogo curado debe traer `fiber` y `description`. No usar el mapper sobre la receta base. | Constructor de recetas en `generate.ts` siempre setea los 4 campos. |
| H5 | `Recipe.image` es `Json?` (`prisma/models/recipe.prisma:27`). En `createMany` **no se puede pasar `null` literal** a un Json nullable (Prisma exige `Prisma.DbNull`/`Prisma.JsonNull`). | Error de tipo/runtime si se escribe `image: null`. | **Omitir** `image` en el `data` (queda SQL NULL; al leer, Prisma devuelve la clave `image: null`, que es lo que mira `unsplash.service.ts:125` → `'image' in recipe`) o usar `Prisma.DbNull` (patrón existente en `src/modules/kpi/prisma-publication.repository.ts:65`). |
| H6 | `MealPlanDay` tiene `@@unique([mealPlanId, day])` (`prisma/models/mealPlanDay.prisma:23`), no listado en la verificación clave→ID del diseño. | `skipDuplicates` lo ocultaría. | Agregar `MealPlanDay(mealPlanId, day)` a la verificación clave→ID de la fase `days`. |
| H7 | La `.env` local (`apps/api/.env`) define `DATABASE_URL` **y `DIRECT_URL`** (solo se listaron nombres de variables). `seed.ts:14-16` hace `dotenv.config()` al importar. `prisma.config.ts:5` usa `DATABASE_URL_UNPOOLED || DATABASE_URL` (no lee `DIRECT_URL`, aunque su mensaje de error lo nombra). | El guard evalúa `DIRECT_URL` → si apunta a Neon, la parte base también exigirá que esté en `SEED_ALLOWED_TARGETS`. Importar `prisma/seed.ts` en jest carga la `.env` real en `process.env` (visto en la prueba: "injected env (9)"). | Guard puro con `env` inyectado; los tests **nunca** leen `process.env` ni crean clientes desde él. Documentar `DIRECT_URL` en el README. |
| H8 | `planSelect` de `shopping-list.repository.ts:9-24` **no está exportado**. La `itemKey` (`shopping-list.transform.ts:91-108`) depende solo de `planId`, `name`, `unit` y `sources{plannedMealId, recipeId, ingredientIndex, quantity, unit}`; **no** de `version`/`updatedAt`. | Las keys se pueden calcular de forma pura en el generador (sin releer) y deben coincidir con las que calcula la app. | El generador arma el `ShoppingListPlan` con la misma forma que `planSelect` (ver §1.3). Current-week puede igual releer (diseño F5.6), el resultado es idéntico. |
| H9 | KETO y PALEO **no tienen política determinística** en el dominio (`ingredient-dictionary.ts:136-138` `hasSupportedProfilePolicy`). | El oráculo de compatibilidad del dominio no cubre esas dietas. | Para KETO/PALEO el generador usa una regla propia documentada (p. ej. KETO → solo recetas con categoría `LOW_CARB`; PALEO → sin grupos `gluten`/`dairy`), y el test usa `profileForbiddenRestrictions` + `findExcludedIngredientInSource` como oráculo para el resto. |

Sin otros bloqueos: todo lo demás del plan aprobado es viable tal como está.

---

## 1. Referencias verificadas

### 1.1 Seeder base (se amplía)
- `prisma/seed.ts`
  - `:1-10` importa enums y `PrismaClient` desde `'../src/generated/prisma/client'`; `:11` `bcrypt`; `:12-13` `PrismaPg`, `Pool`; `:14-16` `dotenv.config()` a nivel de módulo.
  - `:18-25` re-exporta y usa `seedBaseData` desde `'../src/prisma/seed-data'` (import relativo).
  - `:27-33` `getPrismaClient()` crea `Pool` + `PrismaPg` + `PrismaClient` desde `process.env.DATABASE_URL`.
  - `:35-196` `async function main()` (no exportada). Parte base: `:44` `seedBaseData`; `:51` `bcrypt.hash('password123', 10)`; `:53-84` 3 usuarios `usuario.prueba1-3@nutria.com`; `:86-189` upserts + plan semanal en lunes **UTC** (`:122-132`) con `deleteMany` de planes de esos usuarios (`:137`, solo base, se conserva).
  - `:198-203` gate `if (process.env.NODE_ENV !== 'test') main().catch(... process.exit(1))`.
- `src/prisma/seed-data.ts`: `import { IngredientType } from '../generated/prisma/client'` (`:1`); `PECHUGA_POLLO_SEED` (`:3-10`, name `'Pechuga de Pollo'`), `ARROZ_INTEGRAL_SEED` (`:12-19`, `'Arroz Integral'`), `RECETA_POLLO_ID = '11111111-1111-1111-1111-111111111111'` (`:21`), `RECETA_POLLO_SEED` (`:23-36`), `seedBaseData(client: any)` (`:38-73`).
- Test existente a conservar: `src/prisma/tests/seed.spec.ts` (mock client con `upsert` en `jest.fn().mockImplementation` sobre un estado en memoria, `:43-62`; importa `'../seed-data'`).

### 1.2 Configuración / build / runtime
- `package.json` (api): `:14` `"prisma:seed": "npx tsx prisma/seed.ts"`; `:21-23` clave heredada `"prisma": { "seed": ... }`; `:8` `lint` = `pnpm prisma:generate && tsc --noEmit`; `:7` `build` = `prisma:generate && nest build`. Raíz `package.json`: `"seed": "pnpm --filter api run prisma:seed"`.
- Versiones: `prisma`/`@prisma/client`/`@prisma/adapter-pg` 7.9.1; `bcrypt` **5.1.1**; `tsx` **4.23.15**; `jest` 29 + `ts-jest` 29; TypeScript raíz 6.0.3 (ojo: `apps/api/node_modules/.bin/tsc` resuelve 5.9.3 localmente y falla con `ignoreDeprecations: "6.0"` TS5103; es un tema de entorno local, no del ticket).
- `tsconfig.json`: `rootDir ./src` (`:13`), `baseUrl ./src` + `paths { "@/*": ["*"] }` (`:17-20`), `include ["src/**/*.ts"]` (`:23-25`), `experimentalDecorators`/`emitDecoratorMetadata`.
- `tsconfig.build.json`: extiende y excluye `node_modules`, `dist`, `test`, `**/*spec.ts`, `**/*.fixture.ts`.
- `nest-cli.json`: `sourceRoot: "src"`, assets `generated/**/*`.
- `jest.config.js`: `rootDir: 'src'`, `testRegex '.*\.spec\.ts$'`, `ts-jest`, `moduleNameMapper '^@/(.*)$' → '<rootDir>/$1'`.
- **`dist/` actual**: `dist/prisma/` contiene solo `prisma.module.*`, `prisma.service.*`, `seed-data.*` (de `src/prisma`). Nada de `apps/api/prisma/**`. Confirmado D11: `prisma/synthetic/**` no entra a `dist` mientras ningún archivo **no-spec** de `src` lo importe (H1 lo mantiene así).
- **Prisma 7 `db seed`**: en `prisma@7.9.1/build/index.js` el comando hace `let i = n.migrations?.seed; if (!i) return "No seed command configured"` → **solo lee `migrations.seed` de `prisma.config.ts`**; la clave `package.json#prisma.seed` se ignora. Tipo en `@prisma/config@7.9.1/dist/index.d.ts:117-131` (`MigrationsConfigShape.seed?: string`). `prisma.config.ts:14-19` no la define. ⇒ Usar `pnpm seed` desde la raíz (confirma el plan aprobado; no cambiar la config).
- **Estilo de import (probado empíricamente)**:
  - tsx 4.23.15 con cwd `apps/api` **resuelve `@/...` usando `paths` de `tsconfig.json` incluso para archivos fuera de `include`** (probado con un archivo fuera de `src` importando `@/utils/idempotency-hash.util` → OK), y los módulos de `src` que usan `@/` internamente (p. ej. `shopping-list.transform.ts:2`) cargan bien vía import relativo.
  - ts-jest compila `prisma/seed.ts` (fuera de `rootDir`) sin error; `moduleNameMapper` resuelve `@/` desde cualquier archivo.
  - **Recomendación**: en `prisma/synthetic/*.ts` usar imports **relativos** a `src` (`'../../src/...'`), igual que `prisma/seed.ts:10,24` y `prisma/recover-unsplash-tracking.ts:4-9` / `scripts/kpi/*.ts:1`. En los specs (`src/prisma/tests/`), importar lo sintético con `'../../../prisma/synthetic/<x>'` y lo de dominio con `'@/...'` o relativo. Ambos estilos funcionan en jest y tsx; lo relativo es la convención existente.
- Pipelines: `.github/workflows/ci.yml:85-91,126-129` corre `prisma:generate`, `lint`, `test`, `build`; ninguno invoca seed. `vercel.json` corre `prisma:deploy && build`.

### 1.3 Símbolos de dominio a reutilizar (firma exacta)
- `mapRecipeNutritionToMeal(recipe: unknown): { Calories: number; Protein: number; Fiber: number; Description: string }` — `src/modules/plans/recipe-nutrition.mapper.ts:6-40`. Sin imports. Ver H4.
- `transformShoppingList(weekStart: string, plan: ShoppingListPlan): ShoppingListResponse` — `src/modules/shopping-list/shopping-list.transform.ts:110-210`. Imports: `node:crypto`, `canonicalJson` desde `'@/utils/idempotency-hash.util'` (`:2`), tipos locales. Sin Nest/Prisma. `items[].key` = sha256 hex de `canonicalJson({ planId, name, unit, sources })` (`:91-108`); nombres normalizados con `normalizeText` (`:22-24`, NFKC/trim/espacios/`toLocaleLowerCase('es')`, **no exportada**); unidades válidas solo `g/kg/ml/l/unidad` y sus alias (`:11-17`) — cualquier otra unidad produce warning `INVALID_INGREDIENT` e ítem aislado con `quantity null`.
- `ShoppingListPlan` — `src/modules/shopping-list/shopping-list.types.ts:46-51`:
  `{ id: string; version: number; updatedAt: Date | string; days: Array<{ meals: Array<{ id: string; recipeId?: string | null; recipe?: { id: string; ingredients: unknown } | null }> }> } | null`. Debe coincidir con `planSelect` (`shopping-list.repository.ts:9-24`, no exportado; ver H8).
- `canonicalJson(value: unknown): string` — `src/utils/idempotency-hash.util.ts:10-12` (sin dependencias salvo `crypto`).
- `buildWeeklySlots(weekStart: Date): WeeklyMealSlot[]` — `src/modules/plans/weekly-proposal-assignment.ts:23-37` (`WeeklyMealSlot` `:3-8`). `MEAL_ORDER` `:20` y `DAY_ORDER` `:10-18` **no exportados** (H3). Importa solo `'../../generated/prisma/client'`.
- `dateInBuenosAires(now: Date): string` (`YYYY-MM-DD`) — `src/modules/adherence/adherence.repository.ts:30-39`, **exportada**. **Efectos de importarla**: carga `@nestjs/common`, `@/generated/prisma/client` (runtime del cliente, sin conexión), `@/prisma/prisma.service` (clase decorada, el constructor no se ejecuta), `adherence.errors` (Nest exceptions), `dto/set-meal-status.dto` (decoradores de class-validator con `MealCompletionStatus`) y `effective-meal-status`. No abre conexiones ni lee env. Probado: `npx tsx` la importa y devuelve `dateInBuenosAires(new Date('2026-11-16T02:30:00Z')) === '2026-11-15'`. En jest funciona sin mock (no se instancia `PrismaService`). El lunes BA se calcula como en el front: `apps/web/src/common/utils/calendar.ts:30-36` (`(getUTCDay()+6)%7` sobre la fecha civil BA).
- Snapshots de adherencia: `mealCompletionSnapshotsMatch` / `effectiveMealStatus` — `src/modules/adherence/effective-meal-status.ts:14-29` (exige `recipeIdSnapshot === meal.recipeId` y `mealUpdatedAtSnapshot.getTime() === meal.updatedAt.getTime()`). Útil como oráculo en tests.
- Compatibilidad dieta/restricciones (oráculo de test, no se modifica): `profileForbiddenRestrictions(profile)` `src/modules/recipe/validation/ingredient-dictionary.ts:119-133`, `findExcludedIngredientInSource(source, excluded)` `:166-204`, `hasSupportedProfilePolicy` `:136-138`, `GROUP_KEYWORDS` `:9+` (no exportado; ojo con nombres curados que contengan "leche", "queso", "almendra", "soja", etc.). Importa solo `../recipe-fingerprint.util`. Categorías vs grupos: `src/modules/recipe/validation/recipe-validation.config.ts:23-28`.
- Login (test de credenciales): `AuthService` `src/modules/auth/auth.service.ts:9-14` (constructor `(userRepository: UserRepository, jwtService: JwtService)`), `login()` `:40-49` → `bcrypt.compare(dto.password, user.passwordHash)` `:46` → `UnauthorizedException('Credenciales incorrectas')` `:48` (HTTP 401). `UserRepository.findByEmail` `src/modules/user/user.repository.ts:15`.
- **bcrypt 5.1.1 con hash no-bcrypt** (probado): `bcrypt.compare('x', '!synthetic-no-login')` **resuelve `false`** (no rechaza); `compareSync` → `false`. Fuente nativa `node_modules/bcrypt/src/bcrypt_node.cc` valida el formato del salt y devuelve `false`; solo lanza con `"invalid hash provided"` cuando el argumento no es string. ⇒ El test puede afirmar `resolves.toBe(false)` y `login` → `UnauthorizedException`.
- KPI (aislamiento, test de integración): `DataKpiLogger` `src/modules/kpi/data-kpi.logger.ts:36-49`, constructor `(prisma: RawQueryClient, clock: () => Date)` (`:38`).
  - `collect(context: CollectionContext)` (`:40-49`) usa como contexto `{ contract_version: '1', date, environment, window_start, window_end, run_id }` (`kpi-contract.ts:79-86`).
  - `collectWindowCounts` (`:51-`): `initial_plans_count` cuenta GenerationRun `MEAL_PLAN_INITIAL` y `manual_recipes_count` cuenta `origin='MANUAL'`, ambos con `createdAt` en `[window_start, window_end)`.
  - `collectAdherence` (`:98-140`): si `context.date` no es `selectAutomaticArgentinaKpiDate({ now: clock })` (`kpi-window.ts:44`), devuelve `REPORT_DATE_NOT_CURRENT`. Si coincide, cuenta `COUNT(*)` y los COMPLETED con snapshots vigentes de planes `isCurrent` con `d."date"::date = context.date`, en toda la población.
  - La ventana sale de `resolveArgentinaKpiWindow` (`kpi-window.ts:20`).

### 1.4 Esquema (sin cambios; 14 modelos en `prisma/models/*.prisma`)
- `user.prisma`: `id`, `email @unique`, `passwordHash`, `name?`, `createdAt`, `updatedAt` (sin rol).
- `nutritionProfile.prisma:30-42`: `userId @unique`, `goal`, `diet`, `excludedIngredients DietaryRestriction[]`, `cookTimePreference`. Enums `:1-28`.
- `ingredient.prisma:11-24`: `name @unique`, `type IngredientType`, `nutritionalValues Json`, `properties String[]`.
- `recipe.prisma:16-40`: `ingredients Json`, `instructions String[]`, `categories RecipeCategory[]`, `nutritionalValues Json?`, `image Json?` (H5), `origin` default MANUAL, `createdAt` escribible, `@@index([createdAt])`.
- `mealPlan.prisma:8-33`: `startDate`, `endDate`, `version` default 1, `isCurrent` default true, `generationRunId?`. Índice parcial `meal_plans_user_week_current_key` en `prisma/migrations/20260922204917_add_generation_run_and_meal_plan_versioning/migration.sql:72-74`.
- `mealPlanDay.prisma:11-25`: `day DayOfWeek`, `date`, `@@unique([mealPlanId, day])` (H6).
- `plannedMeal.prisma:1-16`: `dayId`, `mealType`, `title`, `recipeId?`, `nutritionalValues Json`, `updatedAt @updatedAt`.
- `mealCompletion.prisma:7-21`: `plannedMealId @unique`, `recipeIdSnapshot?`, `mealUpdatedAtSnapshot`, `status MealCompletionStatus` (`NOT_LOGGED|COMPLETED|SKIPPED`).
- `shoppingItemCheck.prisma:1-15`: `@@unique([userId, planId, itemKey])`, `checked`.
- Enums en runtime: `src/generated/prisma/client.ts:21-22` re-exporta `./enums`; `Prisma` (para `DbNull`) también desde `client`. Desde `prisma/synthetic/`: `'../../src/generated/prisma/client'`; desde specs: `'@/generated/prisma/client'`.

### 1.5 Patrón de test de integración a copiar
`src/modules/adherence/tests/adherence.persistence.integration.spec.ts`:
- `:14-15` URL propia (`ADHERENCE_TEST_DATABASE_URL`), `describe.skip` si falta; nunca cae a `DATABASE_URL`.
- `:28-31` solo `127.0.0.1|localhost|::1|[::1]`, si no lanza.
- `:33-38` schema privado aleatorio `CREATE SCHEMA`.
- `:40-57` aplica `prisma/migrations/*/migration.sql` en orden, uno por transacción (`path.resolve(__dirname, '../../../../prisma/migrations')`; desde `src/prisma/tests/` es `'../../../prisma/migrations'`, como `src/prisma/tests/generation-run-migration.spec.ts:12`).
- `:59-61` `new Pool({ connectionString, options: '-c search_path=<schema>,public' })` + `new PrismaPg(pool, { schema })`.
- `:64-71` `afterAll` con `DROP SCHEMA ... CASCADE`.

---

## 2. Bloque 1 — piezas puras (rojo → verde)

### 2.1 Archivos nuevos
- `prisma/synthetic/catalog.ts` — `export const CURATED_INGREDIENTS: readonly CuratedIngredient[]` (~60): `{ name, type: IngredientType, defaultUnit: 'g'|'ml'|'unidad', nutritionalValues: { calories, protein, carbs, fat, fiber }, diets/grupos de alérgeno }`. Unidades **solo** del set de `shopping-list.transform.ts:11-17`, para que no haya warnings ni ítems aislados.
- `prisma/synthetic/generate.ts` — puro, `now` inyectado. Funciones sugeridas: `normalizeIngredientName(s)` (NFKC → NFD sin diacríticos → minúsculas → trim → espacios colapsados), `buildIngredients({ catalog, count, baseNames })` (falla ante colisión; `baseNames` = `[PECHUGA_POLLO_SEED.name, ARROZ_INTEGRAL_SEED.name]` **importados** de `'../../src/prisma/seed-data'`), `buildUsers(count, demoHash)` (exactamente `{ id, email, name, passwordHash }`), `buildProfiles`, `buildRecipes` (MANUAL, `createdAt` fijo pasado, sin `image` — H5, con `fiber` y `description` — H4, categorías derivadas de ingredientes), `buildPastPlans` (lunes desde `2026-01-05`, 40 semanas rotando; días/comidas con `buildWeeklySlots`, H3; `nutritionalValues = mapRecipeNutritionToMeal(recipe)`), `buildCompletions` (patrones fijos, fechas `< dateInBuenosAires(now)`), `buildShoppingChecks` (keys vía `transformShoppingList` sobre `ShoppingListPlan` con forma de `planSelect`, H8), `currentWeekMonday(now)` (desde `dateInBuenosAires`), `buildCurrentWeek(...)`. Incluir un **texto centinela** constante (p. ej. `export const SYNTHETIC_GENERATOR_SENTINEL = 'nut114-synthetic-generator'`) para la búsqueda en `dist/`.
- `prisma/synthetic/guard.ts` — `assertSeedTarget(env: Record<string, string|undefined>): { target, maskedHost, database, synthetic: boolean }` puro; lanza `SeedTargetError` con mensaje enmascarado. Evalúa `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `DIRECT_URL` (H7); normaliza `-pooler`; allowlist localhost + `SEED_ALLOWED_TARGETS`; bloquea `NODE_ENV|KPI_ENV|VERCEL_ENV === 'production'`; parte sintética exige `SEED_SYNTHETIC=true` + `SEED_CONFIRM_TARGET` + `SEED_DEMO_PASSWORD`. Sin imports de `pg`/Prisma.

### 2.2 Cambios en archivos existentes
- `src/prisma/seed-data.ts` (agregar al final, después de `:73`): `SYNTHETIC_EMAIL_DOMAIN = 'nutria.test'`, `syntheticEmail(n)` → `demo.seed.NNNNN@nutria.test`, `syntheticName(n)` → `Demo Sintético NNNNN`, `SYNTHETIC_WALKTHROUGH_INDEX = 1`, `SYNTHETIC_TABLE_CODES` (0001…0009 según design §7.1), `synthId(table, n)` → `5eedTTTT-0000-4000-8000-NNNNNNNNNNNN` (12 dígitos), `RESERVED_EMAIL_PREFIXES = ['usuario.prueba', 'qa.']`. Solo constantes/funciones puras (llegan a `dist/prisma/seed-data.js`, aceptado en design §12).
- **Si la usuaria aprueba H1**: `tsconfig.json` quitar `"rootDir": "./src"` (`:13`); `tsconfig.build.json` agregar `"compilerOptions": { "rootDir": "./src" }`. Verificar después que `dist/` mantiene la misma estructura (`dist/main.js`, `dist/prisma/seed-data.js`).

### 2.3 Tests (en `src/prisma/tests/`)
- `seed-guard.spec.ts` — design §10.1 casos 1-9 contra `assertSeedTarget` (import `'../../../prisma/synthetic/guard'`), cada caso con un objeto `env` explícito. Los casos "cero llamadas a Pool/cliente" y "base igual que siempre" requieren la integración del Bloque 2 (`seed.ts` con deps inyectables); en Bloque 1 se cubren a nivel guard y se completan en Bloque 2. Afirmar que `error.message` no contiene usuario, contraseña ni la URL.
- `seed-synthetic.generate.spec.ts` — design §10.3 casos 1-11. Oráculos: `mapRecipeNutritionToMeal` (`@/modules/plans/recipe-nutrition.mapper`), `transformShoppingList` (`@/modules/shopping-list/shopping-list.transform`), `profileForbiddenRestrictions` + `findExcludedIngredientInSource` (`@/modules/recipe/validation/ingredient-dictionary`, H9), `dateInBuenosAires`, `PECHUGA_POLLO_SEED`/`ARROZ_INTEGRAL_SEED`/`RECETA_POLLO_ID` (`'../seed-data'`). Caso aislado: catálogo con un único `"pechuga de pollo "` → `toThrow`.
- `seed-synthetic.credentials.spec.ts` — `await expect(bcrypt.compare('cualquiera', '!synthetic-no-login')).resolves.toBe(false)`; `new AuthService({ findByEmail: jest.fn().mockResolvedValue({ ..., passwordHash: '!synthetic-no-login' }) } as any, { signAsync: jest.fn() } as any).login(...)` → `rejects.toBeInstanceOf(UnauthorizedException)`; solo el user 00001 tiene `passwordHash` que matchea `^\$2[aby]\$\d{2}\$.{53}$` (usar `bcrypt.hash` con costo bajo en el test o inyectar el hash).
- `seed-synthetic.permissions.spec.ts` — `Object.keys(user).sort()` igual a `['email','id','name','passwordHash']` para todos los User generados.

Comando: `pnpm --filter api run prisma:generate` (H2) y luego, en `apps/api`, `npx jest src/prisma`.

---

## 3. Bloque 2 — loader e integración

### 3.1 Archivo nuevo
- `prisma/synthetic/load.ts` — `export class SeedPhaseError extends Error { phase; code: number | 'missing_ids' | 'email_id_conflict' | 'week_current_conflict' | ...; sample? }`; `export async function loadSynthetic(client, { now, users, batchSize, demoPasswordHash, log })`. Cliente tipado como subconjunto (`createMany`, `findMany`, `count`) para permitir el fake en memoria. Fases y orden del design §3.1. Detalles:
  - `createMany({ data, skipDuplicates: true })` por lotes; nunca `update`/`upsert`/`deleteMany`.
  - Verificación por fase: `findMany({ where: { id: { in } }, select })` por lotes; clave→ID para `User.email`, `Ingredient.name`, `NutritionProfile.userId`, `MealPlanDay(mealPlanId, day)` (H6), `MealCompletion.plannedMealId`, `ShoppingItemCheck(userId, planId, itemKey)`.
  - Snapshots: releer `id, recipeId, updatedAt` de `PlannedMeal` antes de crear `MealCompletion` (design §9.5), tanto masivo (solo comidas de los 250 usuarios activos) como current-week. `createMany` no devuelve filas y `@updatedAt` lo setea Prisma en la escritura.
  - Current-week: plan `…-9YYYYMMDD000`; si `findFirst({ where: { userId, startDate, isCurrent: true } })` devuelve otro ID → `SeedPhaseError('plans','week_current_conflict')` con el mensaje literal de design F6; no escribir dependientes.
  - Conteos finales por tabla + duración; nunca secretos.

### 3.2 Integración en `prisma/seed.ts`
- Mantener `:14-16` (dotenv) y `:18-25` (re-exports).
- Reestructurar `main` en `export async function runSeed(deps = { env: process.env, createClient: getPrismaClient, now: () => new Date() })`:
  1. `const target = assertSeedTarget(deps.env)` **antes** de `getPrismaClient()` (`:27-33`/`:37`), para que el test afirme cero llamadas a `Pool`/cliente (mockear `createClient`).
  2. Parte base actual (`:43-189`) sin cambios.
  3. Si `target.synthetic`: `bcrypt.hash(env.SEED_DEMO_PASSWORD, 10)` una vez, `loadSynthetic(...)`; mapear `SeedPhaseError` a mensajes del design §3.1 ("carga masiva OK, current-week FALLÓ").
  4. `finally` con `$disconnect` + `pool.end()` (`:192-195`).
- Conservar el gate `:198-203` (`NODE_ENV !== 'test'`) llamando a `runSeed()`; exit 1 en cualquier error, sin imprimir la URL (hoy `:200` hace `console.error(e)` completo: reemplazar por mensaje sanitizado).
- `SEED_SYNTHETIC_USERS` (default 5000, máx 5000) y `SEED_BATCH_SIZE` (default 1000) leídos de `deps.env`.

### 3.3 Tests (en `src/prisma/tests/`)
- `seed-synthetic.load.spec.ts` — design §10.4 casos 1-11 con un fake client en memoria (estilo `seed.spec.ts:43-62`, pero con `createMany` que respeta `skipDuplicates` sobre `id` y claves únicas, incluido el índice parcial `(userId, startDate) WHERE isCurrent` y `MealPlanDay(mealPlanId, day)`; `updatedAt` asignado al insertar). Para volumen, permitir `users` reducido (p. ej. 50) salvo el caso 8 que pide los conteos de 5000.
- `seed-synthetic.current-week.spec.ts` — casos §10.4.7, 10.4.10, 10.4.11 si se separan del anterior (opcional; el plan aprobado los agrupa en `load`).
- `seed-guard.spec.ts` (completar): importar `runSeed` desde `'../../../prisma/seed'` con `createClient: jest.fn()`; guard bloqueado → `createClient` no llamado; sin `SEED_SYNTHETIC` → `loadSynthetic` no se llama y la parte base corre (cliente fake con `upsert/create/deleteMany` de la parte base). Recordar H7: el import carga `.env`; pasar siempre `env` explícito.
- `seed-synthetic.integration.spec.ts` — patrón §1.5 con `SEED_TEST_DATABASE_URL` (solo local), schema privado, 50 usuarios: dos cargas con conteos estables; fallo recuperable; FK sin huérfanos; KPI con `now` fijo, el mismo instante para el seed y para `new DataKpiLogger(prisma, () => now)`, con `date` y ventana de `resolveArgentinaKpiWindow`:
  - (a) `now` = `2026-11-12T01:00:00Z` (miércoles 11 a las 22:00 ART) con `date: '2026-11-11'` → `adherence_rate` con N=4 y C=0 (valor 0).
  - (b) `now` = `2026-11-11T18:00:00Z` (miércoles 11 a las 15:00 ART) con `date: '2026-11-10'` → N=4 y C=2 (valor 50).
  - En ambos casos los planes masivos aportan 0. Se verifica con una consulta de control: comidas elegibles en esa fecha fuera de 00001 = 0.
  - `manual_recipes_count` e `initial_plans_count` dan 0 en la ventana del caso.
  - Requiere el patrón fijo del martes en current-week: COMPLETED, NOT_LOGGED, COMPLETED, sin fila.

### 3.4 Cierre del bloque
1. `npx jest src/prisma` y luego `npx jest` (suite completa) en `apps/api`.
2. `pnpm --filter api lint` (valida H1).
3. `pnpm --filter api build` y `grep -r "<centinela>" apps/api/dist` → sin resultados.

---

## 4. Bloque 3 — corrida real y evidencia

- **Gate humano**: antes de la primera carga, informar host enmascarado + base (sin credenciales) y esperar confirmación. Variables (`DATABASE_URL`, `DIRECT_URL`/`DATABASE_URL_UNPOOLED` si existen, `SEED_ALLOWED_TARGETS`, `SEED_CONFIRM_TARGET`, `SEED_DEMO_PASSWORD`, `SEED_SYNTHETIC=true`) las define la usuaria; no se escriben ni se imprimen.
- Comando: `pnpm seed` desde la raíz (no `prisma db seed`, ver §1.2). Dos corridas.
- Evidencia antes/después: `SELECT pg_size_pretty(pg_database_size(current_database()));` y `pg_size_pretty(pg_total_relation_size('planned_meals'|'meal_plan_days'|'recipes'))`; confirmar límite del plan Neon; frenar si la estimación supera el 70 %.
- Archivo nuevo: `prisma/synthetic/README.md` — variables, comando, conteos esperados por fórmula (design §9.7), comportamiento al reejecutar (F2-F4), base aislada distinta de NUT-105, recetas globales visibles para todos, impacto en el seed base remoto (`SEED_ALLOWED_TARGETS`, incluido `DIRECT_URL`, H7), evidencia de ambas corridas (conteos reales, duración, tamaño, commit probado, ambiente, cuenta demo, "todos los datos son sintéticos").
- Entregar texto para la descripción del PR y pedir horas reales. Sin escrituras a Linear sin preguntar; sin git add/commit/push.

---

## 5. Archivos a tocar (resumen)

| Bloque | Nuevo | Modificado |
|---|---|---|
| 1 | `prisma/synthetic/catalog.ts`, `prisma/synthetic/generate.ts`, `prisma/synthetic/guard.ts`, `src/prisma/tests/seed-guard.spec.ts`, `src/prisma/tests/seed-synthetic.generate.spec.ts`, `src/prisma/tests/seed-synthetic.credentials.spec.ts`, `src/prisma/tests/seed-synthetic.permissions.spec.ts` | `src/prisma/seed-data.ts`; **pendiente de OK (H1)**: `tsconfig.json`, `tsconfig.build.json` |
| 2 | `prisma/synthetic/load.ts`, `src/prisma/tests/seed-synthetic.load.spec.ts`, (`seed-synthetic.current-week.spec.ts` opcional), `src/prisma/tests/seed-synthetic.integration.spec.ts` | `prisma/seed.ts` |
| 3 | `prisma/synthetic/README.md` | — |

No se modifican: esquema, migraciones, servicios de planes/imágenes/adherencia/lista de compras, `prisma.config.ts`, `package.json`.
