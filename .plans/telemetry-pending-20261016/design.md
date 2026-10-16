# Persist terminal telemetry events under network latency

## Problem and evidence

Production runtime logs report `CLIENT_QUERY_TIMEOUT` when closing HTTP events. The event insert succeeds while its terminal update fails, leaving a pending record without duration. The same persistence adapter handles dependency events. Existing database tests often replace the runtime client's short query timeout with a much larger test-only timeout.

The team's mixed `dev` and `prod` labels are deliberate: it changed the reporting environment during testing. Preserve environment selection.

## Decision

Give database queries enough time for network round trips while preserving the existing SQL execution timeout and bounded caller wait. Retain the actual asynchronous persistence task in the hosting platform until it settles, even when its caller's wait has expired. Keep the platform hook at application assembly; persistence remains testable without a hosting runtime.

Keeping the 150 ms client deadline would continue discarding valid writes during ordinary network latency. Waiting without a caller bound would make telemetry delay business responses. The selected approach keeps the existing response and SQL limits while allowing the transaction to finish asynchronously; hosting-platform duration limits still apply.

## Acceptance criteria

- A terminal HTTP or dependency event persists with 200 ms simulated response latency against disposable PostgreSQL using the real runtime client.
- The caller still returns within its existing bounded wait when persistence takes longer.
- A hosting-platform task covers the complete underlying write, not merely the bounded wait promise.
- Terminal updates remain conditional on the original pending event and never create or overwrite completed events.
- Database failures remain non-fatal to business requests and logs remain free of sensitive values.
- Preserve all reporting environment labels, raw-event collection, sample-only telemetry and publisher idempotency.

## Validation and data strategy

First capture failing network-latency regressions, then validate both event types and the platform-lifetime hook. Run the KPI/access regression suites with a disposable local database, followed by API type checking and build. No schema change, migration, historical-event repair or shared-environment execution is required. Old pending rows cannot be assigned reliable terminal results retrospectively.
