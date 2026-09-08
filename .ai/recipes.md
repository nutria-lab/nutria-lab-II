# Recipes

## Outcome

A user can open a planned meal and view its nutritional values, title, and optionally its associated recipe (preparation steps, cook/prep times).

## Rules

- The `PlannedMeal` owns the meal's title and nutritional values (JSON).
- A `Recipe` is purely an instructional catalog item (`steps`, `prepMinutes`, `cookMinutes`) that can be optionally attached to a `PlannedMeal`.
- We do not manage specific servings in the core model.
- Keep ingredients structured to support shopping-list aggregation using their `IngredientType`.
- Explain preparation clearly; do not introduce clinical nutritional claims.
- UI must cover unavailable recipe, incomplete ingredients and loading/error states.

## Dependencies

Recipes depend on the active plan and provide input to the shopping-list module.
