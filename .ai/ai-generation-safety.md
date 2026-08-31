# AI generation safety

## Outcome

Meal plans are helpful, structured and bounded by the user's declared goal, preferences and restrictions.

## Required controls

- Versioned prompt and structured response schema.
- Server-side validation before persistence/display.
- Evaluation fixtures: dietary restrictions, malformed output, empty output and contradictory input.
- Recoverable failure state with a clear retry path.
- No diagnostic, treatment, clinical or guaranteed-result claim.

## Change evidence

A change to prompt/schema must include its reason, compatibility impact, evaluation result and rollback plan.
