# NUT-95 — Plan de implementación (frontend_explorer)

Generado: 2026-10-19 20:28 (-03:00). Fuente: `.plans/nut-95-inicio-responsive/design.md` (decisiones aprobadas de la sección "12. Decisiones aprobadas por la responsable", que tienen prioridad) + la estructura de fases que aprobó la responsable.
Herramientas: CodeGraph MCP caído, así que la exploración se hizo con Grep/Glob/Read. `bundles/agent-libraries.json` no existe. Esta etapa no ejecutó tests, build ni lint.

Alias `@` → `apps/web/src`: definido en `apps/web/vite.config.ts` (resolve.alias) y en `apps/web/tsconfig.json` (`paths` `@/*`). Los tests importan con `@/...` (p. ej. `apps/web/src/app/tests/App.test.tsx:11-12`).
Setup de Vitest: `apps/web/vite.config.ts` → `test.environment: 'jsdom'`, `setupFiles: './src/test/setup.ts'` (jest-dom + `cleanup` + polyfill de `matchMedia`, `apps/web/src/test/setup.ts:1-27`).

Módulo nuevo: `apps/web/src/modules/dashboard/` (sigue la estructura de `modules/meal-plan/`: `utils.ts`, `tests/`, `components/`, `components/tests/`, `pages/`, `pages/tests/`).

---

## Discrepancias entre el diseño y la estructura aprobada (se resuelven a favor de la estructura aprobada)

| Tema | design.md | Estructura aprobada (se usa esta) |
|---|---|---|
| `DashboardViewModel.adherence` | `CardState<AdherenceResponse>` | `CardState<null>`: el slot usa solo `kind`, así que ningún valor de adherencia puede llegar a la UI. `AdherenceResponse` igual se exporta como tipo y en un fixture. |
| Nombres de utilidades | `getFirstName`, `getNextMealToLog`, `getMealTypeLabel`, `getMealStatusLabel` | `buildGreeting`, `nextMealToLog`, `selectTodayMeals`, `sortMealsByType`, `MEAL_TYPE_ORDER`. Se suma `getMealStatusLabel` / `MEAL_STATUS_LABELS` porque la sección 9 del diseño exige su test. Para el tipo de comida se **reutiliza** `MEAL_TYPE_LABELS`, sin función nueva. |

---

## Referencias existentes para reutilizar

