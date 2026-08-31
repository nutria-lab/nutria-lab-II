# Shopping list

## Outcome

A user receives a consolidated list of ingredients derived from their active plan.

## Rules

- Derive items from the active plan; do not maintain a divergent manual duplicate as source of truth.
- Normalize quantities and units only when conversion is safe; otherwise keep source quantities explicit.
- Recompute after plan changes and preserve user check-off state only when matching is unambiguous.
- Do not imply price, store availability or delivery logistics; these are out of scope.
