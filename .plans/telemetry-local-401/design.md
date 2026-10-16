# Internal KPI access and direct database collection

## Context and decision
Internal KPI operations use a bearer token without a browser cookie. Telemetry only records the current health bucket and performs existing retention cleanup. Publish gathers all ten metrics directly from raw event and business tables before freezing its initial batch. Neither logger reads or creates KPI snapshots; finalize is removed from the telemetry API, CLI and workflow. A frozen publication payload remains the retry source to preserve idempotency.

The alternative of passing the browser cookie couples automation to another password lifecycle. Retaining finalized snapshots would reuse stale values after new events arrive. Direct database collection follows the TL's requested responsibility boundary.

## Acceptance criteria
- Valid internal bearers work without browser cookies; missing, wrong or unconfigured bearers fail closed.
- Unknown paths, removed finalize, other methods and business routes remain gated or unregistered.
- The real telemetry CLI stores one health sample through the actual application HTTP stack; repeated buckets preserve the sample and create no KPI snapshots.
- Rejected CLI requests fail without bypassing authentication through direct database writes.
- The actual collection API returns all ten metrics with the snapshot table unavailable; later events change subsequent collection results.
- Publisher retry behavior preserves the frozen batch; raw data past retention yields unavailable telemetry rather than archived snapshot values.

## Validation
Use synthetic data and disposable localhost PostgreSQL. A generated, reviewed migration removes the unused KPI snapshot table. It is tested only in disposable localhost schemas. The TL explicitly accepts historical snapshot loss and requests no rollback or backup workflow. Shared execution remains outside this local task.