| Qué | Dónde | Uso |
|---|---|---|
| `MealType` (`'BREAKFAST' \| 'LUNCH' \| 'DINNER' \| 'SNACK'`) | `apps/web/src/services/mealPlanService.ts:5` | Importar con `import type`; no redefinir. |
| `MEAL_TYPE_LABELS` (Desayuno/Almuerzo/Merienda/Cena) | `apps/web/src/modules/meal-plan/utils.ts:37-42` | Etiquetas de tipo y chip del destacado. |
| `AuthenticatedUser.name: string \| null` | `apps/web/src/services/authService.ts:12-18` | Entrada de `buildGreeting`. |
| `useAuth()` → `{ status, user, login, logout }` | `apps/web/src/features/auth/AuthProvider.tsx:154-163` (lanza error fuera del provider) | `DashboardPage` lee `user?.name ?? null`. |
| `AppLayout` (Sidebar + TopBar en md+, BottomNavigation en mobile, padding inferior ya resuelto) | `apps/web/src/common/components/AppLayout.tsx:14-28`; se monta en `ProtectedApp`, `apps/web/src/app/App.tsx:63-69` | No tocar: la página va dentro, como todas. |
| `PageHeader` | `apps/web/src/common/components/PageHeader.tsx:16-23` | **Ver riesgo R1**: no lo usa ninguna página y renderiza su propio `<h1>NutrIA</h1>`. |
| `RecipeImage` (fallback `aria-label="Imagen no disponible para {title}"`, prop `compact`) | `apps/web/src/modules/recipes/components/RecipeImage.tsx:12-21` | Miniatura de la lista e imagen del destacado: `image={null}` + `title`. |
| Patrón de skeleton (`animate-pulse`, `aria-busy="true"`, `aria-live="polite"`, bloques `rounded-xl bg-surface-container`) | `apps/web/src/modules/meal-plan/pages/MealPlanPage.tsx:19-42`; `apps/web/src/modules/recipes/components/detail/RecipeDetailStates.tsx:7-20` | Skeleton de la tarjeta de comidas y del slot. |
| Patrón de vacío (icono `material-symbols-outlined` en círculo + `font-headline text-lg font-semibold text-on-surface` + texto `text-sm text-on-surface-variant` + CTA) | `apps/web/src/modules/meal-plan/pages/MealPlanPage.tsx:44-65` | Estados sin plan y sin comidas hoy (el CTA es un `Link`, no un botón). |
| Patrón de error con "Reintentar" (`min-h-[44px] rounded-xl bg-brand-green ... text-on-primary`) | `apps/web/src/modules/meal-plan/pages/MealPlanPage.tsx:67-81`; `RecipeDetailStates.tsx:36-56` | Error de cada tarjeta; el botón solo aparece si existe `retry`. |
| Link estilo CTA con `Link` de `react-router-dom` | `apps/web/src/modules/recipes/components/detail/RecipeDetailStates.tsx:1,26-31` | "Ver receta", "Ir a mi plan", "Ver plan semanal" y los accesos rápidos. |
| Clases de foco visible | `apps/web/src/common/components/Sidebar.tsx:18` (`focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-green`) | Accesos rápidos y CTAs. |
| Tokens Terra | `apps/web/src/index.css:3-57` (`brand-green`, `brand-cream`, `primary-fixed`, `secondary-fixed`, `tertiary-fixed`, `surface-container(-low/-high)`, `on-surface(-variant)`, `outline-variant`, `error`, `font-headline`, `font-body`) | Usar solo estos tokens. |
| Material Symbols | `apps/web/index.html:14`, `apps/web/src/index.css:70-80` | Iconos con `aria-hidden="true"`, como en `MealPlanPage.tsx:62`. |
| Título de página | `apps/web/src/modules/meal-plan/pages/MealPlanPage.tsx:179-187` (`<main className="w-full ... px-4 sm:px-6 lg:px-8 py-6">` + `<h1 className="font-headline text-3xl font-bold ... text-on-surface">`) | Contenedor y saludo H1. |
| Ruta de detalle de receta | `apps/web/src/app/App.tsx:86` → `/recipes/:id` | "Ver receta" → `` `/recipes/${recipeId}` ``. |
| Ruta actual de `/dashboard` (placeholder) | `apps/web/src/app/App.tsx:82` (`<PlaceholderPage title="Dashboard" />`), import en `App.tsx:4` | Se reemplaza por `DashboardPage`. El import de `PlaceholderPage` se **mantiene** porque `/shopping-list` lo usa (`App.tsx:87`). |
| Precedente de fixture | `apps/web/src/modules/meal-plan/mealPlanFixture.ts` | Ubicación y nombre de `modules/dashboard/fixtures.ts`. |
| Stub de `import.meta.env.DEV` en tests | `apps/web/src/services/tests/apiClient.config.test.ts:4-31` (`vi.stubEnv('DEV', true/false)` + `vi.unstubAllEnvs()` en `afterEach`) | Ya existe el precedente y funciona. Ese archivo además usa `vi.resetModules()` + `import()` dinámico porque `apiClient` lee el env **al cargar el módulo** (`apiClient.ts:22`). `DashboardPage` debe leer `import.meta.env.DEV` **durante el render**; así alcanza con `vi.stubEnv` + `render` y no hacen falta `resetModules` ni import dinámico. |
| Patrón de mock de hooks | `apps/web/src/modules/profile/pages/tests/PreferencesPage.test.tsx:8` (`vi.mock('@/modules/profile/hooks/useNutritionProfile', ...)`) | En el test de página: `vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => mockAuth }))` con `vi.hoisted`. |
| Router en tests | `apps/web/src/common/components/tests/Sidebar.test.tsx:12-16`, `BottomNavigation.test.tsx:24-28` (`<MemoryRouter initialEntries={[...]}>`) | Envolver componentes con `Link` y la página (por `useSearchParams`) en `MemoryRouter`. |

