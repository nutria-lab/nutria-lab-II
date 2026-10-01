# Design Specification: NUT-68 Desktop Meal Plan & Stitch Alignment

## 1. Overview & Problem Statement

### 1.1 Context
In the NutrIA web application, the Weekly Meal Plan view serves as the core workspace where users inspect, navigate, and customize their weekly nutritional regime. During desktop validation on the `fercesio11/nut-68-alinear-stitch` branch, two blocking usability and alignment defects were identified:

1. **Desktop Day Selector Cut-Off & Domingo Inaccessibility**: On desktop viewports, the day selector is constrained inside a mobile-oriented container (`max-w-lg` / 512px, providing only ~480px of usable content width). The 7-day selector requires at least 520px (7 day tabs at `min-w-[64px]` plus `gap-3`), and horizontal scrollbars are hidden. Consequently, Sunday (Domingo) is pushed beyond the right viewport margin, clipped, and completely unreachable/unclickable on desktop.
2. **Lack of Stitch Desktop Alignment**: The desktop experience currently mimics a constrained mobile column instead of leveraging the approved Google Stitch desktop design ("Planificador Semanal", Project `4710256129659267767`, Screen `3bb83682bcf94240b01effe9b3af2808`). The approved design specifies an expansive 7-day weekly grid layout across desktop viewports, presenting all seven days side-by-side with clear visual hierarchy (day, meal slot, recipe, prep time, and nutrition summary) without artificial container clipping or forced horizontal scrollbars.

### 1.2 Design Objectives
- **Zero Sunday Clipping**: Guarantee 100% reachability, visibility, and clickability of all seven days (Monday through Sunday) across all viewports (mobile, tablet, desktop, and ultra-wide).
- **Stitch Desktop Fidelity**: Implement the approved Terra-themed desktop weekly planner screen with a native 7-column weekly grid on desktop viewports (`xl:` / >=1280px) and fluid multi-column adaptation on intermediate viewports.
- **Terra Design System Alignment**: Employ Terra aesthetics: Literata typography for headings, Nunito Sans for body/labels, forest green primary accents, warm cream backgrounds, soft elevated surface containers, and restrained amber tertiary highlights.
- **Maintain Architectural Integrity**: Ensure zero backend or persistence modifications; preserve all existing meal plan mutation, swap, and generation intents.

---

## 2. Decision Record (ADRs)

### ADR-001: Responsive Container Breakout & Unshackling
- **Status**: Accepted
- **Context**: The existing meal plan layout wraps content in a hardcoded `max-w-lg` container at all breakpoints. This works for narrow mobile displays (~375-430px) where vertical stacking or horizontal swipe carousels are standard, but on desktop screens (>=1024px / >=1280px) it artificially cramps content into a narrow 512px strip, breaking the 7-day tab bar and preventing desktop-grade usability.
- **Decision**: Remove the universal `max-w-lg` restriction. On mobile viewports (<768px), keep focused single-column constraints (`max-w-lg mx-auto`). On desktop viewports (`lg:` and `xl:`), break out to a full responsive container (`w-full max-w-7xl` or fluid canvas with `px-8 pb-12 pt-6 lg:ml-64`) that accommodates the persistent desktop navigation sidebar and the multi-column meal plan layout.
- **Consequences**: Eliminates container clipping on desktop; provides ample horizontal space for 7 side-by-side day columns on desktop and fluid 7-day selector bars on intermediate screens.

### ADR-002: Dual Adaptive Layout Strategy (7-Column Weekly Grid vs. Day-Focused View)
- **Status**: Accepted
- **Context**: Stitch screen `3bb83682bcf94240b01effe9b3af2808` defines a full 7-column desktop grid where users view their entire week at a glance. On mobile screens (<768px), a 7-column grid is physically unreadable and unusable.
- **Decision**:
  - **Desktop Viewport (`xl:` >= 1280px)**: Default to the **Full Weekly Grid View** (`grid-cols-7`). All 7 days (Monday to Sunday) are rendered simultaneously in parallel columns. Day headers appear atop each column with date badges, followed by vertically stacked meal slots (Breakfast, Lunch, Dinner, Snack).
  - **Medium / Tablet Viewport (`md:` to `lg:`, 768px - 1279px)**: Responsive multi-column layout (e.g. 2 to 4 columns with natural reflow) or fluid 7-day header selector with equal fractional widths (`grid-cols-7`), ensuring Sunday is never cut off.
  - **Mobile Viewport (`<768px`)**: Single-day focused card stack with a fluid 7-day selector header bar. The 7-day selector buttons use equal fractional distribution (`grid-cols-7` or flex with `flex-1 min-w-0`), preventing any button from overflowing or clipping regardless of screen width.
