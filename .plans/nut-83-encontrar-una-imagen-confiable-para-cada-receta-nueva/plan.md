# NUT-83 — plan.md

> Generado: 2026-10-03T19:38:22Z, a partir de `design.md` de esta carpeta (fuente de verdad del QUÉ), sobre la rama `mariajoserosalestorres/nut-83-encontrar-una-imagen-confiable-para-cada-receta-nueva` con `origin/main` mergeado (incluye NUT-72). Las referencias `archivo:línea` corresponden a ese estado; CodeGraph no estuvo disponible (`CONNECTION_CLOSED`) y se exploró con Glob/Grep/Read.

## 1. Esquema y migración

- `apps/api/prisma/models/recipe.prisma:27` — `image Json?` (ya existente).
- `apps/api/prisma/migrations/20260930220304_add_recipe_image/` — migración aditiva del PR #46, reutilizada sin cambios. **No hay migración nueva.**

## 2. Módulo `apps/api/src/modules/unsplash/`

| Archivo | Símbolos |
|---|---|
| `recipe-image.types.ts` | `RecipeImage` (contrato público, design 5.1), `UnsplashTrackingMetadata`, `PersistedRecipeImage` (design 6.2) |
| `unsplash-query.util.ts:4` | `buildUnsplashQuery` (design 3.1) |
| `unsplash-candidate-selector.util.ts` | `UnsplashCandidate` (`id: string`), `isValidCandidate:25`, `selectUnsplashCandidate:79` (design 3.2) |
| `unsplash-url-validator.util.ts:6` | `isValidUnsplashUrl` + `UNSPLASH_IMAGE_HOST` / `UNSPLASH_PAGE_HOST` / `UNSPLASH_API_HOST` (design 3.4) |
| `unsplash.service.ts` | `UNSPLASH_MAX_CONCURRENT_REQUESTS:13`, `resolveWithBoundedConcurrency:17`, `UNSPLASH_TIMEOUT_MS:48`, `UNSPLASH_QUOTA_FALLBACK_COOLDOWN_MS:52`, `withAttributionUtm:66`, `toPublicRecipeImage:81` |
| `unsplash.service.ts` (clase `UnsplashService`) | `searchAndSelectCandidate:114`, `searchAndSelectImages:123` (salta recetas que ya traen la clave `image`), `trackDownload:173`, `searchCandidate:225`, `isQuotaExhausted:308`, `applyQuotaFromResponse:323`, `resolveQuotaResetAt:335`, `buildPendingImage:352` |
| `unsplash-recovery.util.ts:27` | `recoverPendingAndFailedTracking` (agrupa por `trackingUrl`, design 6.4 y D8) |
| `unsplash.module.ts` | exporta `UnsplashService` |
| `unsplash-search.fixture.ts` | fixtures de test con la forma real de `/search/photos` (excluido del build en `apps/api/tsconfig.build.json`) |

Se eliminaron `resolveImage` y `attachImages` (registraban uso antes de guardar) y el log temporal `[DEMO]`.

## 3. Consumidores

**Recetas** (`apps/api/src/modules/recipe/`)
- `recipe.service.ts:12` `withPublicImage` — mapeo público aplicado en `create:32`, `findAll`, `findById`, `update:76` y `delete:81` (design 5.4).
- `recipe.service.ts:32` `create` — `searchAndSelectCandidate` → `repository.create` (PENDING) → `trackPersistedImage:89` (`trackDownload` + `repository.updateImage`; si la escritura falla queda PENDING y loguea warning) (Flujo A).
- `recipe.repository.ts:209` `updateImage` — escritura del JSON completo; `image` no es escribible por `UpdateRecipeDto`.
- `recipe.repository.ts:50` — el SELECT crudo de `findAll` incluye `"image"`.
- `recipe.module.ts` — importa `UnsplashModule` y `NutritionProfileModule` (merge con NUT-72).
- `recipe-coverage.service.ts:32` (NUT-72) — **sin cambios**; ver la nota de design 5.4.

**Planes** (`apps/api/src/modules/plans/`)
- `dto/recipe.dto.ts:26` — `@IsOptional() @IsUUID() id?: string` (D7). `image` no está en el DTO; `main.ts:15` (`forbidNonWhitelisted`) responde 400.
- `plans.service.ts:36` `prepareRecipeImages` — descarta `image` entrante y, con el plan actual, copia la imagen persistida de las recetas cuyo `id` le pertenece; devuelve el `Set` de imágenes conservadas.
- `plans.service.ts:78` `resolveImagesOrDegrade` — `searchAndSelectImages` con degradación.
- `plans.service.ts:98` `trackNewRecipeImages` — después del commit, agrupa por `trackingUrl` (D8), concurrencia 3, `updateRecipeImageTracking` por receta.
- `plans.service.ts:240` `validateAndPersistPlan` — `prepareRecipeImages(dto.days)` sin plan actual (Flujo B). También lo usa la generación con IA (`plainToInstance` en `:217`).
- `plans.service.ts:341` `updatePlan` — `prepareRecipeImages(dto.days, plan)` con el plan de `findPlanByWeek`; filtra las imágenes conservadas antes de `trackNewRecipeImages` (Flujo C).
- `plans.service.ts:426` `getPlanByWeek` — filtra la imagen de cada receta embebida.
- `plans.repository.ts:34` `findPlanByWeek` — `where { userId, startDate, isCurrent: true }`: define qué ids cuentan como existentes.
- `plans.repository.ts:21` `RecipeForTracking`, `:102` `createDaysMealsAndRecipes` (copia `image` como dato y lo reporta con la misma referencia), `:304` `buildOutputSnapshot` (quita `image`), `:470` `updateRecipeImageTracking` (fuera de transacción). El archivo no menciona al adaptador (guardia en `plans-transaction-no-network.spec.ts`).

