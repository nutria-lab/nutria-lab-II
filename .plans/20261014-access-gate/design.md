# ADR: production access gate before authentication

## Context

The browser application must not expose the product to unauthorised visitors before login or registration. The OpenAI credential remains server-side, but an additional shared password gate is required for the production deployment.

## Decision

Use `APP_ACCESS_PASSWORD` only on the API. When configured, an API middleware protects every route except `GET /access/status`, `POST /access/verify`, `OPTIONS`, and `/health`. A successful verification creates a short-lived, signed `HttpOnly` cookie; the password is never sent to or stored by the web client. The web app checks the status before mounting `AuthProvider` and renders an accessible password screen before login/register.

The gate is always rendered. Production fails closed at startup when the environment variable is missing; local environments show the gate but remain closed until the variable is configured.

## Alternatives rejected

- A frontend-only `VITE_*` password would be visible in the shipped JavaScript and would not protect the API.
- A password in local storage, a URL, or a normal client-side header would expose credentials or make replay easier.
- Persisting gate sessions in the database adds unnecessary state and a migration for a deployment-level control.

## Consequences and rollback

Changing `APP_ACCESS_PASSWORD` invalidates existing gate cookies. Production CORS must allow credentials, which is already enabled by the current API configuration. No Prisma schema or migration is required. Rollback consists of removing the access module/middleware and the web boundary; the environment variable can remain unused.