---

## Fase 1: tipos y utilidades puras

### `apps/web/src/modules/dashboard/types.ts` (nuevo)
- `export type MealCompletionStatus = 'NOT_LOGGED' | 'COMPLETED' | 'SKIPPED';` (contrato A, textual de design.md:25).
- `export type AdherenceResponse`: **contrato A literal de NUT-95** (corregido por el agente padre; G1 resuelto):
  ```ts
  type AdherenceResponse = {
    weekStart: string;
    timezone: 'America/Argentina/Buenos_Aires';
    today: string;
    plan: { id: string; version: number; updatedAt: string } | null;
    days: Array<{
      date: string;
      plannedMeals: number; completedMeals: number; skippedMeals: number; notLoggedMeals: number;
      adherencePercent: number | null;
      meals: Array<{
        plannedMealId: string; mealUpdatedAt: string; recipeId: string | null;
        mealType: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';
        title: string; status: MealCompletionStatus; canEdit: boolean;
      }>;
    }>;
    summary: { plannedMeals: number; completedMeals: number; skippedMeals: number; notLoggedMeals: number; adherencePercent: number | null };
  };
  ```
  Exportar también los subtipos `AdherenceDay` y `AdherenceMeal`. `mealType` usa `MealType`.
- `export type CardState<T> = { kind: 'loading' } | { kind: 'error'; message: string; retry?: () => void } | { kind: 'unavailable' } | { kind: 'ready'; data: T };`
- `export type TodayMeal = { plannedMealId: string; mealType: MealType; title: string; recipeId: string | null; status: MealCompletionStatus | null };`, con `import type { MealType } from '@/services/mealPlanService'`.
- `export type TodayMealsData = { kind: 'noPlan' } | { kind: 'noMealsToday' } | { kind: 'meals'; meals: TodayMeal[] };`
- `export type DashboardViewModel = { userName: string | null; todayMeals: CardState<TodayMealsData>; adherence: CardState<null> };`

### `apps/web/src/modules/dashboard/utils.ts` (nuevo; no importa fixtures, es seguro para producción)
- `export const MEAL_TYPE_ORDER: readonly MealType[] = ['BREAKFAST', 'LUNCH', 'SNACK', 'DINNER'];` (D6). Ojo: el union de `mealPlanService.ts:5` tiene otro orden (`DINNER` antes de `SNACK`), así que no hay que derivar el orden de ahí.
- `export function sortMealsByType(meals: readonly TodayMeal[]): TodayMeal[]`: copia ordenada por índice en `MEAL_TYPE_ORDER`, estable (`Array.prototype.sort` es estable en ES2019+) y sin mutar la entrada.
- `export function selectTodayMeals(adherence: AdherenceResponse): TodayMealsData` (firma aprobada en el plan): `plan === null` → `{ kind: 'noPlan' }`; sin día con `date === adherence.today` o con `meals` vacío → `{ kind: 'noMealsToday' }`; si no, `{ kind: 'meals', meals: sortMealsByType(day.meals mapeadas a TodayMeal) }`. Compara `today` como string `YYYY-MM-DD`; no usa `Date` ni la zona del navegador.
- `export function nextMealToLog(meals: readonly TodayMeal[]): TodayMeal | null`: primer `status === 'NOT_LOGGED'` después de `sortMealsByType`. Si no hay ninguno, o si todos los status son `null`, devuelve `null`. No usa `Date`.
- `export function buildGreeting(name: string | null | undefined): string`: `name?.trim().split(/\s+/)[0]` → `"Hola, {primer}"`; si es null, vacío o solo espacios → `"Hola"`.
- `export const MEAL_STATUS_LABELS: Record<MealCompletionStatus, string> = { NOT_LOGGED: 'Pendiente', COMPLETED: 'Registrada', SKIPPED: 'Salteada' };` y `export function getMealStatusLabel(status: MealCompletionStatus | null): string | null` (`null` → `null`, sin chip).
- `export function buildUnavailableViewModel(userName: string | null): DashboardViewModel` → `{ userName, todayMeals: { kind: 'unavailable' }, adherence: { kind: 'unavailable' } }` (proveedor de producción, D3). Vive acá y no en fixtures para que llegue al bundle de producción.
- Se reutiliza `MEAL_TYPE_LABELS` de `@/modules/meal-plan/utils`; no se duplica.

