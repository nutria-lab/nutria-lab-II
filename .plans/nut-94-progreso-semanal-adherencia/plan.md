# NUT-94 — Plan

Actualizado: 2026-10-27.

## Dueños de archivos compartidos y orden de merge

| Archivo (`apps/web/src/modules/dashboard/…`) | Dueño | Estado | NUT-94 |
|---|---|---|---|
| `types.ts` (`AdherenceResponse`, `MealCompletionStatus`, `DashboardViewModel`) | NUT-95 | en `main` (PR #67) | cambia el tipo de `DashboardViewModel.adherence` a `AdherenceWidgetViewProps` |
| `adherence-widget/types.ts` (`AdherenceWidgetProps`) | NUT-95 | en `main` (PR #67) | sin cambios |
| `adherence-widget/fixtures.ts` + test | NUT-103 | rama `mariajoserosalestorres/nut-103-…`, sin mergear | sin cambios; lo consume |
| `fixtures.ts` (fixtures dev `?estado=`) + test | NUT-95 | en `main` | agrega claves de progreso y usa los fixtures del widget |
| `components/DashboardView.tsx` + tests, `pages/tests/DashboardPage.test.tsx` | NUT-95 | en `main` | usa el widget; tests ajustados |
| `adherence-widget/AdherenceWidget.tsx`, `utils.ts`, `stateFixtures.ts` + tests | NUT-94 | nuevos | — |
| `components/AdherenceWidgetSlot.tsx` + test | NUT-95 | en `main` | se elimina (lo reemplaza el widget) |

Orden de merge: NUT-103 → NUT-94 → NUT-96. La rama de NUT-94 parte de la de NUT-103; después del merge de NUT-103 se rebasea sobre `main`.

Contrato duplicado sin resolver: la rama `fercesio11/nut-102-…` define `modules/adherence/types.ts` con `AdherenceResponse`, `MealCompletionStatus` y `AdherenceMeal`, el mismo dato que `dashboard/types.ts`. NUT-94 no lo usa. Decidir un único dueño antes de mergear NUT-102.

## Cambios

| Archivo | Cambio |
|---|---|
| `adherence-widget/utils.ts` | `AdherenceWidgetViewProps`, `ExpectedAdherence`, `formatAdherencePercent`, `hasNoRecords`, `isStaleAdherence`, `isConsistentAdherence` |
| `adherence-widget/AdherenceWidget.tsx` | componente (design §2–§5) |
| `adherence-widget/stateFixtures.ts` | `noRecords`, `staleWeek`, `stalePlan`, `inconsistent` |
| `adherence-widget/tests/*` | combinaciones, contenido, reglas aisladas, copy, axe, teclado, responsive, fixtures |
| `fixtures.ts` | `sin-plan` usa `noPlan`; `comidas` y similares usan `partial`; claves `progreso-*`; `adherenceResponseFixture` con porcentajes del contrato A |
| `types.ts` | `DashboardViewModel.adherence: AdherenceWidgetViewProps` |
| `components/DashboardView.tsx` | renderiza `AdherenceWidget` |
| `apps/web/package.json` | devDependency `axe-core@4.10.3` |

## Verificación

- `npx vitest run` (web): 52 archivos, 777 tests en verde.
- `npx tsc --noEmit`: sin errores.
- `npm run build` + búsqueda en `dist/`: 0 coincidencias de las cadenas centinela de fixtures.
