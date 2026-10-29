# NUT-96 — Plan de implementación

Generado: 2026-10-29. Base: `origin/main` @ `04eb9a4` (incluye NUT-94, NUT-95, NUT-102, NUT-103, NUT-89). Design: `design.md` de esta carpeta.

## Dueños y orden de merge

| Archivo / modelo | Dueño | Nota |
|---|---|---|
| `modules/adherence/types.ts` (`AdherenceResponse`, `MealCompletionStatus`, `AdherenceMeal`) | NUT-102 | Modelo único. NUT-96 no lo modifica; `modules/dashboard/types.ts` lo re-exporta. |
| `modules/shopping-list/types.ts` (`ShoppingListResponse`) | NUT-89 | NUT-96 solo usa `Pick<…, 'weekStart' \| 'plan' \| 'summary'>`. |
| `services/shoppingListService.ts` | NUT-90 (Fer, sin mergear) | NUT-96 no lo copia. Adaptador mínimo propio con `// TODO` para unificar cuando NUT-90 esté en main. Sin orden de merge obligatorio: no comparten archivos. |
| `services/apiClient.ts`, `services/mealPlanService.ts`, planificador | — | Sin cambios. |
| Coordinador del Inicio, adaptadores del Inicio | NUT-96 | Único dueño. NUT-93 no se usa. |

## Archivos

| Archivo | Cambio |
|---|---|
| `apps/web/src/modules/dashboard/types.ts` | Re-exporta los tipos de adherencia; `ShoppingProgress`; `DashboardViewModel.shopping: CardState<ShoppingProgress>` |
| `apps/web/src/modules/dashboard/services/dashboardAdherenceService.ts` | Nuevo. `getForWeek(weekStart, signal)` + `isAdherenceResponse` (D3, D7) |
| `apps/web/src/modules/dashboard/services/dashboardShoppingService.ts` | Nuevo. `getForWeek(weekStart, signal)` + `isShoppingProgress` (D4, D7) |
| `apps/web/src/modules/dashboard/dates.ts` | Nuevo. Fecha de hoy, lunes y domingo en Buenos Aires, fecha calendario válida (D6) |
| `apps/web/src/modules/dashboard/coordinator.ts` | Nuevo, puro. Recursos, `planIdOf`/`planIdsOf`/`hasPlanConflict`, `isUsableMealPlan`, `buildDashboardViewModel` (design §2) |
| `apps/web/src/modules/dashboard/hooks/useDashboardData.ts` | Nuevo. Carga paralela, validación del plan, cancelación, reconsulta acotada, identidad, cambio de semana, refresco al volver, 401/403 (D7–D13) |
| `apps/web/src/modules/dashboard/pages/DashboardPage.tsx` | Usa el coordinador salvo fixture válido de desarrollo (D15) |
| `apps/web/src/modules/dashboard/components/QuickAccessLinks.tsx` | Recibe `shopping` y muestra §2.3 |
| `apps/web/src/modules/dashboard/components/DashboardView.tsx` | Pasa `viewModel.shopping` |
| `apps/web/src/modules/dashboard/utils.ts` | `isKnownMealType`; `buildUnavailableViewModel` con `shopping` |
| `apps/web/src/modules/dashboard/fixtures.ts` | `shopping` en todos los fixtures; claves `compras-sin-productos`, `compras-error` |
| `apps/web/src/modules/dashboard/adherence-widget/types.ts` | Solo el comentario del estado "No disponible todavía" |

## Pruebas

| Archivo | Cubre |
|---|---|
| `modules/dashboard/services/tests/dashboardAdherenceService.test.ts` | contrato A, enums aislados, timezone, semana, 404/500/401 propagados |
| `modules/dashboard/services/tests/dashboardShoppingService.test.ts` | contrato C mínimo, semana, contadores |
| `modules/dashboard/tests/dates.test.ts` | bordes de zona horaria |
| `modules/dashboard/tests/coordinator.test.ts` | tablas §2.1–§2.4 |
| `modules/dashboard/hooks/tests/useDashboardData.test.tsx` | CA2, CA3, CA4, CA5 |
| `modules/dashboard/hooks/tests/useDashboardData.session.test.tsx` | Integración con el `apiClient` real: 401/403 de sesión llaman al manejo global (una vez) y dejan las tarjetas no disponibles; el 403 de access gate no lo llama |
| `modules/dashboard/components/tests/QuickAccessLinks.test.tsx` | §2.3, CA1 compras |
| `modules/dashboard/pages/tests/DashboardPage.test.tsx` | producción con datos reales, CA1 adherencia, fixtures dev |
| `modules/dashboard/tests/fixtures.test.ts` | fixtures de compras |

## Verificación

`npx vitest run`, `npx tsc --noEmit`, `npm run build` + búsqueda del centinela en `dist/`.
