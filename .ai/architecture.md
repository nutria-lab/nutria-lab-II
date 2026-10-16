# Architecture

## Baseline

- Frontend: React, TypeScript, Vite.
- Backend: NestJS.
- Persistence: Prisma with Neon PostgreSQL.
- AI: OpenAI through a server-side boundary.
- Delivery: Vercel and GitHub Actions.

## Boundaries

- UI renders user state and sends validated intents; it does not own authorization or AI safety enforcement.
- NestJS owns DTO validation, authorization, domain invariants and AI orchestration.
- Prisma schema and migrations represent persistence intent; Neon development branches validate database changes.
- KPI telemetry records health samples only. Publish gathers current technical and business values directly from the database before freezing the publication batch; loggers do not read or create KPI snapshots.
- Internal KPI POST operations use the internal bearer token without requiring the browser access cookie. Retries reuse the frozen publication payload for idempotency.
- AI responses are untrusted external output until schema and domain validation pass.

## Decision rule

Create an ADR for a material change to contracts, data model, safety, availability or operational cost.
