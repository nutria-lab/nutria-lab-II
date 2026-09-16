# Plan for NUT-20

Timestamp: 2026-09-16T13:06:00Z

## Files to modify
- `apps/api/prisma/models/recipe.prisma` (Add `RecipeCategory` enum, `categories`, `nutritionalValues`, `properties` to `Recipe` model)
- `apps/api/prisma/models/ingredient.prisma` (Add `description`, `defaultUnit`, `properties` to `Ingredient` model)
- `apps/api/prisma/seed.ts` (Update fixtures)
- `apps/api/src/modules/recipe/dto/create-recipe.dto.ts`
- `apps/api/src/modules/recipe/dto/update-recipe.dto.ts`
- `apps/api/src/modules/ingredient/dto/create-ingredient.dto.ts`
- `apps/api/src/modules/ingredient/dto/update-ingredient.dto.ts`
- `apps/api/src/modules/recipe/recipe.repository.ts` (properties normalization)
- `apps/api/src/modules/ingredient/ingredient.repository.ts` (properties normalization)
- `apps/api/src/modules/recipe/tests/recipe.service.spec.ts` (Add tests for validation/normalization)
- `apps/api/src/modules/ingredient/tests/ingredient.service.spec.ts` (Create or update tests for validation/normalization)
- `apps/api/src/modules/plans/tests/plans.repository.spec.ts` (Create compatibility test for `PlansRepository`)

## Steps
1. Modify Prisma models.
2. Generate migration (`pnpm -w prisma migrate dev --name add_recipe_ingredient_fields` or similar). Wait, I might just use `pnpm dlx prisma format` and `pnpm dlx prisma migrate dev --name ...`.
3. Update `DTO` classes for both models.
4. Implement normalization logic in `repositories` or `services`. Since the user mentioned "El backend normaliza...", I can do it in a custom ValidationPipe, Transform decorator, or Repository.
5. Create tests in `*.spec.ts`.
6. Update seed.ts.
7. Run tests.