- **Consequences**: Exact match with Stitch approved desktop screen on desktop viewports; clean, responsive degradation on tablet and mobile without clipping.

### ADR-003: Guaranteed Reachability of All 7 Days in Day Selector Bars
- **Status**: Accepted
- **Context**: The bug occurred because day buttons had fixed minimum widths (`min-w-[64px]`) inside a narrow flex container with `gap-3` and hidden scrollbar (`scrollbar-none`), requiring 520px+ in a 480px box.
- **Decision**:
  - In any day selector bar component, replace rigid `min-w-[64px]` flex items with a CSS Grid of 7 equal columns (`grid grid-cols-7 gap-1 sm:gap-2`) or fluid flex distribution (`flex-1 min-w-0`).
  - Text inside day buttons must use responsive typography and flexible abbreviation (e.g., "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom" / "L", "M", "M", "J", "V", "S", "D" on extra small screens).
  - On viewports with horizontal scroll enabled, scrollbars must either be visibly styled or accompanied by accessible left/right navigation arrows, with ARIA `tablist` and `aria-selected` attributes for full keyboard accessibility.
- **Consequences**: Sunday (Domingo) is guaranteed to be fully visible, interactable, and focused within the viewport boundary.

### ADR-004: Terra Design Token Adoption
- **Status**: Accepted
- **Context**: Project branding requires adherence to Google Stitch Terra guidelines.
- **Decision**: Apply Terra color tokens and typography strictly:
  - **Palette**:
    - Primary: `#4a7c59` (Forest Green, used for active highlights, primary action buttons, day selection indicators)
    - Primary Container / Dim: `#78a886` / `#c8e8d0` / `#8ecf9e`
    - Background: `#faf6f0` (Warm Cream)
    - Surface Container Low: `#f5f1ea` (Meal card card backgrounds)
    - Surface Container: `#f0ece4`
    - On Background / On Surface: `#2e3230` (Charcoal text, high contrast)
    - Secondary / Neutral Variant: `#6b6358` / `#74796e` (Metadata, subtitles, timestamps)
    - Tertiary / Amber: `#705c30` / `#c4a66a` (Meal category badges: BREAKFAST, LUNCH, DINNER, SNACK)
    - Border / Outline Variant: `#e4e0d8` / `#c4c8bc`
  - **Typography**:
    - Headings (H1, H2, H3, H4): `Literata`, serif
    - Body, metadata, labels, buttons: `Nunito Sans`, sans-serif
  - **Elevation & Radii**:
    - Card radius: `rounded-xl` (16px) or `rounded-lg` (12px)
    - Soft elevation with subtle borders (`border border-stone-200/80` or `hover:border-primary/20 hover:shadow-sm`)
- **Consequences**: Visual cohesion with the approved Stitch mockups and overarching brand identity.

### ADR-005: Meal Card Information Hierarchy
- **Status**: Accepted
- **Context**: Stitch desktop screen shows clear meal slots within each day column. Each meal card must clearly communicate key nutritional and operational parameters without visual clutter.
- **Decision**:
  - Top line: Meal category badge (`uppercase tracking-widest text-[10px] font-extrabold text-tertiary`, e.g., "DESAYUNO", "ALMUERZO", "CENA", "COLACIÓN") paired with a contextual swap/regenerate button (`sync` icon).
  - Visual preview: Recipe image with fixed aspect ratio (`h-24 w-full object-cover rounded-lg mb-2`) and accessible fallback image/icon.
  - Headline: Recipe title in `Literata` / bold `Nunito Sans` (`text-sm font-bold leading-tight line-clamp-2`).
  - Metadata row: Prep time badge (e.g., "25 min"), calorie count (e.g., "450 kcal"), and macro indicators if available in state.
- **Consequences**: Users can rapidly scan the weekly schedule, evaluate nutritional suitability, and execute meal swaps directly from the grid.

---

## 3. Architecture & Component Model

### 3.1 Conceptual Component Hierarchy (No Concrete Code Paths)

