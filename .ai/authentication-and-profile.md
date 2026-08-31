# Authentication and profile

## Outcome

A user can authenticate and maintain the preferences required to personalize NutrIA without exposing another user's data.

## Includes

- Identity and session lifecycle.
- Nutrition goal, dietary preferences, allergies/restrictions and practical preferences.
- A profile view that can be updated safely.

## Rules

- Validate input at the API boundary and enforce ownership on every profile read/write.
- Restrictions must be explicit data, not inferred from free text alone.
- Profile data personalizes meal plans; it is not clinical diagnosis.
- Empty, loading, validation and authorization-error states are required in UI.

## Evidence

Acceptance criteria cover signup/signin, profile completion, restriction edits, user isolation and mobile/desktop interaction.
