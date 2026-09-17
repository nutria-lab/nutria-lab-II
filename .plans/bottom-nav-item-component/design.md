# Design: Reusable Navigation Item Component & Mobile Bottom Navigation Redesign

## Decision Record
- **Context**: The mobile navigation bar in Stitch (`Lista de Compras - Móvil`) features a clean warm cream background (`bg-surface` / `#faf6f0`), 5 items with distinct active (solid/filled icon, `font-bold`, primary forest green `#4a7c59`) and inactive (outlined icon, `font-medium`, muted stone `#6b6358` / `#78716c`) states, without top-border indicator tabs.
- **Decision**: Create a dedicated, reusable navigation item component encapsulating icon rendering (supporting outlined vs filled states), label typography, accessibility attributes, and responsive touch targets. Refactor the mobile bottom navigation to use this component.

## Architecture & Component Model
- **Component Interface**:
  - Encapsulates link routing (`to`), semantic display label, icon type identifier, and accessibility labels.
  - Automatically derives active state via router navigation context (or accepts explicit active state where decoupled).
  - Renders an icon container displaying filled geometry when active and outlined stroke geometry when inactive.
  - Renders a small label underneath the icon (`10px`), styled with medium weight for inactive state and bold weight for active state.
  - Maintains accessible touch target dimensions (`min-h-[44px]` / `min-w-[44px]`).

## User Stories & Flows
- **Story 1: Visual State Clarity**: As a mobile user, when I navigate to a section (e.g. Shopping List, Dashboard, Recipes, Meal Plan, Goals), the active navigation item clearly highlights in forest green with a solid/filled icon and bold text, while inactive items remain subdued with outlined icons.
- **Story 2: Touch Accessibility**: As a mobile user, each navigation item provides an accessible, comfortable tap target with visual feedback on hover/tap/focus.
- **Story 3: Keyboard and Screen Reader Accessibility**: As a keyboard or screen reader user, the navigation landmarks and active tab/page state are properly announced with appropriate ARIA attributes (`aria-current="page"`).

## Acceptance Criteria
1. Navigation item component renders both icon and label text passed via props.
2. Inactive state renders outlined icon, `font-medium`, and muted stone color.
3. Active state renders filled/solid icon, `font-bold`, and primary green color (`#4a7c59` / `text-primary` / `text-brand-green`).
4. Bottom navigation container uses warm surface background (`bg-surface` / `#faf6f0`), 80px height (`h-20`), top border with subtle contrast, and distributes the 5 standard items.
5. Touch targets meet minimum accessibility guidelines (at least 44x44px).
6. Focus rings appear on keyboard navigation without clipping.

## Required Tests
- Unit test for navigation item component:
  - Renders label and icon correctly.
  - Applies inactive styles when route is not matched.
  - Applies active styles (filled icon, bold text, primary color, `aria-current="page"`) when route is active.
  - Renders accessible focus and touch target attributes.
- Integration test for bottom navigation bar:
  - Renders all 5 primary items (Dashboard, Meal Plan, Recipes, Shopping List, Goals).
  - Verifies navigation transitions and active state propagation.

## Database & Migration Strategy
- No database changes or migrations required (purely client-side UI/UX component).
