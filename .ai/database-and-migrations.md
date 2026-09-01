# Database and migrations

## Safety baseline

Use Neon MCP only with a development branch and anonymized/sample data. Never use an agent or MCP against production data.

## Two-commit migration protocol

### Commit 1 — generate and review

1. Update the Prisma schema and validate the intended domain model.
2. Generate the migration files locally.
3. Inspect generated SQL for destructive operations, locks, data backfills and rollback feasibility.
4. Commit **schema + generated migration files + tests**, but do **not** execute it against shared environments.
5. Open a PR/Linear review with expected impact and a rollback plan.

### Commit 2 — execute and prove

1. After TL approval, apply the already-reviewed migration to a Neon development branch/staging only.
2. Run focused integration tests and schema verification.
3. Commit only the execution evidence/configuration change that is genuinely versioned; otherwise attach evidence to the PR and Linear issue rather than fabricating a code commit.
4. Promote to production only through the approved deployment path, with human TL approval and a rollback decision.

## Rules

- Never combine unreviewed schema generation and shared-environment execution in a single commit.
- Prefer expand/contract changes for breaking schema changes: add compatible structure, migrate/backfill, switch readers/writers, then remove in a later approved change.
- Agents may propose migrations; a human TL approves execution.