### `apps/web/src/modules/dashboard/tests/utils.test.ts` (nuevo; primero en rojo)
- `buildGreeting`: `'María José Rosales'` → `'Hola, María'`; `'Persona'` → `'Hola, Persona'`; `null`, `undefined`, `''`, `'   '` → `'Hola'` (sin coma); `'  Ana  Paula'` → `'Hola, Ana'`.
- `sortMealsByType`: una entrada desordenada (DINNER, SNACK, BREAKFAST, LUNCH) sale en orden BREAKFAST, LUNCH, SNACK, DINNER; la entrada no se muta (comparar con una copia o usar `Object.freeze`); con tipos repetidos se mantiene el orden relativo de los `plannedMealId`.
- `selectTodayMeals`: `plan:null` → `noPlan`; sin día `today` o día sin comidas → `noMealsToday`; con comidas desordenadas → `meals` en orden BREAKFAST, LUNCH, SNACK, DINNER; no usa `Date` (mismo resultado con reloj falso en otra zona).
- `getMealStatusLabel`: los tres estados → Pendiente/Registrada/Salteada; `null` → `null`.
- `nextMealToLog`: entrada desordenada con LUNCH y DINNER en NOT_LOGGED → LUNCH; todos COMPLETED/SKIPPED → `null`; todos con status null → `null`; lista vacía → `null`; con `vi.useFakeTimers()` + `vi.setSystemTime()` a las 07:00 y a las 22:00 devuelve lo mismo (restaurar con `vi.useRealTimers()`).
- `buildUnavailableViewModel`: ambos `kind === 'unavailable'` y el `userName` se conserva.
- `MEAL_TYPE_ORDER`: igual a `['BREAKFAST','LUNCH','SNACK','DINNER']`.

---

## Fase 2: fixtures, componentes y prueba de vista

### `apps/web/src/modules/dashboard/fixtures.ts` (nuevo; solo desarrollo)
- `export const DASHBOARD_FIXTURE_SENTINEL = 'nut95-dashboard-fixture-sentinel';`. Se usa **dentro de los datos**: cada `plannedMealId` es `` `${DASHBOARD_FIXTURE_SENTINEL}-breakfast` `` (o similar) y así la cadena queda en el bundle si el módulo se incluyera. Una constante que no se usa la eliminaría el minificador y la prueba de la Fase 4 daría un falso negativo.
- `export type DashboardFixtureKey = 'loading' | 'sin-plan' | 'sin-comidas' | 'comidas' | 'todo-registrado' | 'error' | 'error-parcial' | 'no-disponible' | 'sin-nombre';` (design.md:56).
- `export const DASHBOARD_FIXTURES: Record<DashboardFixtureKey, Omit<DashboardViewModel, 'userName'> & { userName?: null }>`: una entrada por estado de la tabla 6. Títulos genéricos ("Receta de ejemplo 1…"), sin porcentajes. `comidas` va **desordenado** e incluye NOT_LOGGED, COMPLETED y SKIPPED (al menos un NOT_LOGGED con `recipeId` y una comida con `recipeId: null`). En `todo-registrado` solo hay COMPLETED/SKIPPED. En `error-parcial` la lista tiene todos los `status: null` y `adherence: { kind: 'error', message }`. En `error` las dos tarjetas están en error **sin `retry`** (ver G3). `no-disponible` deja ambas en `unavailable`. `sin-nombre` es `comidas` con `userName: null`.
- `export const adherenceResponseFixture: AdherenceResponse = {...}`: un `AdherenceResponse` válido; solo valida el tipo y **no se renderiza nunca**.
- `export function selectDashboardFixture(key: string | null, userName: string | null): DashboardViewModel`: clave conocida → ese fixture; clave desconocida o ausente → `comidas`; `sin-nombre` fuerza `userName: null`.

