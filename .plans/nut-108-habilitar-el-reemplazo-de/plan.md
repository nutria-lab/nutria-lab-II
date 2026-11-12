# NUT-108 — Plan de implementación

Generado: 2026-11-12. Base: `origin/main` @ `99b8964`. Design: `design.md` de esta carpeta.

## Dueños

| Archivo / modelo | Dueño | Nota |
|---|---|---|
| `ReplaceMealModal` | NUT-79 (creado, sin usar) | NUT-108 lo conecta y completa foco/teclado. Prop `isSubmitting` reemplazada por `isConfirmBlocked` (único consumidor: `MealPlanPage`). |
| `useReplaceMeal` (`ReplaceMealError`, idempotencia) | NUT-79 | El texto de error pasa a fijo (`REPLACE_MEAL_ERROR_MESSAGE`) y se quita `isSubmitting` del retorno (era un ref sin re-render y no tenía consumidores). `retryReplace` no se toca. |
| `common/components/Modal.tsx` | — | Sin cambios; su trampa de foco no se comparte todavía (ver Seguimiento). |
| `mealPlanService.replacePlannedMeal`, backend | — | Sin cambios. |

## Archivos

| Archivo | Cambio | Design |
|---|---|---|
| `apps/web/src/modules/meal-plan/pages/MealPlanPage.tsx` | Renderiza `ReplaceMealModal` con `activeModalMeal` (la comida elegida solo si sigue en el plan vigente); `handleConfirmDesktopModal` cierra el diálogo antes de `replaceMeal` y no confirma si hay `replacingMealId`; `desktopReplaceMealId` marca la tarjeta que maneja el foco: se fija al confirmar y al reintentar desde la grilla, y se limpia al iniciar o reintentar desde móvil; `onSuccess`/`onError` ya no cierran el diálogo; `isConfirmBlocked={replacingMealId !== null}` | D1, D3, D4, D5, D6, D11 |
| `apps/web/src/modules/meal-plan/components/ReplaceMealModal.tsx` | Textos NUT-79; foco inicial y devolución al disparador (efecto solo con `isOpen`); trampa de Tab/Shift+Tab; `isConfirmBlocked` con aviso `role="status"`; Cancelar/Escape siempre activos | D2, D5 |
| `apps/web/src/modules/meal-plan/components/MealCard.tsx` | Variante compacta: `article` con `tabIndex={-1}` y anillo `focus-visible`; prop `manageReplaceFocus`: en la transición a `isReplacing` enfoca la tarjeta; al terminar o al descartar el error devuelve el foco al botón si está en la tarjeta o en `body`. Las transiciones se detectan con refs del valor anterior, así que montar no mueve el foco | D4 |
| `apps/web/src/modules/meal-plan/hooks/useReplaceMeal.ts` | `REPLACE_MEAL_ERROR_MESSAGE` fijo en lugar de `err.message`; sin `isSubmitting` en el retorno | D6, D9 |

## Pruebas

| Archivo | Casos |
|---|---|
| `apps/web/src/modules/meal-plan/pages/tests/MealPlanPage.test.tsx` | Bloque "reemplazo de comida en escritorio": 13 casos (design §5). Escritorio se consulta dentro de `weekly-grid` ("Cambiar comida …"); móvil dentro de la vista con `tablist` ("Reemplazar comida …"). El mock del servicio agrega `replacePlannedMeal`; el texto de error se importa del hook. |
| `apps/web/src/modules/meal-plan/hooks/tests/useReplaceMeal.test.ts` | Nuevo: texto fijo para error con mensaje técnico, sin mensaje y rechazo que no es `Error`; el texto es el aprobado. |

## Evidencia

- Rojo (pruebas finales contra `HEAD` sin el fix): 16 fallan, 15 pasan. 11 por `Unable to find role="dialog" and name "Reemplazar Avena con frutos rojos"`; 4 del hook y 1 de móvil porque no existe el texto fijo (`REPLACE_MEAL_ERROR_MESSAGE` es `undefined` y se muestra el texto técnico).
- Verde: suite web completa, `tsc --noEmit` y `npm run build`.
- Manual: scroll y comportamiento real en ≥1280 px y <1280 px (pasos en la descripción del PR).

## Seguimiento (fuera de alcance)

- Compartir la trampa de foco entre `ReplaceMealModal` y `common/components/Modal.tsx`.
- Concurrencia preexistente entre vistas y flujos: confirmar en móvil mientras corre un reemplazo de escritorio (por ejemplo, tras achicar la ventana) se descarta sin aviso; un reemplazo en curso cuando termina una regeneración actualiza un plan que ya no existe; el foco sobre elementos ocultos al cruzar los 1280 px.
- `retryReplace` con `planId ''` cuando no hay intención guardada (rama inalcanzable hoy).
