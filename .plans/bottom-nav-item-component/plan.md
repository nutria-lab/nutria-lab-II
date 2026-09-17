# Plan: Reusable Navigation Item Component & Mobile Bottom Navigation Redesign

- **Generation Timestamp**: 2026-09-17T22:43:00Z
- **Reference Design**: `.plans/bottom-nav-item-component/design.md`

## 1. Concrete Files & Symbols

### Modified Files:
- `apps/web/src/common/components/navigation.ts`
  - Symbol: `PRIMARY_NAVIGATION_ITEMS` (type and metadata for navigation tabs, ensuring consistent icon identifiers and labels).
- `apps/web/src/common/components/BottomNavigation.tsx`
  - Symbol: `BottomNavigation` (refactored to render the navigation container `bg-surface` / `#faf6f0`, `border-t`, `h-20`, `px-6` and map over `PRIMARY_NAVIGATION_ITEMS` delegating each tab to `NavigationItem`).
- `apps/web/src/common/components/tests/BottomNavigation.test.tsx`
  - Symbol: `BottomNavigation` test suite (fix import paths, update assertions for active/inactive states aligned with Stitch design).

### New Files:
- `apps/web/src/common/components/NavigationItem.tsx`
  - Symbol: `NavigationItem` (reusable component accepting `to`, `label`, `icon`, and optional `ariaLabel` / `className`, rendering the responsive link with outlined/filled icons and medium/bold text).
  - Symbol: `NavigationItemProps` (TypeScript interface defining component props).
- `apps/web/src/common/components/tests/NavigationItem.test.tsx`
  - Symbol: `NavigationItem` test suite (unit tests verifying rendering, active/inactive states, outlined vs filled SVG/icon variations, accessibility attributes).

## 2. Implementation Steps

1. **Test Phase (Tester - Red Stage)**:
   - Create `apps/web/src/common/components/tests/NavigationItem.test.tsx` with focused tests for `NavigationItem`:
     - Renders item label and icon.
     - Inactive state: renders outlined icon geometry, `font-medium`, and inactive text color.
     - Active state: renders filled icon geometry, `font-bold`, primary green color, and `aria-current="page"`.
     - Accessible touch target size (`min-h-[44px]` / `min-w-[44px]` or `h-20`).
   - Run tests to verify the red state.

2. **Implementation Phase (Implementer - Green Stage)**:
   - Implement `apps/web/src/common/components/NavigationItem.tsx`:
     - Provide SVG icon rendering with outlined (inactive) and filled (active) variants for all 5 nav items: `home`/`dashboard`, `calendar`/`meal-plan`, `book`/`recipes`, `cart`/`shopping-list`, `target`/`goals`.
     - Style label text with `text-[10px]` (`font-medium text-stone-500` vs `font-bold text-primary`).
     - Render `NavLink` with clean active styling matching Stitch (`#faf6f0` background, no bulky top border).
   - Refactor `apps/web/src/common/components/BottomNavigation.tsx` to use `NavigationItem`.
   - Update and verify `apps/web/src/common/components/tests/BottomNavigation.test.tsx`.
   - Run test suite until all tests turn green.

3. **Review & Verification**:
   - Verify all tests in `apps/web` pass.