### Componentes (nuevos), en `apps/web/src/modules/dashboard/components/`
- `MealStatusChip.tsx` (opcional; puede ir dentro de `TodayMealsCard`): `{ status: MealCompletionStatus | null }`; `null` → no renderiza nada. El chip lleva texto e icono (`check` para Registrada, `remove` para Salteada) con `aria-hidden`. Tokens: Pendiente `bg-surface-container-high`, Registrada `bg-primary-fixed text-on-primary-fixed-variant`, Salteada `border-outline-variant`.
- `NextMealHighlight.tsx`: `{ meals: TodayMeal[] }`. Usa `nextMealToLog`. Si hay pendiente: título "Siguiente comida por registrar", chip con `MEAL_TYPE_LABELS[meal.mealType]`, `RecipeImage image={null} title={meal.title}`, el título de la comida y, solo si hay `recipeId`, `<Link to={`/recipes/${recipeId}`}>Ver receta</Link>`. Si todos tienen status y ninguno es NOT_LOGGED: "Ya registraste todas las comidas de hoy.". Si hay algún status `null` no renderiza nada (lo controla el padre). Layout: md con imagen 50% / contenido 50%.
- `TodayMealsCard.tsx`: `{ state: CardState<TodayMealsData> }`. Es un `<section aria-labelledby>` con el título "Comidas de hoy". Ramas:
  - `loading`: skeleton de 4 filas + skeleton del destacado, `aria-busy="true"`.
  - `error`: `role="alert"` con "No pudimos cargar tus comidas de hoy." y botón "Reintentar" solo si existe `retry`.
  - `unavailable`: "No disponible todavía" + "Pronto vas a ver aquí tus comidas del día.".
  - `ready/noPlan`: "Todavía no tenés un plan para esta semana." + `Link` "Ir a mi plan" → `/meal-plan`.
  - `ready/noMealsToday`: "No hay comidas planificadas para hoy." + `Link` "Ver plan semanal" → `/meal-plan`.
  - `ready/meals`: `NextMealHighlight` (se omite si algún status es `null`) + `<ul>` de `data.meals` (ya ordenadas por `selectTodayMeals`) con miniatura `RecipeImage compact`, `MEAL_TYPE_LABELS`, título y chip. Si algún status es `null` se muestra la nota "El estado de registro no está disponible por ahora." y no hay chips.
  - Grid de la lista: `md:grid-cols-2 lg:grid-cols-4`.
  - Decisión de layout: el destacado necesita `lg:col-span-7` junto al slot `lg:col-span-5`, así que conviene que `DashboardView` arme la grilla y reciba el destacado y la lista como dos piezas. Opciones: que `TodayMealsCard` exporte `TodayMealsList` y que `DashboardView` monte `NextMealHighlight` aparte, ambos alimentados por el mismo `state`; o aceptar que la fila 1 de lg no copie el bento. Se recomienda la primera.
- `AdherenceWidgetSlot.tsx`: `{ state: CardState<null> }`, `<section aria-labelledby>` con el título "Progreso semanal". Ramas: `loading` → skeleton; `error` → `role="alert"` "No pudimos cargar tu progreso." + "Reintentar" si existe `retry`; `unavailable` → "No disponible todavía"; `ready` → "Tu progreso aparecerá aquí.". No hay ningún número, `%`, barra ni día.
- `QuickAccessLinks.tsx`: `<nav aria-label="Accesos rápidos">` con exactamente 3 `Link`: "Ver mi plan semanal" → `/meal-plan` ("Revisá las comidas de la semana"), "Explorar recetas" → `/recipes` ("Buscá ideas y preparaciones"), "Lista de compras" → `/shopping-list` ("Ingredientes de tu plan"). Llevan icono, chevron `aria-hidden` y clases de foco visible de `Sidebar.tsx:18`. Se definen en una constante `QUICK_ACCESS_ITEMS` con `as const`, como en `navigation.ts`. Grid `md:grid-cols-3`.
- `DashboardView.tsx`: `{ viewModel: DashboardViewModel }`, puro. Estructura: `<main>` con contenedor como en `MealPlanPage.tsx:179`, `<h1>` con `buildGreeting(viewModel.userName)`, subtítulo "Hoy es un buen día para nutrirte." y grilla `grid grid-cols-1 gap-6 lg:grid-cols-12`. Orden en mobile: saludo → slot → destacado → lista → accesos (se resuelve con `order-*` o con el orden del DOM más `lg:col-*`). En lg: destacado `lg:col-span-7` y slot `lg:col-span-5` en la fila 1, lista `lg:col-span-12` en la fila 2 y accesos `lg:col-span-12` en la fila 3. No se usa reloj.

