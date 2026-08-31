# NutrIA knowledge base

This is the project-specific operating map for humans and agents. Read this index first, then open only the module relevant to the task.

## Product modules

| Module | Purpose | Source |
|---|---|---|
| [authentication-and-profile](authentication-and-profile.md) | Accounts, identity, goals, preferences and restrictions | Product / backend / frontend |
| [meal-plans](meal-plans.md) | Weekly plan lifecycle and user edits | Product / AI / backend |
| [recipes](recipes.md) | Recipe display, ingredients and preparation | Product / frontend / backend |
| [shopping-list](shopping-list.md) | Aggregated ingredients derived from the active plan | Product / backend / frontend |
| [adherence](adherence.md) | Meal logging and adherence percentage | Product / backend / frontend |

## Operating modules

| Module | Use when |
|---|---|
| [architecture](architecture.md) | Choosing boundaries, API contracts or ADRs |
| [frontend-and-stitch](frontend-and-stitch.md) | Creating or changing web UI; use Stitch, not Figma |
| [ai-generation-safety](ai-generation-safety.md) | Changing AI plan generation or prompts |
| [database-and-migrations](database-and-migrations.md) | Changing Prisma schema, SQL or Neon |
| [quality-and-testing](quality-and-testing.md) | Preparing or assessing tests and QA evidence |
| [delivery-and-linear](delivery-and-linear.md) | Managing status, cycles, estimates, hours or blockers |
| [release-and-evidence](release-and-evidence.md) | Reviewing PRs, releasing, rollback, and final documentation |
| [memory-and-engram](memory-and-engram.md) | Recalling or saving durable project knowledge |
| [codegraph](codegraph.md) | Exploring code structure, calls, dependencies and impact |

## Rules of use

1. Linear is the current work source; this folder is the enduring project guide.
2. Do not read every module by default. Load the smallest relevant module.
3. When an approved decision changes a module, update that module and save a curated Engram observation.
4. Never place secrets, tokens, PII, or production database data in `.ai/`.
