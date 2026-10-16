# Plan

Generated: 2026-10-15, America/Argentina/Buenos_Aires.

- Keep nine guarded internal POST routes exempt from the browser cookie gate.
- Remove finalize and historical-date controls from telemetry CLI/workflow/API; health sampling does not calculate or store previews.
- Replace snapshot-backed collection with a read-only aggregate port implemented by the reporting store using repeatable-read PostgreSQL queries.
- Remove retired snapshot service, repository snapshot operations, and obsolete tests; remove the unused Prisma model and retention branch, retain applied migration history, and add a generated drop migration with historical snapshot loss accepted by the TL and no rollback.
- Cover actual HTTP authentication, sample-only child CLI execution, and fresh ten-metric collection with the snapshot table absent.
- Update the local guide and operating architecture with the resulting responsibility boundary.

Validation: 47 KPI/access suites, 845 tests passed using localhost PostgreSQL. API lint and build passed. No Git metadata, commits, push, deployment, shared data/configuration or Linear writes. Work directly as requested. Supabase external measurement publication remains unverified.
