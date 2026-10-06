# NUT-77 — plan.md

> Generado: 2026-10-06T07:13:12Z, a partir de `design.md` de esta carpeta, sobre la rama `mariajoserosalestorres/nut-77-reemplazar-una-comida-sin-modificar-el-resto-del-plan` (sale de `main` en `6d2e235`; no incluye NUT-83). CodeGraph no estuvo disponible; se exploró con Glob/Grep/Read. Rutas relativas a `apps/api/`.

## 1. Endpoint

- `src/modules/plans/plans.controller.ts:54` `replaceMeal`: `POST :planId/meals/:plannedMealId/replace`. Valida el header `Idempotency-Key` con `isUUID` (400) y los ids con `uuidOr404` (`:9`, `ParseUUIDPipe` que responde 404, design D7). Usa el mismo `JwtAuthGuard` de cookie que el resto del controller.
- `src/modules/plans/dto/replace-meal.dto.ts`: `ReplaceMealDto` (exportado en `dto/index.ts`).
- `src/modules/plans/plans.module.ts`: importa `RecipeModule` y registra `MealReplacementService`.
- `.env.example`: `MEAL_REPLACEMENT_PENDING_TTL_MINUTES` (design D3b).

## 2. Servicio (`src/modules/plans/meal-replacement.service.ts`)

| Símbolo | Línea | Design |
|---|---|---|
| `replaceMeal` (dueño, idempotencia, expiración, envoltorio de errores) | 56 | §4, D3, D3b, D7 |
| `runReplacement` (catálogo o IA + transacción) | 121 | D4, D5, D8 |
| `isStalePending` | 164 | D3b |
| `normalizeCriteria` | 173 | D3 (huella normalizada) |
| `replayExistingRun` | 184 | D3 |
| `findCatalogRecipe` | 199 | D4 |
| `generateRecipe`, `recipeTags`, `meetsCriteria` | 233, 287, 296 | D5 |

## 3. Repositorio (`src/modules/plans/plans.repository.ts`)

- `:7` `ACTIVE_RUN_STATUSES`; `:353` `createOrRecoverGenerationRun`: recupera sólo runs activos priorizando el terminado y reintenta crear una vez (compartido con el plan semanal).
- `:10` `MealReplacementConflictError`; `:434` `findPlanWithMeals`; `:446` `replaceMealTransaction`.

## 4. IA, restricciones y estados

- `src/modules/plans/gemini/gemini.service.ts:104` `generateReplacementMeal`; `src/modules/plans/gemini/prompts.ts:118` `REPLACEMENT_PROMPT_VERSION` (el schema pide `categories` y `properties`).
- `src/modules/plans/meal-restrictions.util.ts`: `RESTRICTION_KEYWORDS:9`, `RESTRICTION_EXCEPTIONS:40`, `findRestrictionViolation:68` (D5b). La usa también `PlansService.validateRestrictions` (plan semanal).
- `src/modules/plans/generation-run-state-machine.ts:23`: `PENDING → EXPIRED` habilitado (D3b).

## 5. Base de datos

Sin cambios de esquema ni migraciones.

## 6. Tests (todos en `src/modules/plans/`, con Prisma y Gemini mockeados)

| AC | Archivo |
|---|---|
| 1 Reutiliza sin IA | `tests/meal-replacement.service.spec.ts` |
| 2 Genera cuando falta | `tests/meal-replacement.service.spec.ts`, `tests/gemini-replacement.spec.ts` |
| 3 Sólo la comida objetivo / 4 receta anterior no se borra | `tests/plans-replace-meal.repository.spec.ts` |
| 5 Restricciones (en español) | `tests/meal-restrictions.util.spec.ts`, `tests/plans-restrictions.spec.ts` (plan semanal), `tests/meal-replacement.service.spec.ts` |
| 6 Plan/comida ajenos | `tests/meal-replacement.service.spec.ts`, `tests/plans.controller.spec.ts` (id inválido → 404) |
| 7 Idempotencia y concurrencia | `tests/meal-replacement.service.spec.ts`, `tests/plans.repository.spec.ts` (FAILED + SUCCEEDED), `tests/plans-replace-meal.repository.spec.ts`, `generation-run-state-machine.spec.ts` |
| 8 Rollback | `tests/meal-replacement.service.spec.ts`, `tests/plans-replace-meal.repository.spec.ts` |
| 9 Validación | `tests/replace-meal.dto.spec.ts`, `tests/plans.controller.spec.ts` |

## 7. Evidencia — prueba real (2026-10-06, API con `pnpm dev`, base local `nutria-postgres`)

Plan de 7 días × 2 comidas de un usuario nuevo, perfil `diet: ALL`.

- **Reemplazo desde el catálogo:** 200 con `planId`, `version: 1`, `dayId`, `plannedMeal { id, mealType, title, recipeId, recipe completa }` y `generationRunId`; `outputSnapshot.path = REUSED_EXISTING_RECIPE`.
- **Misma clave y mismo pedido:** 200 con el mismo `recipeId` y el mismo `generationRunId`.
- **Misma clave y otro pedido:** 409 `This Idempotency-Key was already used for a different request`.
- **Concurrencia:** 5 rondas de dos reemplazos simultáneos con distinta clave sobre el mismo plan → las 5 dieron un 200 y un 409 (`The meal plan changed during the replacement; retry`).
- **Base después:** 6 runs `SUCCEEDED` (cada comida apunta exactamente a la receta de su run), 5 runs `FAILED / CONCURRENT_CONFLICT`, las 8 comidas no reemplazadas conservan su receta original, el plan mantiene sus 14 comidas (mismos ids, 7 días, 7 LUNCH + 7 DINNER) y las 14 recetas originales siguen en el catálogo.
- **Rollback en Postgres** (`replaceMealTransaction` real): con la receta nueva creada y la actualización de la comida fallando (P2025), quedan 0 recetas huérfanas y no cambian ni el `updatedAt` del plan ni la comida; con el plan modificado, `MealReplacementConflictError` antes de escribir.
- **Camino de IA:** `maxPrepMinutes: 1` (sin candidatas en el catálogo) → 503 en 1,3 s, run `FAILED / AI_PROVIDER_ERROR`, comida sin cambios. Gemini no respondió con la configuración local (`gemini-1.5-flash` + `GEMINI_API_KEY` del `.env`), así que el 200 por IA no se pudo verificar en real; está cubierto sólo por tests con mocks.
