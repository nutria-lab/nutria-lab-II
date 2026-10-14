# Design Specification: NUT-79 Reemplazar una comida desde su tarjeta

## 1. Overview & Problem Statement

### 1.1 Context
In the weekly meal plan view, users need the ability to adjust individual meals without regenerating the entire week or losing their place in their weekly schedule. Currently, users have weekly generation or broad plan actions, but lack a granular, card-level replacement mechanism that operates in place.

When a user identifies a meal they cannot or do not wish to prepare, they should be able to trigger a single-meal replacement directly from that meal's card. This action must swap only that specific meal slot with a newly proposed recipe from the backend, leaving every other planned meal, the active day selection, scroll position, and user expansions completely intact.

### 1.2 Objectives
- **Targeted Single-Meal Replacement**: Replace only the selected planned meal (`plannedMealId`) via the dedicated endpoint without re-fetching or resetting other meals in the active plan.
- **Responsive Confirmation Interaction**:
  - **Mobile (<768px)**: Localized in-card selector / action trigger with localized processing indicators.
  - **Desktop (>=768px / >=1024px)**: Fully accessible modal dialog confirming the replacement.
  - Both patterns explicitly name the meal being replaced and assure the user that the rest of their weekly plan remains unchanged.
- **Isolated Card Blocking**: While replacement is in progress, only the active meal card displays a busy/loading state and blocks interaction. All other meal cards and navigation controls (such as switching tabs or scrolling) remain fully interactive.
- **Double Submit Protection & Idempotent Retries**: Generate a unique `Idempotency-Key` (UUID) per replacement intention. Block repeated submissions during in-flight requests. On network or server error, retain the same idempotency key for immediate retry of that same intention.
- **Preservation of User Viewport & Context**: On success, patch only the returned planned meal in state while preserving:
  1. Currently selected day tab.
  2. Vertical and horizontal scroll positions.
  3. Unrelated card accordion / expansion states.
- **No Optimistic Recipe Fabrication**: Do not invent fake recipe data optimistically. The card displays a localized loading state until the backend returns the actual replacement.
- **Accessibility & Screen Reader Announcements**: Use WAI-ARIA live regions (`aria-live="polite"` / `role="status"`) to announce replacement initiation, success (naming the new recipe), and errors. Ensure accessible focus management in modals and cards.
- **Terra Visual Alignment**: Respect the Terra design system (Literata headings, Nunito Sans body, forest green accents, warm cream backgrounds, restrained amber category badges).

### 1.3 Out of Scope
- Manual recipe search or manual recipe selection modal.
- Full week regeneration or multi-meal batch swaps.
- Backend schema, database, or endpoint changes (uses existing contract).

---

## 2. Decision Record (ADRs)

### ADR-001: Localized Meal Replacement & Single-Slot Patching
- **Status**: Accepted
- **Context**: In full weekly plan updates, refetching the entire plan or regenerating all meals disrupts user context, resets scroll position, collapses expanded cards, and causes jarring layout shifts.
- **Decision**: The client calls `POST /meal-plans/:planId/meals/:plannedMealId/replace` with an optional request body and header `Idempotency-Key: <uuid>`. Upon receiving the updated `plannedMeal` object, the client performs an in-memory partial update, replacing strictly the single meal item in the plan collection matching `plannedMealId`.
- **Consequences**: Zero flicker or re-render for unaffected meals. Day selection, scroll offsets, and card expansion states are preserved seamlessly.

### ADR-002: Adaptive Confirmation Strategy (Mobile In-Card Selector vs. Desktop Accessible Modal)
- **Status**: Accepted
- **Context**: On small mobile viewports, full-screen or large floating modals feel heavy and disconnect the user from the card context. On desktop viewports, an accessible modal dialog provides clear focus, prominent warnings, and keyboard entrapment suitable for mouse and keyboard users.
- **Decision**:
  - **Mobile Viewport (<768px)**: The replacement action is initiated from the card (via action menu or card button). A compact in-card confirmation prompt or sheet confirms: *"¿Reemplazar [Nombre de Comida]? El resto de tu plan no cambiará."* Processing is localized strictly to that card.
  - **Desktop / Tablet Viewport (>=768px)**: Triggers an accessible modal dialog adhering to the WAI-ARIA `dialog` pattern. The dialog title names the meal, explains non-destructive scope, provides "Cancelar" and "Reemplazar comida" actions, traps focus, and closes on Escape or backdrop click.
