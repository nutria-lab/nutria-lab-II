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
- AI responses are untrusted external output until schema and domain validation pass.

## Decision rule

Create an ADR for a material change to contracts, data model, safety, availability or operational cost.