```
[ Meal Plan Desktop Page Shell ]
  │
  ├── [ Navigation Sidebar ] (Persistent on Desktop >=lg, collapsible on mobile)
  │
  ├── [ Main Content Workspace ] (Fluid container, max-w-7xl, px-8, pt-6, pb-12)
  │     │
  │     ├── [ Meal Plan Header Section ]
  │     │     ├── Page Title ("Planificador Semanal" - Literata 3xl font-bold)
  │     │     ├── Week Range Subtitle ("12 de Mayo — 18 de Mayo, 2024")
  │     │     └── Header Actions Bar
  │     │           ├── Preferences Action Button ("Preferencias" + icon)
  │     │           └── Regenerate Week Action Button ("Regenerar semana" + icon)
  │     │
  │     ├── [ Responsive View Controller ]
  │     │     │
  │     │     ├── [ Desktop Weekly 7-Day Grid ] (Active on >=1280px / xl)
  │     │     │     └── [ Day Column Component ] × 7 (Monday through Sunday)
  │     │     │           ├── [ Day Header Tile ]
  │     │     │           │     ├── Day Name ("Lunes" .. "Domingo" - Literata lg)
  │     │     │           │     ├── Date Badge ("12 MAY" - tracking-wider)
  │     │     │           │     └── Active/Today Indicator Line (border-b-4 border-primary)
  │     │     │           │
  │     │     │           └── [ Meal Slot Stack ]
  │     │     │                 └── [ Meal Slot Card Component ] × N (Breakfast, Lunch, Dinner, Snack)
  │     │     │                       ├── Slot Category Badge ("DESAYUNO" - tertiary text)
  │     │     │                       ├── Quick-Swap Action Trigger (sync icon button)
  │     │     │                       ├── Recipe Thumbnail Image (aspect-video / h-24 object-cover)
  │     │     │                       ├── Recipe Title (bold, 2-line clamp)
  │     │     │                       └── Nutritional / Time Metadata Pills
  │     │     │
  │     │     └── [ Compact / Mobile Day View ] (Active on <1280px)
  │     │           ├── [ Fluid 7-Day Selector Bar ] (Equal grid-cols-7, zero Sunday cut-off)
  │     │           │     └── [ Day Tab Button ] × 7 (Mon-Sun, aria-selected, full width)
  │     │           └── [ Selected Day Meal Slot Stack ]
  │     │                 └── [ Expanded Meal Slot Card ] (Full width details for active day)
  │     │
  │     └── [ Meal Swap / Edit Dialog Modal ] (Invoked when user clicks sync/swap on any card)
  │
  └── [ Floating Shopping Cart Access FAB ] (Optional quick access link to shopping list)
```

### 3.2 Viewport Adaptation Matrix

| Viewport Category | Width Range | Layout Presentation | Day Selector / Navigation | Sunday Visibility Guarantee |
|---|---|---|---|---|
| **Desktop Ultra / Wide (xl, 2xl)** | `>= 1280px` | Full 7-column grid (`grid-cols-7`), all days visible simultaneously | Column headers act as anchor/focus headers; no tabs needed | **100% visible in column 7** with identical width to columns 1-6 |
| **Desktop Standard / Laptop (lg)** | `1024px - 1279px` | 4-column reflow or 7-column compressed grid (`gap-2`) | All 7 days in grid or full-width 7-day selector bar | **100% visible and interactive** without scroll |
| **Tablet / Small Laptop (md)** | `768px - 1023px` | 2 to 3 column grid or focused single-day stack with fluid 7-day bar | Fluid `grid-cols-7` bar spanning 100% width | **100% visible in 7th cell**, no overflow |
| **Mobile Standard (xs, sm)** | `< 768px` | Single-day vertical stack (`max-w-lg mx-auto`) | Fluid 7-day bar (`grid-cols-7` with compact abbreviations) | **100% visible**, equal touch target width, fully tap-accessible |

---

## 4. Flows and User Stories

### User Story 1: Desktop Weekly Overview (NUT-68 Stitch Alignment)
**As a** NutrIA user on a desktop computer,  
**I want to** view my entire 7-day weekly meal plan simultaneously across my screen,  
**So that** I can assess my weekly nutrition, meal variety, and upcoming dinners without having to toggle between individual days.

#### Flow:
1. User navigates to the Weekly Meal Plan view on a desktop screen (>=1280px).
2. The page loads within the fluid desktop layout (`ml-64` sidebar margin, `px-8` content padding).
3. The header displays the active week date range and plan controls ("Preferencias", "Regenerar semana").
4. A 7-column grid renders Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, and Sunday side-by-side.
5. In each column, meal slots (Breakfast, Lunch, Dinner, Snack) are ordered chronologically.
6. The user scrolls vertically down the page to view later meals for all days in parallel.