- **Consequences**: Follows the approved visual references, ensuring intuitive touch interaction on mobile and robust dialog accessibility on desktop.

### ADR-003: Idempotency Key Lifecycle & Double-Submit Guard
- **Status**: Accepted
- **Context**: Network latency or multiple rapid clicks could trigger redundant backend calls, potentially replacing a meal multiple times or generating inconsistent states.
- **Decision**:
  - When the user confirms replacement of a meal, generate a new UUIDv4 as the `Idempotency-Key`.
  - Disable the confirmation button immediately upon submission and mark the card as `isReplacing = true`.
  - If the request fails, the error state presents "Reintentar" and "Cancelar". Clicking "Reintentar" executes the request using the **exact same** `Idempotency-Key` originally generated for that intention.
  - If the user cancels the error state or triggers a fresh replacement flow later, a new key is generated.
- **Consequences**: Guarantees zero duplicate swaps on the backend, guarantees safe retries for transient failures, and prevents UI race conditions.

### ADR-004: Anti-Fabrication & Realistic Loading State (No Optimistic Recipe Guessing)
- **Status**: Accepted
- **Context**: AI-driven or backend meal replacement cannot be predicted on the client. Fabricating a placeholder recipe optimistically creates misleading expectations if the server returns a different recipe or fails.
- **Decision**: Do not render an optimistic recipe. When confirmed, transition the card into a localized loading skeleton / spinner state with an accessible announcement ("Generando reemplazo para [Comida]..."). The previous meal data is retained in memory so that on failure, the card can instantly revert to its prior state.
- **Consequences**: Transparent user expectations; seamless rollback on network failure; zero flash of inaccurate nutritional data.

### ADR-005: Screen Reader Announcements & Accessibility (a11y)
- **Status**: Accepted
- **Context**: Screen reader users must be notified of asynchronous replacements occurring in-place without losing their focus or orientation.
- **Decision**:
  - Each meal card includes an accessible trigger button with an explicit accessible label (e.g., `aria-label="Reemplazar [Nombre de Comida]"`).
  - Use an ARIA live region (`aria-live="polite"` with `aria-atomic="true"`) to announce:
    1. *"Reemplazando [Comida anterior]..."* when the request begins.
    2. *"[Comida anterior] reemplazada exitosamente por [Nueva Comida]."* when the request succeeds.
    3. *"Error al reemplazar [Comida anterior]. Puedes reintentar o cancelar."* on failure.
  - Ensure focus returns to the replaced meal card's primary action button upon completion.
- **Consequences**: Full WCAG 2.1 AA compliance and clear screen reader comprehension.

### ADR-006: Localized Error Recovery with Non-Destructive Fallback
- **Status**: Accepted
- **Context**: When a replace request fails (e.g. 500 error, network timeout, rate limit), the user must not be left with a broken card, nor should the whole plan crash.
- **Decision**: If the replacement request rejects, the card exits loading mode, restores the previous recipe data, and displays an inline error banner on the card with:
  - Error message describing the issue.
  - "Reintentar" action (re-executing with the preserved idempotency key).
  - "Cancelar" action (dismissing the error banner and returning the card to its standard idle state).
- **Consequences**: Resilient, localized error handling without corrupting surrounding cards or losing state.

---

## 3. Architecture & Conceptual Component Model

```
[ Weekly Meal Plan Workspace ]
  │
  ├── [ Screen Reader Live Announcer ] (aria-live="polite", aria-atomic="true")
  │
  ├── [ Day Selector Navigation ] (Preserves selected day index during mutations)
  │
  ├── [ Meal Plan Grid / Card Stack ]
  │     │
  │     ├── [ Meal Card Component ] (Active/Idle/Loading/Error states)
  │     │     ├── Category Badge (DESAYUNO, ALMUERZO, CENA, COLACIÓN)
  │     │     ├── Recipe Summary & Thumbnail
  │     │     ├── Card Action Menu
  │     │     │     └── Replace Action Button ("Reemplazar comida")
  │     │     │
  │     │     ├── [ Mobile In-Card Confirmation Drawer/Sheet ] (When active on <768px)
  │     │     │     ├── Heading ("¿Reemplazar esta comida?")
  │     │     │     ├── Notice ("Solo se cambiará este plato. El resto de la semana se mantiene.")
  │     │     │     ├── Cancel Button
  │     │     │     └── Confirm Replace Button
  │     │     │
  │     │     ├── [ Localized Card Loading Overlay / Skeleton ] (While isReplacing === true)
  │     │     │     └── Spinner / Skeleton + "Reemplazando receta..."
  │     │     │
  │     │     └── [ Localized Card Error Banner ] (When replacement error occurs)
  │     │           ├── Error Description
  │     │           ├── Retry Button (reuses idempotency key)
  │     │           └── Dismiss/Cancel Button
  │     │
  │     └── [ Other Meal Cards ] (Remain completely interactive and unlocked)
  │
  └── [ Desktop Replacement Modal Dialog ] (WAI-ARIA Dialog on >=768px)
        ├── Dialog Title ("Reemplazar [Nombre de Comida]")
        ├── Body ("¿Deseas reemplazar este plato? Se generará una nueva sugerencia manteniendo las demás comidas de tu semana intactas.")
        ├── Footer Actions
        │     ├── Cancel Button ("Cancelar")
        │     └── Confirm Button ("Reemplazar comida")
        └── Focus Trap & Backdrop
```

