# NUT-78 — plan.md

> Generado: 2026-10-06, a partir de `design.md` de esta carpeta, sobre la rama `mariajoserosalestorres/nut-78-regenerar-la-semana-como-una-nueva-version-del-plan` (commit `5936424`: NUT-74 + ajustes de revisión). CodeGraph no estuvo disponible; se exploró con Grep/Read. Rutas relativas a `apps/api/`.

## Fase 2 — DTO, controller, dueño/current/idempotencia

- `src/modules/plans/dto/regenerate-meal-plan.dto.ts` (nuevo): enum `RegenerationReason` y `RegenerateMealPlanDto`; exportado en `dto/index.ts`.
- `src/modules/plans/plans.controller.ts`: `POST :planId/regenerate` (201), `uuidOr404`, validación de `Idempotency-Key` igual que `replaceMeal` (`:54`).
- `src/modules/plans/meal-plan-regeneration.service.ts` (nuevo): dueño/perfil, `createOrRecoverGenerationRun` con TTL (`generation-run-ttl.ts`), replay por `generationRunId`, chequeo de current.
- `src/modules/plans/plans.repository.ts`: `findPlanByGenerationRunId(runId, userId)`.
- `src/modules/plans/plans.module.ts`: registra el servicio.
- Tests: `tests/meal-plan-regeneration.service.spec.ts`, `tests/regenerate-meal-plan.dto.spec.ts`, `tests/plans.controller.spec.ts`.

## Fase 3 — Mínimo de NUT-76

- a) Sin código nuevo de búsqueda (design §6a): test de reuso de una receta de la versión anterior (`reuseRecipeId`, sin `recipe.create`).
- b) `src/modules/plans/plans.repository.ts` `deletePlanTransaction` (`:82`): deja de borrar recetas; `plans.service.ts` `deletePlan` (`:396`) deja de juntar `recipeIds`.
- Tests: `tests/plans.repository.spec.ts`, `tests/plans.service.spec.ts`.

## Fase 4 — Composición y "propuesta diferente"

- `src/modules/plans/weekly-proposal.composer.ts` (nuevo): `composeWeeklyProposal` extraído de `PlansService.generateForRun`/`validateGeneratedDays` (Gemini + NUT-74); `PlansService.generateAndPersistPlan` pasa a usarlo.
- `src/modules/plans/proposal-difference.ts` (nuevo): huellas por franja y `hasMaterialChange(previousPlan, proposal)`.
- Tests: `tests/weekly-proposal.composer.spec.ts`, `tests/proposal-difference.spec.ts`, más la regresión de `plans.service.spec.ts`.

## Fase 5 — Transacción de regeneración

- `src/modules/plans/plans.repository.ts` `updatePlanTransaction` (`:312`): `updateMany` condicional sobre el plan esperado (0 filas → 409), `recipeOrigin` y `validationSnapshot` como opciones; el `PUT` sigue funcionando igual.
- Tests: `tests/plans.repository.spec.ts`.

## Fase 6 — Integración

- `meal-plan-regeneration.service.ts`: composición, diferencia con reintento, imágenes (`UnsplashService`), transacción, tracking y respuesta 201 con el plan completo (filtro de imagen pública compartido con `getPlanByWeek`).
- Tests: flujo completo en `tests/meal-plan-regeneration.service.spec.ts` (incluye `GET current` después de regenerar); suite completa y typecheck (`--ignoreDeprecations 5.0`).

## Implementado (resumen por fase)

- **Fase 2:** `dto/regenerate-meal-plan.dto.ts`, `plans.controller.ts` (`regeneratePlan`, `assertIdempotencyKey` compartido con `replaceMeal`), `meal-plan-regeneration.service.ts`, `meal-plan-response.ts` (`toPublicMealPlan`, usado también por `getPlanByWeek`), `plans.repository.ts` (`findPlanByGenerationRunId`), `plans.module.ts`.
- **Fase 3:** `plans.repository.ts` (`deletePlanTransaction(planId)` sin borrar recetas), `plans.service.ts` (`deletePlan`).
- **Fase 4:** `weekly-proposal.composer.ts`, `proposal-difference.ts`, `plans.service.ts` (usa el compositor), `plans.repository.ts` (`findPlanWithMeals` con recetas), `plans.module.ts` (token del compositor).
- **Fase 5:** `plans.repository.ts` (`updatePlanTransaction` con `SupersedeOptions` y `updateMany` condicional).
- **Fase 6:** `meal-plan-regeneration.service.ts` (composición con hasta 2 intentos, imágenes, transacción, tracking, 201), `recipe-validation.service.ts` (`NO_DIFFERENT_PROPOSAL`), `plans.service.ts` (helpers de imágenes públicos). Test de flujo con el repositorio real sobre una base en memoria: `tests/meal-plan-regeneration.flow.spec.ts`.
