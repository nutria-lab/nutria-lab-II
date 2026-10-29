# Verify telemetry locally

The GitHub `KPI Telemetry` workflow invokes `kpi:telemetry`. It probes `/health`, then sends a bearer-authenticated POST to `/kpi/telemetry/sample`. The backend persists the current health sample in NutrIA PostgreSQL. Telemetry has no finalize mode, historical-date input, previews, or KPI snapshot dependency. Publish collects the eight technical metrics and three business metrics from current event and business tables when preparing its initial batch, then posts that frozen batch to Supabase.

The business `adherence_rate` observes the database state when collection begins. It counts meals on current plans whose stored civil date is less than or equal to the current date in `America/Argentina/Buenos_Aires`; today's meals are eligible and future meals are excluded. `effectiveMealStatus` determines whether a completion is valid against the current meal snapshot. The numerator and denominator are summed across meals, not averaged across users. `0/N` is an observed zero; `0/0` is unavailable with `NO_ELIGIBLE_MEALS`. If this source is unavailable, the evidence reports unknown counts and `SOURCE_UNAVAILABLE`. It does not reconstruct a prior state at the report window's 21:00 cutoff. The rate's aggregate counts and collection context remain in frozen internal diagnostics and are absent from the external measurement payload.

An existing frozen ten-measurement publication remains unchanged for retries. New collections freeze all eleven IDs. A remote rejection is a failed, visible publication; the publisher does not omit or split `adherence_rate` to fit a remote limit. See [ADR-0003](adr/0003-adherence-rate-current-state-kpi.md) for the collection and compatibility decision.

## Terminal events and network latency

Runtime logs identified `KPI_WRITE_TIMEOUT op=close_http sqlstate=none code=CLIENT_QUERY_TIMEOUT`: the former 150 ms client query deadline could expire while a valid database response was still in transit. A successful pending insert followed by a failed terminal update left the event without a duration. The same writer handles HTTP and dependency events.

The writer now separates three limits:

- Caller wait: 250 ms, preserving the existing bound on business-request overhead.
- SQL execution: 100 ms per statement, applied with `SET LOCAL` inside the transaction.
- Client query/network response: 5000 ms, allowing network round trips without cancelling otherwise valid writes.

Application assembly passes Vercel's documented [`waitUntil`](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#waituntil) hook to the writer. It retains the actual persistence promise after the caller's bounded wait, until the task settles or the platform's function-duration limit is reached. Other runtimes do not need the Vercel request context. Error handling remains non-fatal to the business request.

With the disposable PostgreSQL instance below running, reproduce the network boundary with:

```sh
KPI_TEST_DATABASE_URL=postgresql://postgres:local-kpi-only@127.0.0.1:55432/nutria_kpi \
  npx --yes pnpm@9.0.0 --filter api exec jest --runInBand --runTestsByPath \
  src/modules/kpi/tests/kpi-event-writer-latency.integration.spec.ts \
  src/modules/kpi/tests/kpi-task-retention.spec.ts
```

The latency regression uses the actual runtime writer and a local TCP proxy delaying database responses by 200 ms. It verifies stored terminal rows for both HTTP and dependencies, rather than replacing the production query budget with a special test client. Unit tests verify that retained tasks outlive the bounded caller wait and that application assembly invokes `waitUntil`.

The fix preserves the chosen `KPI_ENV`; changing it during testing can legitimately leave both `dev` and `prod` records in one database branch. It introduces no schema migration and does not rewrite old pending rows, whose actual outcomes and durations cannot be inferred reliably.

Validation on 2026-10-16: both latency regressions failed before the fix, then passed with persisted terminal results. The patched GitHub main revision `8a84bc40093efbafa9de596027b7ee40996c95e5` passed all 51 KPI/access suites (884 tests), API lint and API build. Tests wrote only to disposable localhost PostgreSQL. The new code has not been deployed; production persistence must be checked again after deployment.

## Reproduced failure and fix

The deployed sample endpoint returned HTTP 401 with `code: ACCESS_GATE_REQUIRED`. The browser access middleware intercepted the request before `KpiInternalAuthGuard`, so even a correct internal token could not reach its guard without a browser cookie. The fix exempts only the nine existing internal KPI POST paths from that cookie requirement. Their controllers still require `KpiInternalAuthGuard`; missing or wrong tokens remain unauthorized. Business paths, unknown KPI paths, and other HTTP methods remain gated.

