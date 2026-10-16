# Implementation plan

Generated: 2026-10-16.

## Scope

Work directly in the detached local source copy. The TL prohibits subagents and push. Production observation is authorized; deployment and production data changes are outside this fix.

1. Add failing PostgreSQL regressions in `apps/api/src/modules/kpi/tests/kpi-event-writer-latency.integration.spec.ts`. Use a local TCP proxy delaying server responses, the real `createKpiPrismaClient`, and persisted-row assertions for HTTP and dependency closure.
2. In `apps/api/src/modules/kpi/db/kpi-prisma.ts`, separate the client network timeout from the SQL and caller-wait limits.
3. In `apps/api/src/modules/kpi/events/kpi-event-writer.ts`, expose an optional assembly-owned lifetime callback for actual in-flight write promises, preserving non-fatal error handling.
4. Wire the documented Vercel `waitUntil` hook in `apps/api/src/modules/kpi/kpi.module.ts`, with the dependency recorded in `apps/api/package.json` and `pnpm-lock.yaml`.
5. Cover the lifetime callback and pool limits in `apps/api/src/modules/kpi/tests/kpi-event-writer.spec.ts`; cover application assembly if needed. Update `docs/telemetry-local.md` with reproducible latency verification and validation limits.
6. Validate focused regressions, all KPI/access suites, lint and build sequentially where Prisma generation is involved. Review the resulting diff directly without agents. Package a non-secret incremental patch if useful for applying this detached-copy fix.

## Validation evidence

- Before implementation, both real-PostgreSQL latency regressions failed: terminal rows remained `pending` with null duration and finish time.
- The detached local copy passed 49 KPI/access suites and 853 tests, plus API lint and build.
- The incremental patch applied cleanly to GitHub main `8a84bc40093efbafa9de596027b7ee40996c95e5`. Its package preserves main's newer `kpi:catalog` script.
- The patched main copy passed 51 KPI/access suites and 884 tests, including both latency regressions and the Vercel retention wiring test.
- API lint and build also passed on the patched main copy.
- No remote environment, database rows or deployment was changed. The disposable local PostgreSQL instance is the only write target.
