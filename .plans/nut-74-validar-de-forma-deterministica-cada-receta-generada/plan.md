# NUT-74 — plan.md

> Generado: 2026-10-06, a partir de `design.md` de esta carpeta, sobre la rama `mariajoserosalestorres/nut-74-validar-de-forma-deterministica-cada-receta-generada` (sale de NUT-77 en `9c046eb`). CodeGraph no estuvo disponible; se exploró con Grep/Read. Rutas relativas a `apps/api/`.

## Fase 1 — Validador puro (design D1–D9)

Carpeta nueva `src/modules/recipe/validation/`:

| Archivo | Contenido |
|---|---|
| `recipe-validation.types.ts` | `ValidationResult`, `RecipeDraft`, `ValidationError`, `ValidationWarning`, códigos y etapas |
| `recipe-validation.config.ts` | Todos los valores de D4, D5, D8 y los rangos, con su estado (aprobado por el TL / pendiente) |
| `ingredient-dictionary.ts` | Palabras clave y excepciones movidas desde `src/modules/plans/meal-restrictions.util.ts` (se borra), más los grupos carne/pescado/huevo/miel; `findIngredientGroup`, `findExcludedIngredient`, `forbiddenRestrictions` |
| `parse-generated-output.ts` | `parseJsonOutput`, `parseGeneratedOutput` |
| `validate-recipe.ts` | `validateRecipe`, `validateRecipes`, `reusableRecipeId`, `summarizeResults`, `summarizeParseFailure` |

- Huella compartida: `src/modules/recipe/recipe-fingerprint.util.ts` (`recipeFingerprint`, `normalizeRecipeText`, `normalizeRecipeTitle`), extraída de `RecipeCoverageService.fingerprint`/`normalizedText` (`src/modules/recipe/recipe-coverage.service.ts:165-190`).
- Tests: `src/modules/recipe/tests/recipe-validation.fixtures.ts`, `validate-recipe.spec.ts`, `parse-generated-output.spec.ts`, `ingredient-dictionary.spec.ts` (reemplaza `src/modules/plans/tests/meal-restrictions.util.spec.ts`), `recipe-fingerprint.util.spec.ts`.

## Fase 2 — Adaptador de Gemini (design D11)

- `src/modules/plans/gemini/gemini.service.ts`: `generateMealPlan` y `generateReplacementMeal` devuelven `string` (texto crudo). Las fallas del proveedor lanzan `AiProviderUnavailableError`. Se quitan `GeneratedMealPlanDay`/`GeneratedReplacementMeal` si quedan sin uso.
- Tests: `src/modules/plans/tests/gemini-replacement.spec.ts`, más un `gemini-meal-plan.spec.ts` nuevo.

## Fase 3 — Servicio de validación (design D10)

- `src/modules/plans/recipe-validation.service.ts`: `validateDrafts`, `reject`, `record`, `mealToDraftInput`.
- `src/modules/recipe/recipe.repository.ts`: `findByNormalizedTitles(titles)` (SQL de sólo lectura).
- `src/modules/plans/plans.repository.ts`: `recordGenerationRunValidation(id, userId, snapshot)` (sin cambio de estado).
- `src/modules/plans/plans.module.ts`: registra el servicio.
- Tests: `src/modules/plans/tests/recipe-validation.service.spec.ts`, más `recipe.repository.spec.ts` y `plans.repository.spec.ts`.

## Revisión (4 reviewers) — correcciones aplicadas

- Validador: `parse-generated-output.ts` (fence sin importar mayúsculas), `validate-recipe.ts` ("1.000", redondeo, `reusableDuplicate`, textos vía `restrictionTexts`), `ingredient-dictionary.ts` (`restrictionTexts`, negaciones "sin X"), `recipe-validation.types.ts` (`normalizedRecipe` en el duplicado).
- `src/modules/plans/gemini/gemini.service.ts`: `signal` en el primer nivel y `AI_TIMEOUT` por señal abortada (D11).
- `src/modules/plans/generation-run-ttl.ts` (nuevo): `isStalePendingRun`, compartido por el reemplazo y el plan semanal (D12).
- `src/modules/plans/recipe-validation.service.ts`: sin `record`/`batchDuplicates`; `rejectWithCode`; log `recipe_validation_reject_persist_failed`.
- `src/modules/plans/plans.service.ts`: TTL, `generateForRun` con envoltorio de errores, `failRun`, envoltorio validado con la receta normalizada también para duplicados.
- `src/modules/plans/meal-replacement.service.ts`: TTL compartido, `rejectWithCode`, no reutiliza la receta actual de la comida.
- `src/modules/plans/plans.repository.ts`: se quita `recordGenerationRunValidation`.
- `src/modules/recipe/recipe.repository.ts`: `lower(unaccent(title))` y selecciona `instructions`.
- Frontend: `apps/web/src/services/recipeService.ts`, `apps/web/src/modules/recipes/components/detail/RecipeDetailContent.tsx`, `apps/web/src/modules/recipes/components/RecipeForm.tsx`.

## Fase 4 — Integración (design §3)

- `src/modules/plans/plans.service.ts`: `generateAndPersistPlan` (`:146-215`) usa el servicio; `validateRestrictions` (`:428`) usa `findExcludedIngredient`.
- `src/modules/plans/meal-replacement.service.ts`: `generateRecipe` (`:268`) usa el servicio; se eliminan `recipeTags` y el uso de `meal-restrictions.util`; `findCatalogRecipe` (`:240`) usa `findExcludedIngredient`.
- `src/modules/plans/plans.repository.ts`: `createDaysMealsAndRecipes` (`:122`) reutiliza `reuseRecipeId` en vez de crear una receta. `createPlanTransaction` recibe un `validationSnapshot` opcional (6.º parámetro) y lo guarda al pasar a `SUCCEEDED`; sin él queda `{ restrictionsChecked: true }`. `validateAndPersistPlan` lo recibe como 4.º parámetro opcional.
- `src/modules/plans/dto/recipe.dto.ts`: `IngredientDto.quantity` acepta `null`.
- Tests: `plans.service.spec.ts`, `plans-restrictions.spec.ts`, `meal-replacement.service.spec.ts`, `plans.repository.spec.ts`, `plans.dto.spec.ts`.