Publication endpoints have the same cookie exemption and retain their bearer guards. Technical collection reads aggregates in a repeatable-read transaction; business collection queries the business tables. Neither logger reads or generates KPI snapshots. Once a publication batch is frozen, retries reuse its exact bytes for idempotency. If raw telemetry was purged, collection reports `PURGED_WINDOW`; historical snapshots are not used. The current Prisma schema and retention policy no longer include `kpi_snapshot`. The original creation migration remains unchanged; a new migration drops the retired table.

## Reproduce the full local path

Use Node 24, Docker, and the repository's pinned pnpm 9. Run from the repository root. Do not source `apps/api/.env`: the test creates synthetic configuration and overrides database connections before importing the application.

```sh
npx --yes pnpm@9.0.0 install --frozen-lockfile
npx --yes pnpm@9.0.0 --filter api run prisma:generate

docker run --detach --rm --name nutria-telemetry-local-401 \
  --publish 127.0.0.1:55432:5432 \
  --env POSTGRES_PASSWORD=local-kpi-only \
  --env POSTGRES_DB=nutria_kpi postgres:17
docker exec nutria-telemetry-local-401 pg_isready --username postgres --dbname nutria_kpi

KPI_TEST_DATABASE_URL=postgresql://postgres:local-kpi-only@127.0.0.1:55432/nutria_kpi \
  npx --yes pnpm@9.0.0 --filter api exec jest --runInBand --runTestsByPath \
  src/modules/access/access-gate.http.spec.ts \
  src/modules/kpi/kpi-internal-auth.guard.spec.ts \
  src/modules/kpi/tests/telemetry-http.integration.spec.ts

docker stop nutria-telemetry-local-401
```

Wait for `pg_isready` to report accepting connections before running the tests. The container uses disposable storage and localhost binding. The test refuses non-local database hosts, applies migrations only in a disposable schema, starts the actual `AppModule` on a random localhost port, and launches the real telemetry CLI in child processes. It removes its schema and temporary diagnostics afterwards. No real application or Supabase credentials are required.

The assertions prove persisted rows, repeated-bucket idempotency, a successful HTTP path with direct CLI database access unavailable, and a rejected-token path that does not bypass the 401 through direct database writes. The collection test applies the complete migration history in its disposable schema, verifies that the snapshot table is absent, and still collects all ten metrics through the real API. A newly inserted event changes the next result. A separate migration test verifies preservation of health samples and publication state, while removing the retired snapshot table.

To run the complete KPI/access regression set, use the same local database variable with:

```sh
npx --yes pnpm@9.0.0 --filter api exec jest --runInBand src/modules/kpi src/modules/access
```

The workflow scheduler, GitHub environments, artifact uploads, and deployed backend are not emulated by this command. It runs the telemetry command and its actual local integration. A green GitHub job alone is not delivery evidence: inspect persisted health samples and diagnostics; Supabase delivery additionally requires publisher acceptance and remote verification.

## Credential boundaries and deployment verification

- `KPI_INTERNAL_TOKEN`: matching secret in GitHub's selected environment and the target backend; authenticates internal KPI operations.
- `KPI_API_BASE_URL` and `KPI_ENV`: must target the intended backend and environment.
- `DATABASE_URL`: backend storage and the CLI's transport-only fallback.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and NutrIA's `PROJECT_KEY`: publication only. Keep workbook values out of source, terminal output, and workflow artifacts.

The supplied NutrIA development key passed the actual remote adapter's read-only `current_project` identity check. No measurement was posted to Supabase. GitHub secret values were not readable or compared. After deploying this reviewed fix, run telemetry in the intended environment and inspect persistence again; deployed success is still unverified.

## Retired snapshot table migration

`apps/api/prisma/migrations/20261016025720_drop_kpi_snapshot/migration.sql` was generated from the Prisma schema delta and contains only `DROP TABLE "kpi_snapshot";`. It has no `CASCADE` and no changes to event, sample, publication, or business tables. The original migration is retained for history.

Deploy the new application and workflow first and let older telemetry runs finish before applying the migration through the approved database deployment path. The TL explicitly accepts losing historical snapshot rows; no rollback or backup workflow is included. No shared database migration was run during this work.

## Local evidence (2026-10-15)

Before the cookie fix, the HTTP regression and full-application CLI persistence checks failed. The removed finalize mode, removed endpoint, and stale snapshot reuse were also reproduced as failing tests. The table-removal migration also failed its absence assertion before implementation. In the final implementation, all 47 KPI/access suites passed (845 tests), including disposable PostgreSQL integrations. API lint and build passed. A stale installed TypeScript 5 launcher was removed from this copy's `node_modules/.bin`; lint then used the declared workspace TypeScript 6.0.3 without source configuration changes. Tests for removed snapshot/finalize behavior were replaced with read-only collection, sample-only telemetry, and no-snapshot HTTP integration checks.
