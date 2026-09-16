# Design for NUT-20: Recipe & Ingredient Contract

## Decision Record
- Introduce `RecipeCategory` enum in Prisma.
- Add `categories` (`RecipeCategory[]`), `nutritionalValues` (`Json?`), and `properties` (`String[]`) to `Recipe`.
- Add `description` (`String?`), `defaultUnit` (`String?`), and `properties` (`String[]`) to `Ingredient`.
- The `Recipe` missing fields default to arrays or null to remain compatible with `PlansRepository` implicit creation without breaking existing records.
- Properties for both are user-defined strings, backend normalizes them (trim, dedup, etc.).
- Nutritional values are manual and stored in a Json column.

## Architecture
- `Prisma Schema`: Additive fields and enum.
- `DTOs`: Update to include the new fields. Ensure ValidationPipe rules are enforced.
- `Repositories`: Implement normalization logic for properties. Ensure `PATCH` replaces arrays.

## Flows
- **Recipe Creation/Update**: Client sends array for properties/categories. Backend normalizes properties.
- **Ingredient Creation/Update**: Client sends `nutritionalValues` containing `sodium` inside JSON.
- **Meal Plans**: Unchanged, defaults will naturally keep integration working.

## Acceptance Criteria
- Migration applied without data loss.
- `Recipe` & `Ingredient` endpoints map the required fields.
- `properties` strings are normalized.
- Backward compatibility for Meal Plans tested and verified.

## Required Tests
- E2E or Unit tests for `Recipe` and `Ingredient` updating arrays/properties normalization.
- Compatibility test for `PlansRepository` creating a recipe without sending metadata fields.

## Database Strategy
- Single non-destructive migration.