### `apps/web/src/modules/dashboard/components/tests/DashboardView.test.tsx` (nuevo; primero en rojo)
Hay que renderizar dentro de `MemoryRouter` y construir los view models en el test (o con `DASHBOARD_FIXTURES`). Consultas por rol y texto.
- Saludo: `heading` de nivel 1 "Hola, María" con `userName: 'María José'`; con `null` es "Hola" (`{ name: 'Hola' }` exacto).
- Por cada estado de la tabla 6 (loading, noPlan, noMealsToday, meals, todo registrado, error, error parcial, unavailable): copy esperado, presencia o ausencia de "Siguiente comida por registrar" y presencia o ausencia de chips.
- Orden: filas de la lista (`within(list).getAllByRole('listitem')`) en el orden Desayuno, Almuerzo, Merienda, Cena con un view model desordenado.
- Destacado: es el primer Pendiente en orden fijo. "Ver receta" tiene `href="/recipes/<id>"` cuando hay `recipeId` y no se renderiza si el destacado tiene `recipeId: null`. En todo registrado aparece "Ya registraste todas las comidas de hoy."; no aparece ningún texto con `/comiste|consumid/i`.
- Error parcial: la lista se ve, `queryByText('Pendiente'|'Registrada'|'Salteada')` es null, aparece la nota y el slot muestra `role="alert"` "No pudimos cargar tu progreso.", todo a la vez.
- Reintentar: con `retry: vi.fn()` el click llama a retry (`userEvent`); sin `retry` no hay botón "Reintentar".
- Slot: para cada `kind`, `within(slot).queryByText(/\d|%/)` es null.
- Accesos: `within(nav 'Accesos rápidos').getAllByRole('link')` tiene longitud 3 y los `href` correctos; `queryByText(/generar/i)` y `queryByText(/perfil/i)` son null.
- Exclusiones, **con scope `within(main)` de DashboardView y no el documento entero** (ver R3): sin `/premium|racha|logro|hidrataci|consejo/i`.
- Fixture `sin-nombre`: el saludo es "Hola".
- Selección de fixture (design.md sección 9): clave conocida, desconocida (→ `comidas`) y ausente (→ `comidas`). Puede ir en este archivo o en `apps/web/src/modules/dashboard/tests/fixtures.test.ts`; se recomienda lo segundo porque es lógica pura.

---

## Fase 3: página, ruta y tests de ruta

### `apps/web/src/modules/dashboard/pages/DashboardPage.tsx` (nuevo)
- `const { user } = useAuth();` (`@/features/auth/AuthProvider`) y `const [searchParams] = useSearchParams();` (`react-router-dom`, mismo uso que `TopBar.tsx:14,50`).
- El view model se calcula **durante el render**, con `useMemo` o inline: `import.meta.env.DEV ? selectDashboardFixture(searchParams.get('estado'), user?.name ?? null) : buildUnavailableViewModel(user?.name ?? null)`. Es síncrono, así que en producción nunca queda un `loading` (CA5).
- Exclusión de fixtures del bundle (D4): import estático de `../fixtures` usado **solo** en la rama del ternario con `import.meta.env.DEV`. Vite reemplaza `import.meta.env.DEV` por `false` en el build y Rollup elimina la rama muerta y el módulo sin efectos secundarios. La Fase 4 lo confirma con el centinela. Plan B, si el centinela aparece en `dist`: `const fixturesModule = import.meta.env.DEV ? await import(...)` dentro de un `useEffect`/`useState`. Eso agrega un estado asíncrono solo en dev, así que conviene el plan A.
- Renderiza `<DashboardView viewModel={viewModel} />`.