---

### User Story 2: Seamless Sunday Selection (NUT-68 Sunday Cut-Off Fix)
**As a** NutrIA user accessing the meal plan on any device or viewport size,  
**I want to** clearly see and click on Sunday (Domingo),  
**So that** I can plan or review my Sunday meals without clipping, hidden buttons, or awkward scroll failures.

#### Flow:
1. User opens the meal plan on a medium, tablet, or desktop viewport where a day selector bar is active.
2. The day selector spans the full container width with 7 equal-sized tabs (`grid-cols-7`).
3. Sunday ("Dom" / "Domingo") is fully visible within the rightmost boundary of the container, with clear margin and active border.
4. User clicks or taps Sunday.
5. Focus shifts smoothly to Sunday, displaying Sunday's planned meals immediately.

---

### User Story 3: Single-Meal Slot Regeneration / Swap
**As a** NutrIA user reviewing my weekly plan,  
**I want to** replace a specific meal on any day (e.g., Sunday Dinner) with a different recipe,  
**So that** I can customize meals I dislike without regenerating the entire week.

#### Flow:
1. User hovers or focuses on the meal card (e.g., "Sunday Roast Kabobs" under Sunday Dinner).
2. The contextual action button (`sync` icon) appears with clear contrast.
3. User activates the button via mouse click or keyboard (`Enter` / `Space`).
4. The Meal Swap modal opens with curated alternatives adhering to profile restrictions.
5. User selects a replacement recipe.
6. The specific meal slot updates optimistically, maintaining the 7-day layout intact.

---

## 5. Acceptance Criteria

### AC-1: Desktop Sunday Visibility & Accessibility (Bug Resolution)
- [ ] **Given** a desktop or laptop viewport with width between 1024px and 1920px,  
  **When** the user opens the Weekly Meal Plan page,  
  **Then** Sunday ("Domingo" / "Dom") must be 100% visible on screen without any horizontal scrollbar or visual truncation.
- [ ] **Given** any day selector bar component,  
  **When** the 7 days are rendered,  
  **Then** the container must NOT be restricted to `max-w-lg` (512px) on desktop viewports (`lg:` / `xl:`).
- [ ] **Given** the day selector buttons,  
  **When** the user attempts to click, tap, or navigate via keyboard (`Tab` + arrow keys) to Sunday,  
  **Then** Sunday receives clear focus styling and triggers the selection of Sunday's meal plan without error.

### AC-2: Stitch Desktop 7-Day Grid Fidelity
- [ ] **Given** a viewport width `>= 1280px` (`xl` breakpoint),  
  **When** the meal plan loads,  
  **Then** the layout displays a 7-column grid layout (`grid-cols-7`) showing Monday through Sunday simultaneously.
- [ ] **Given** the 7-column grid layout,  
  **When** evaluating column structure,  
  **Then** each column contains:
  1. Day Header: Day name in `Literata` font and formatted date badge (e.g., "Lunes", "12 MAY").
  2. Indicator line: Colored indicator underline (`border-b-4 border-primary/20` or active highlight).
  3. Meal Slot Stack: Vertical cards for each defined meal slot (Desayuno, Almuerzo, Cena, Colación).
- [ ] **Given** the meal slot cards within the grid,  
  **When** rendered,  
  **Then** each card displays:
  1. Uppercase category tag in tertiary amber typography (e.g., "DESAYUNO").
  2. Quick-swap action trigger button (`sync` icon).
  3. Recipe preview image or placeholder with consistent aspect ratio.
  4. Recipe title with high-contrast `Nunito Sans` or `Literata` styling.
  5. Preparation time and key nutritional summary where present.

### AC-3: Terra Design System Styling
- [ ] **Color Palette Compliance**:
  - Background surface uses warm cream (`#faf6f0`).
  - Card containers use elevated surface tones (`#f5f1ea` / `#f0ece4`).
  - Primary accents, buttons, and active indicators use forest green (`#4a7c59`).
  - Meal type tags and badges use tertiary warm amber (`#705c30` / `#c4a66a`).
  - Text adheres to high contrast charcoal (`#2e3230`) on cream surfaces.
