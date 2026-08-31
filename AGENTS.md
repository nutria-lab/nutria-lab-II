# NutrIA Development Agent Workflow

Spawn only the next stage for a bounded change. Every agent must read this file and the listed skills before acting.

1. `*_designer` writes only `.plans/<session>/design.md`: decision record, architecture, flows, stories, acceptance criteria, required tests, Prisma/database/migration strategy. Do not name repository files.
2. `*_explorer` reads that design, locates concrete files/symbols, and writes only `.plans/<session>/plan.md` with references and a generation timestamp.
3. `*_tester` writes or changes only `*.test.ts` / `*.spec.ts`. It must create a failing test before implementation and report the red result.
4. `*_implementer` reads the plan and makes the smallest change that turns the existing tests green. Tester and implementer may repeat until all focused tests pass.
5. Spawn the four reviewers in parallel: `*_review_risk`, `*_review_readability`, `*_review_reliability`, `*_review_resilience`. A parent agent synthesizes their findings; the PR is ready only if no blocker/critical finding remains.
6. Finally `linear_time_registration` compares planned and actual time, adds completed work and cumulative hours to the Linear issue description, and adds a comment only when useful. It never changes issue status.

Path restrictions are mandatory agent instructions; Codex does not provide per-agent writable-path allowlists.

## Inventory and context

Read `.ai/index.md` first. Load `.ai/architecture.md` and `.ai/quality-and-testing.md` for every change; load `.ai/database-and-migrations.md` for backend/schema work, `.ai/frontend-and-stitch.md` for frontend, and `.ai/release-and-evidence.md` for review/release. Agent inventory and minimum MCP libraries are in `bundles/agent-libraries.json`.