### 3.1 State Management & Mutation Contract
1. **Plan State Store**:
   - `selectedDay`: Selected day identifier (e.g. `2026-10-06` or day index 0..6). Never altered by meal replacement.
   - `plan`: Active weekly meal plan object containing days and planned meals.
   - `replacingMealId`: String or null. Identifies the single meal currently undergoing replacement.
   - `replacementError`: Object containing `{ mealId, message, idempotencyKey, originalMeal }` or null.
2. **Action: `replacePlannedMeal(planId, plannedMealId, idempotencyKey)`**:
   - Sets `replacingMealId = plannedMealId`.
   - Dispatches HTTP `POST /meal-plans/:planId/meals/:plannedMealId/replace` with header `Idempotency-Key: idempotencyKey`.
   - On success:
     - Updates `plan.meals` by replacing the element where `meal.id === plannedMealId` with the response `plannedMeal`.
     - Clears `replacingMealId` and `replacementError`.
     - Triggers screen reader announcement.
   - On failure:
     - Clears `replacingMealId`.
     - Sets `replacementError` for that card, keeping the previous meal data visible.
     - Triggers screen reader error alert.

---

## 4. User Interaction Flows

### 4.1 Flow 1: Happy Path (Desktop Modal Confirmation)
1. User navigates their weekly plan on desktop and locates a meal card (e.g., "Guiso de Lentejas").
2. User clicks the "Reemplazar" icon/action on the card.
3. The Desktop Accessible Modal opens:
   - Focus is trapped within the dialog.
   - Modal title: *"Reemplazar Guiso de Lentejas"*.
   - Description clarifies: *"Solo se cambiará este plato. Las demás comidas de tu plan se mantendrán iguales."*
4. User clicks *"Reemplazar comida"*:
   - Modal closes.
   - A unique `idempotencyKey` is generated.
   - Only the "Guiso de Lentejas" card enters the loading state (disabled, subtle spinner / skeleton overlay).
   - All other meal cards remain clickable and expandable. The day selector remains responsive.
   - Screen reader announces: *"Reemplazando Guiso de Lentejas..."*.
5. Network request completes successfully:
   - The card updates with the new recipe (e.g., "Curry de Garbanzos").
   - Card loading state is removed.
   - Focus returns to the card's action button.
   - Screen reader announces: *"Guiso de Lentejas reemplazado por Curry de Garbanzos."*.
   - Scroll position and active day are exactly as before.

### 4.2 Flow 2: Happy Path (Mobile In-Card Confirmation)
1. User views their weekly plan on a smartphone.
2. User taps the options menu or "Reemplazar" button on a meal card.
3. A localized in-card confirmation prompt or bottom action drawer appears:
   - Text specifies the meal title and notes that unaffected meals will not change.
   - User taps *"Confirmar reemplazo"*.
4. Card locks immediately and displays an inline spinner/skeleton.
5. Other cards in the day view remain scrollable and tappable.
6. Server returns the replaced meal.
7. Card re-renders with the new meal; day selection and scroll offset are preserved.

### 4.3 Flow 3: Cancellation Flow
1. User triggers replacement (modal on desktop or inline on mobile).
2. User clicks *"Cancelar"* or presses Escape.
3. Confirmation closes; no network call is initiated; card remains in idle state; focus is restored.

### 4.4 Flow 4: Error and Retry Flow
1. User confirms meal replacement. Card enters loading state.
2. The network request fails (e.g., 503 Service Unavailable or network disconnect).
3. The card immediately reverts to displaying the original meal data and shows an inline error message:
   - *"No se pudo reemplazar la comida. Intenta nuevamente."*
   - Two buttons: *"Reintentar"* and *"Cancelar"*.