- [ ] **Typography Compliance**:
  - All headers (`h1`, `h2`, `h3`, `h4`) utilize `Literata` serif.
  - Body copy, buttons, tags, and data values utilize `Nunito Sans` sans-serif.
- [ ] **Corner Radii & Borders**:
  - Meal cards and day column containers utilize `rounded-xl` (16px) or `rounded-lg` (12px).
  - Subtle borders use `#e4e0d8` or stone equivalents, with smooth hover transitions.

### AC-4: Keyboard & Screen Reader Accessibility
- [ ] All interactive elements (day buttons, meal swap triggers, header actions) have discernible accessible names (`aria-label`).
- [ ] Day selector controls implement proper ARIA roles (`role="tablist"`, `role="tab"`, `aria-selected="true|false"`).
- [ ] The desktop 7-column grid maintains a logical DOM tab order: navigating via keyboard proceeds logically through day columns and meal slots.
- [ ] Focus outlines comply with WCAG 2.1 AA (contrast ratio >= 3:1 against surrounding surfaces).

---

## 6. Required Tests & QA Evidence Plan

### 6.1 Unit Tests
- **Day Selector Geometry & Distribution**:
  - Test that day selector container classes do not constrain width to `max-w-lg` when desktop viewport modifier is active.
  - Test that 7 day buttons render with equal width proportions in CSS Grid (`grid-cols-7`).
  - Test that Sunday label and click handler are properly wired and invoked upon activation.
- **Weekly Grid Projection Logic**:
  - Test grouping function that partitions weekly meal plan items into 7 chronological day buckets (Monday to Sunday).
  - Test meal slot ordering within each day bucket (Breakfast -> Lunch -> Snack -> Dinner).
  - Test fallback handling for empty or incomplete meal slots (renders accessible empty slot card instead of crashing).

### 6.2 Component Integration Tests
- **Responsive Viewport Switching**:
  - Mount component at 1440px viewport: assert 7 column containers are rendered in the DOM simultaneously.
  - Mount component at 390px viewport: assert single-day focus view is rendered with a 7-day selector bar where Sunday has non-zero width and positive bounding client rect inside container.
- **Meal Slot Quick-Swap Trigger**:
  - Simulate click on Sunday Dinner swap button: assert swap event callback is triggered with exact day identifier and meal slot ID.

### 6.3 Playwright E2E Test Suite (Responsive Matrix)
A comprehensive automated E2E test suite must validate the visual and functional behavior across explicit screen resolutions:

| Viewport Preset | Dimensions (WxH) | Assertion Target |
|---|---|---|
| **Desktop Full (FHD)** | 1920 × 1080 | Verify 7-column layout, Sunday column visible in rightmost column, Sunday cards clickable. |
| **Desktop Standard (WXGA)** | 1280 × 800 | Verify 7-column grid fits without horizontal body scroll, Sunday cards fully accessible. |
| **Laptop Medium** | 1024 × 768 | Verify responsive container expands, no clipping on any day element. |
| **Tablet Portrait** | 768 × 1024 | Verify day selector bar renders all 7 days with Sunday fully clickable inside viewport. |
| **Mobile Standard** | 375 × 667 | Verify fluid 7-day selector bar fits screen width; clicking Sunday displays Sunday meal cards. |

#### Specific Playwright Test Assertions:
1. `expect(sundayTab).toBeVisible()`
2. `expect(sundayBoundingBox.x + sundayBoundingBox.width).toBeLessThanOrEqual(viewportWidth)`
3. `await sundayTab.click()` -> `expect(activeDay).toHaveText(/domingo|sunday/i)`
4. On 1280px+ viewports: `expect(page.locator('[data-testid="day-column"]')).toHaveCount(7)`

---

## 7. Prisma / Database / Migration Strategy

### 7.1 Database Impact Analysis
- **Schema Changes**: **None required**.
- **Prisma Migrations**: **None required**.
- **Backend API Endpoints**: **No changes required**.

### 7.2 Rationale
This issue (NUT-68) is purely a frontend presentation, responsive design, and CSS container constraint defect. The backend NestJS services and Prisma PostgreSQL schemas already store and serve the full 7-day weekly meal plan payload (Monday through Sunday) with meal slots, recipes, and nutritional data. The problem was strictly located in client-side CSS layout boundaries (`max-w-lg` restriction) and single-column vs. multi-column presentation logic. Existing endpoints for fetching active plans (`GET /meal-plans/active`), regenerating plans, and swapping individual meals remain completely intact and compatible.