### `apps/web/src/app/App.tsx` (modificar)
- Línea 82: `<Route path="/dashboard" element={<PlaceholderPage title="Dashboard" />} />` pasa a `<Route path="/dashboard" element={<DashboardPage />} />`.
- Agregar `import { DashboardPage } from '../modules/dashboard/pages/DashboardPage';` junto a los imports de páginas (`App.tsx:9-14`, estilo de ruta relativa).
- Mantener `PlaceholderPage` (lo usa `/shopping-list`, `App.tsx:87`). No tocar `/` → `/goals` (C25, fuera de alcance).

### `apps/web/src/app/tests/App.test.tsx` (modificar dos aserciones; no se borran tests)
- Línea 171: `expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeVisible();` pasa a `expect(await screen.findByRole('heading', { name: 'Hola, Persona', level: 1 })).toBeVisible();` (el usuario de prueba es `name: 'Persona'`, `App.test.tsx:14-20`). Opcional: agregar `queryByText('Próximamente.')` null.
- Línea 221: lo mismo (`findByRole('heading', { name: 'Hola, Persona', level: 1 })`) y conservar la línea 222.
- Nota: en Vitest `import.meta.env.DEV` vale `true` por defecto, así que estos tests renderizan el fixture `comidas`. El adapter de la línea 217 responde cualquier URL y la página no hace requests, así que no aparecen "Unexpected request".
- Las líneas 189, 207 y 362-366 (redirect anónimo, timeout, destino interno) no necesitan cambios.
- El comentario de las líneas 410-417 menciona `/dashboard` solo como ejemplo de patrón; no se modifica.

### `apps/web/src/modules/dashboard/pages/tests/DashboardPage.test.tsx` (nuevo; primero en rojo)
- `const mockAuth = vi.hoisted(() => ({ user: { id: 'u1', email: 'a@b.c', name: 'María José', createdAt: '', updatedAt: '' } as AuthenticatedUser | null }))` + `vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ status: 'authenticated', user: mockAuth.user, login: vi.fn(), logout: vi.fn() }) }))`.
- `afterEach(() => vi.unstubAllEnvs())`, como en `apiClient.config.test.ts:8-10`.
- Render: `<MemoryRouter initialEntries={['/dashboard?estado=sin-plan']}><DashboardPage /></MemoryRouter>`.
- Casos:
  - Con `vi.stubEnv('DEV', true)`, cada clave principal (`sin-plan`, `error-parcial`, `todo-registrado`, `sin-nombre`) muestra el copy de su estado.
  - Sin `?estado` o con una clave desconocida se muestra `comidas`: aparece "Siguiente comida por registrar".
  - Con `vi.stubEnv('DEV', false)` y `?estado=comidas`, ambas tarjetas dicen "No disponible todavía" (`getAllByText` tiene longitud 2), no hay `[aria-busy="true"]`, no aparece "Receta de ejemplo" ni el centinela y el saludo "Hola, María" se mantiene.
  - Con `user.name = null` el saludo es "Hola".
- Tests existentes revisados que **no deben romperse**: `apps/web/src/common/components/tests/Sidebar.test.tsx:27` y `BottomNavigation.test.tsx:7-13,51` dependen de la etiqueta "Dashboard" de `apps/web/src/common/components/navigation.ts:2`. **No hay que cambiar esa etiqueta** (C22). Ningún otro test referencia `/dashboard`.

---

## Fase 4: verificación (secuencial, la ejecuta el implementer o QA, no esta etapa)

