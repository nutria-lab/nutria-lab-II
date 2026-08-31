# Adherence

## Outcome

A user can log meal completion and see plan adherence without judgmental or clinical messaging.

## Metric

`adherence % = completed planned meals / planned meals × 100`

## Rules

- Record completion against a specific planned meal and date.
- Distinguish skipped, not-yet-logged and completed states.
- Do not convert adherence into health diagnosis or prescribing advice.
- Make edits idempotent so repeated interactions do not duplicate records.