**Operación y configuración**
- `apps/api/prisma/recover-unsplash-tracking.ts` + script `unsplash:recover-tracking` en `apps/api/package.json`.
- `apps/api/.env.example` — `UNSPLASH_ACCESS_KEY` (solo Access Key).

## 4. Tests — criterios de design.md §10 → archivos

| AC | Archivo(s) |
|---|---|
| 1 Parámetros y normalización | `unsplash/unsplash-query.util.spec.ts`; `unsplash/unsplash.service.spec.ts` ("request and mapping") |
| 2 Primer candidato válido | `unsplash/unsplash-candidate-selector.util.spec.ts`; `unsplash.service.spec.ts` |
| 3 Mapeo, UTM, alt | `unsplash.service.spec.ts`; `plans/tests/...` vía `searchAndSelectImages` (alt por título) |
| 4 Host no validado | `unsplash/unsplash-url-validator.util.spec.ts`; `unsplash.service.spec.ts` (`trackDownload`) |
| 5 Errores | `unsplash.service.spec.ts` ("errors degrade to image: null") |
| 6 Cuota | `unsplash.service.spec.ts` ("quota from X-Ratelimit-Remaining") |
| 7 Creación manual | `recipe/tests/recipe.service.spec.ts` (mocks + "real UnsplashService") |
| 8 Planes | `plans/tests/plans.service.spec.ts`; `plans/tests/plans.repository.spec.ts` |
| 9 PUT /meal-plans | `plans/tests/plans-update-image-preservation.spec.ts`; `plans.repository.spec.ts` (`findPlanByWeek`, referencia) |
| 10 Lecturas estables | `recipe.service.spec.ts` ("real UnsplashService") |
| 11 Recuperación | `unsplash/unsplash-recovery.util.spec.ts` |
| 12 Sin red en transacciones | `plans/tests/plans-transaction-no-network.spec.ts`; tests de orden en `plans.service.spec.ts` y `recipe.service.spec.ts` |
| 13 Sin filtraciones | `unsplash.service.spec.ts` (logs), `recipe.service.spec.ts` (DTOs), `plans.service.spec.ts` (planes), `plans.repository.spec.ts` (snapshots) |
| 14 Prueba real | sección 6 de este plan |

## 5. Verificación

- `pnpm test` y `pnpm lint` en `apps/api`.
- `pnpm lint` usa el `tsc` que resuelve `apps/api`. En una instalación donde ese `tsc` es 5.9.3 (peer instalado por `autoInstallPeers`), falla con `TS5103` por `"ignoreDeprecations": "6.0"` de `apps/api/tsconfig.json`; pasa a pasar el mismo chequeo con el TypeScript 6.0.3 de la raíz. Es un problema del entorno que también existe en `main` y no forma parte de este ticket.

## 6. Evidencia — prueba real (2026-10-03, base local `nutria-postgres`, API con `pnpm dev`, Access Key real; la key no se imprimió)

**`POST /recipes`** `{"title":"Guacamole", ...}` → `201`:

```json
{
  "id": "5d79827d-f843-4cc3-9ec5-561b9a6589dc",
  "title": "Guacamole",
  "image": {
    "provider": "UNSPLASH",
    "providerPhotoId": "oaz0raysASk",
    "imageUrl": "https://images.unsplash.com/photo-1484980972926-edee96e0960d?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDg4Njg1fDB8MXxzZWFyY2h8MXx8Z3VhY2Ftb2xlJTIwZm9vZCUyMHJlY2lwZXxlbnwxfHx8fDE3OTEwNjgxMzB8MA&ixlib=rb-4.1.0&q=80&w=1080",
    "sourceUrl": "https://unsplash.com/photos/hummus-bowl-with-herbs-and-pomegranate-oaz0raysASk?utm_source=nutria&utm_medium=referral",
    "photographer": "Brooke Lark",
    "photographerUrl": "https://unsplash.com/@brookelark?utm_source=nutria&utm_medium=referral",
    "alt": "Hummus topped with green herb sauce, cherry tomatoes, pomegranate seeds, and edible flowers",
    "query": "guacamole food recipe",
    "retrievedAt": "2026-10-03T22:55:38.892Z"
  }
}
```

**Fila en la base** (`image->'tracking'`):

```json
{
  "status": "SUCCEEDED",
  "trackingUrl": "https://api.unsplash.com/photos/oaz0raysASk/download?ixid=M3wxMDg4Njg1fDB8MXxzZWFyY2h8MXx8Z3VhY2Ftb2xlJTIwZm9vZCUyMHJlY2lwZXxlbnwxfHx8fDE3OTEwNjgxMzB8MA",
  "lastAttemptAt": "2026-10-03T22:55:39.197Z"
}
```

**`GET /recipes/:id` dos veces:** `image` con exactamente las 9 claves públicas, idéntica a la del POST en ambas lecturas, sin `tracking`, `trackingUrl`, `lastAttemptAt` ni `/download`, y 0 líneas de log de Unsplash durante las lecturas (ninguna llamada externa).

**Cuota:** `X-Ratelimit-Limit: 50`; Unsplash no envía `X-Ratelimit-Reset`.

**Sin key:** el valor de la key no aparece en el log de la API ni en las respuestas.

**Casos sin resultados:** `"Ensalada de Quinoa con Palta"` y `"Guacamole casero"` → `201` con `image: null` y sin warning (Unsplash devolvió `results: []`, verificado con una búsqueda directa). Ver el hallazgo en design.md 11.2.
