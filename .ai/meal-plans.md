# Meal plans

## Outcome

A user receives an editable, day-organized weekly plan aligned to explicit profile preferences and restrictions.

## Lifecycle

1. Read the current profile snapshot and plan request.
2. Generate a structured candidate plan through the AI boundary.
3. Validate it before persistence or display.
4. Persist the active plan directly based on the user and start date.
5. Allow a user to edit a meal directly by overwriting the specific meal's fields.

## Rules

- Invalid AI output becomes a recoverable failure, never a fabricated fallback.
- Never promise medical suitability, weight-loss outcomes, or treatment.
- The plan is a simple CRUD model linked to the user's requested week.
- The shopping list derives from the active plan; plan edits must refresh that relationship.

## NUT-76 catalog classification

- Existing Recipes may be classified for `BREAKFAST`, `LUNCH`, `SNACK`, or `DINNER` by the internal AI classifier. Its recipe payload contains only `title` and `ingredients`; it does not receive identifiers, profile data, categories, properties, images, or other metadata.
- Before classification, the composer applies the existing local profile restriction dictionary to catalog candidates. If the profile has no supported deterministic policy (currently KETO/PALEO), catalog reuse stays disabled and the existing profile-aware AI generation path handles the plan; this does not define a strict macro rule.
- Classification is structured, paginated, ephemeral, and used as edges for the deterministic maximum matching. The app does not persist a `mealType` on Recipe or infer mealType with local title/category/property heuristics.
- Invalid or unavailable classification fails recoverably. It must not silently turn into “no compatible Recipes” and trigger generation for every slot. Classification and recipe generation are audited separately.
- This rule does not settle strict KETO/PALEO eligibility, recipe repetition versus AI generation, or future `weekStart` hardening.
