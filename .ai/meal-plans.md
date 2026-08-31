# Meal plans

## Outcome

A user receives an editable, day-organized weekly plan aligned to explicit profile preferences and restrictions.

## Lifecycle

1. Read the current profile snapshot and plan request.
2. Generate a structured candidate plan through the AI boundary.
3. Validate it before persistence or display.
4. Persist an immutable generation context/version and expose the active plan.
5. Allow a user to edit a meal without silently rewriting unrelated meals.

## Rules

- Invalid AI output becomes a recoverable failure, never a fabricated fallback.
- Never promise medical suitability, weight-loss outcomes, or treatment.
- A plan and its edits must be auditable by version/context.
- The shopping list derives from the active plan; plan edits must refresh that relationship.
