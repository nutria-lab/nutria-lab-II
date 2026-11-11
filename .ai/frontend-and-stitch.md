# Frontend and Stitch

## Design source

Read the Stitch project URL from `management/links.md`, the shared project link registry. Register any new user-authorized design links there.

Use Google Stitch, not Figma. The current direction is Terra: forest green, warm cream, restrained amber, soft elevation, Literata headings and Nunito Sans body text.

## Required workflow

1. Read the Linear issue and relevant product module.
2. For every HTML/CSS/client-side JavaScript task, run `google-modern-web-guidance` first.
3. Generate/refine the Stitch artifact and obtain PO approval for material UX changes.
4. Implement accessible React/TypeScript UI with responsive, loading, empty and error states.
5. Validate behavior and visual states with QA evidence.

## Modern web policy

Adopt Baseline Widely Available platform features by default. For newer features, feature-detect and provide a lightweight fallback only when it affects a core flow.

## Frontend code conventions

Use these conventions for React/TypeScript implementation and review:

- Keep transport concerns at the service boundary. Services call `apiClient`, type the response, and adapt API-specific envelopes such as pagination; pages and components consume domain-shaped data.
- Organize responsibilities by layer: `services/` for HTTP and response mapping, `hooks/` for request state and effects, `pages/` for composition and navigation, and `components/` for presentation.
- Prefer explicit domain types. Avoid leaking `any`, raw Axios responses, or backend transport shapes into UI components.
- Expose a consistent request state from data hooks: `loading`, `success`, `empty`, or `error`, together with data, an actionable error message, and a retry/refetch action when applicable.
- Treat request cancellation as an expected control flow. Do not display or classify an intentional `AbortController`/Axios cancellation as a network failure.
- Keep render functions pure. Do not call state setters during render; use event handlers, effects, memoized derivations, or refs for state transitions.
- Keep each component focused on one responsibility. Extract large headers, cards, forms, modals, and sections instead of combining data fetching, navigation, and presentation in one page component.
- Use consistent names: PascalCase for components and types, `useX` for hooks, `xService` for services, and UPPER_SNAKE_CASE for module constants.
- Forms must expose clear initial, validation, submitting, success, error, and cancel states; disable or protect duplicate submissions without making recovery impossible.
- Prefer accessible queries and semantics (`role`, accessible name, label, and visible text). Use `data-testid` only when semantic locators are insufficient.
- Test the relevant loading, empty, error, success, mobile, desktop, and cancellation states. Use deterministic fixtures and assert API adapters against the real response contract.
- Keep comments focused on durable decisions and reasons. Put task history, review history, and temporary implementation notes in plans or delivery evidence.
- Keep responsive behavior explicit: document the breakpoint and define the expected behavior for mobile, desktop, and resize transitions.