1. `pnpm --filter web test`
2. `pnpm --filter web lint` (`tsc --noEmit`)
3. `pnpm --filter web build` (`tsc -b && vite build`, salida en `apps/web/dist`)
4. `grep -r "nut95-dashboard-fixture-sentinel" apps/web/dist`: tiene que dar **0 coincidencias** (exit code 1). También conviene confirmar que "Receta de ejemplo" no aparece. Hoy `apps/web/dist` existe con un build viejo (`assets/index-*.js`); el paso 3 lo regenera.

---

## Riesgos y gaps

- **G1 (resuelto)**: `AdherenceResponse` se toma literal del contrato A de la descripción de NUT-95 (ver Fase 1).
- **G2**: la estructura aprobada cambia `adherence` a `CardState<null>` y renombra utilidades respecto del diseño. Los reviewers tienen que tomar este plan como referencia.
- **G3**: Flujo 5 (reintento: loading → estado final). Los fixtures son estáticos y no traen `retry`, así que la vuelta de loading a estado final no se ejercita a nivel página. Se cubre en el componente (`retry` llamado / botón ausente sin `retry`). Si el PO quiere la demo en dev, `DashboardPage` puede inyectar un `retry` que resetee solo esa tarjeta con `useState`. Queda fuera del mínimo.
- **R1**: `PageHeader` (`PageHeader.tsx:16-23`) no está montado en ninguna página ni en `AppLayout`, y renderiza `<h1>NutrIA</h1>`. Usarlo en mobile, como sugiere el diseño en la sección 4, generaría dos `h1` y una inconsistencia con el resto de las páginas. Recomendación: no usarlo y dejar el saludo como único `h1`, igual que `MealPlanPage`. Si se usa, poner `md:hidden` y ajustar el nivel del saludo. Conviene validarlo con la responsable.
- **R2**: la eliminación de fixtures depende de que Rollup descarte la rama `import.meta.env.DEV`. El paso 4 de la Fase 4 es la prueba obligatoria; si falla, va el plan B (import dinámico).
- **R3**: el `TopBar` existente muestra "Miembro Premium" (`TopBar.tsx:215`) y está montado en `AppLayout`. Los tests de exclusión deben limitarse al contenido del `DashboardView` (`within`), no al documento. En `App.test.tsx` no hay que agregar aserciones de exclusión. C16 está escalado fuera del ticket.
- **R4**: en Vitest `import.meta.env.DEV` vale `true` salvo que se haga stub. Cualquier test que monte `/dashboard` sin stub ve el fixture `comidas`. Es lo esperado y no trae datos de producción.
- **R5**: `MealType` en `mealPlanService.ts:5` tiene el orden `DINNER, SNACK`. `MEAL_TYPE_ORDER` debe ser explícito (D6) y su test lo fija.
- **R6**: en jsdom `toBeVisible` ignora las clases Tailwind (`hidden`, `md:hidden`), porque no carga CSS. Los tests responsive (390/768/1280 px y sin scroll horizontal) quedan como evidencia QA o Playwright, no en Vitest.
- Sin cambios de DB, Prisma, API, shell ni navegación.

## Addendum (agente padre, 2026-10-19): PageHeader en Fase 1 (decisión de la usuaria, opción c)

- `apps/web/src/common/components/PageHeader.tsx`: el `<h1>` de la marca pasa a texto no-heading (`<p>` con las mismas clases `font-headline text-xl font-semibold text-brand-green`). Se mantienen el contrato de props (`title`, `right`) y el resto de las clases. Es el **único** cambio en ese archivo: el comentario de cabecera queda intacto (decisión de la usuaria: este ticket no quita ni agrega nada relacionado a notificaciones).
- Uso verificado: ningún archivo de `apps/` importa `PageHeader` (ni páginas ni tests).
- Test nuevo `apps/web/src/common/components/tests/PageHeader.test.tsx`: `queryByRole('heading')` es null; la marca "NutrIA" (default) y un `title` custom se ven como texto; el slot `right` se renderiza solo si viene.
- En la Fase 2, `DashboardView` monta `<PageHeader />` dentro de `md:hidden` sin `right`. El saludo es el único `h1`.