4. Screen reader announces the failure.
5. If the user clicks *"Reintentar"*:
   - The client re-sends the POST request using the **same** `Idempotency-Key`.
   - Card re-enters loading state.
6. If the user clicks *"Cancelar"*:
   - The error banner is dismissed.
   - Card returns to its normal idle state with original meal data.

### 4.5 Flow 5: Double Submit Prevention
1. User clicks the confirm button twice rapidly.
2. The first click instantly disables the button, generates the single idempotency key, and transitions the card into loading.
3. The second click is completely ignored / blocked. Only one network request is dispatched.

---

## 5. User Stories & Acceptance Criteria

### Story 1: Reemplazar una comida desde su tarjeta
**As a** NutrIA user reviewing my weekly meal plan,  
**I want to** replace a single meal directly from its card,  
**So that** I can adjust a dish I do not like without altering any other meals in my week.

#### Acceptance Criteria (Gherkin format):

```gherkin
Scenario: Desktop confirmation modal opens with explicit details
  Given the user is on the meal plan page on desktop
  When the user clicks the "Reemplazar" button on the card for "Ensalada César"
  Then an accessible modal opens
  And the modal title mentions "Ensalada César"
  And the modal body explicitly clarifies that no other meals in the plan will change
  And focus is moved to the modal dialog

Scenario: Successful single-meal replacement preserves overall context
  Given the user confirms replacing "Ensalada César"
  When the replacement request is in progress
  Then only the "Ensalada César" card is locked with a loading indicator
  And all other meal cards and day tabs remain interactive
  And no fabricated placeholder recipe is displayed
  When the server returns the updated meal "Bowl de Quinoa"
  Then only that meal card updates to "Bowl de Quinoa"
  And all other meal cards remain unchanged
  And the selected day does not change
  And the page scroll position is preserved
  And an accessible screen reader announcement confirms the change

Scenario: Preventing double submit
  Given the user is in the confirmation dialog
  When the user clicks the confirm button multiple times in rapid succession
  Then only one HTTP POST request is dispatched
  And the confirm button is immediately disabled

Scenario: Handling error and retrying with the same idempotency key
  Given the user confirmed replacing "Tacos de Verduras" with Idempotency-Key "uuid-123"
  When the network call fails
  Then the original meal "Tacos de Verduras" remains visible on the card
  And an error banner with "Reintentar" and "Cancelar" is displayed
  When the user clicks "Reintentar"
  Then a new HTTP request is dispatched with the same Idempotency-Key "uuid-123"
  And the card displays the loading indicator again

Scenario: Cancelling error banner restores clean card state
  Given an error banner is displayed on a meal card after a failed replacement
  When the user clicks "Cancelar"
  Then the error banner is dismissed
  And the meal card returns to its clean idle state showing the original meal
```

---

## 6. Required Test Matrix

| Test Suite | Scenario | Expected Behavior |
|---|---|---|
| **Unit / Contract** | Request headers & payload | Sends `POST /meal-plans/:planId/meals/:plannedMealId/replace` with `Idempotency-Key: <uuid>`. |
| **Unit / Store** | In-place state patch | Updates exclusively the matching `plannedMealId` item. Other meals remain untouched. |
| **Component** | Desktop Modal Open & Close | Renders dialog with meal name; traps focus; closes on Cancel or Escape. |
| **Component** | Mobile in-card interaction | Presents accessible confirmation; locks card locally. |
| **Component** | Double-click prevention | Clicking confirm multiple times fires exactly one request. |
| **Component** | Error & Retry state | On reject, shows error with retry/cancel; clicking retry preserves idempotency key. |
| **Integration** | Scroll & Day retention | Selected day tab and window scroll coordinates remain identical before and after swap. |
| **Accessibility** | ARIA live announcements | Screen reader receives start, success, and error announcements with proper role and politeness. |
| **Responsive UI** | Mobile, Tablet, Desktop | Validates layout and visual behavior across `<768px`, `768px-1024px`, and `>1024px` viewports. |

---

## 7. Database / Prisma / Migration Strategy

- **Impact**: None (Out of Scope).
- **Backend Strategy**: The backend endpoint `POST /meal-plans/:planId/meals/:plannedMealId/replace` is implemented and maintained under ticket NUT-77.
- **Client Scope**: This design is strictly frontend-facing. No database migrations, Prisma schema adjustments, or server-side domain model changes are required for this ticket.
