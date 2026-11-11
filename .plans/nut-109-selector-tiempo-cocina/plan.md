# NUT-109 — Plan y evidencia

Generado: 2026-11-02. Base: `origin/main` @ `8194482`. Design: `design.md` de esta carpeta.

## Archivos

| Archivo | Cambio |
|---|---|
| `apps/web/src/modules/profile/cookTimeOptions.ts` | Nuevo. `COOK_TIME_OPTIONS` e `isCookTimePreference` |
| `apps/web/src/modules/profile/components/CookTimeSelector.tsx` | Slider por posiciones sobre `COOK_TIME_OPTIONS`, `aria-valuetext`, tres marcas, estado "Sin elegir"; se eliminan los mapas de minutos |
| `apps/web/src/modules/profile/pages/PreferencesPage.tsx` | Un valor fuera del enum queda "Pendiente", no suma al progreso y no se puede guardar |
| `apps/web/src/modules/profile/hooks/useNutritionProfile.ts` | `validateProfile` rechaza un valor fuera del enum |
| `apps/web/src/modules/profile/hooks/tests/useNutritionProfile.test.ts` | Valor fuera del enum sin llamar a la API |
| `apps/web/src/modules/profile/components/tests/CookTimeSelector.test.tsx` | Nuevo. Regresión, teclado, táctil, anuncios, marcas, disabled, valor desconocido, desktop |
| `apps/web/src/modules/profile/pages/tests/PreferencesPage.cookTime.test.tsx` | Nuevo. Integración con el hook real: guardar y recargar, guardando, fallo y reintento |

Dueños: estos archivos no se comparten con otros tickets abiertos; sin orden de merge. Enums y backend sin cambios.

## Criterios de aceptación → pruebas

`S` = `CookTimeSelector.test.tsx`; `P` = `PreferencesPage.cookTime.test.tsx`; `H` = `useNutritionProfile.test.ts`.

| Criterio | Pruebas | Navegador real |
|---|---|---|
| Solo QUICK=15, STANDARD=30, GOURMET=60; cada movimiento avanza o retrocede entre ellas | S: "regression: from 30 min…", "exposes only the three options…", "arrows walk 15→30→60 and back…" | Teclado, 390×844 |
| Flechas, Home/End y táctil llegan a las tres; etiqueta y anuncio coinciden | S: "arrows walk…", "Home goes to 15 min and End to 60 min…", "from %s, a change event to position %s (touch)…", "%s announces the readable option…", "shows one mark per position…" | Teclado y toque (tap) |
| Guardar y recargar conserva el enum; desktop equivalente | P: "from %s, saving position %s sends %s and a reload keeps it", "a desktop card saves the same enum…"; S: "%s selects %s (from %s) and moves the slider…" | Guardar y recargar |
| `disabled` mientras se guarda; un fallo conserva la selección para reintentar | P: "while saving…", "a failed save keeps the selection…"; S: "is disabled when the disabled prop is set", "every card is disabled when the disabled prop is set" | PUT retenido y 500 + reintento |
| Interacción 15→30→60 y vuelta, extremos y selección persistida | S: "arrows walk…", "at 15 min, the left arrow and Home…", "at 60 min, the right arrow and End…"; P: "from %s, saving position…" | Teclado y recarga |

Valor fuera del enum: S "a value outside the enum is shown as not chosen…"; P "with a stored value outside the enum" (2 pruebas); H "rejects saving a cook time outside the enum…".

## Evidencia de la regresión

Antes del arreglo (`8194482`):
- Vitest: "regression: from 30 min, one right arrow goes to 60 min…" falla con `expected last "vi.fn()" call to have been called with [ 'GOURMET' ]`. Es la prueba que demuestra el bug; otras también fallan contra el código viejo, pero sobre todo porque cambió la codificación a posiciones.
- Navegador (Edge, 390×844, API simulada, teclado real): desde 30, `ArrowRight` deja `value=30` y "30 min"; sin `aria-valuetext`.

Después del arreglo:
- Navegador: `ArrowRight` pasa a `value=2`, "60 min", "Gourmet, 60 minutos". Los extremos no se mueven; Home, End, `ArrowUp` y `ArrowDown` funcionan.
- Toque (emulación táctil): tap al centro, al final y al inicio selecciona 30, 60 y 15.
- Guardado: durante el PUT el slider queda deshabilitado; con 500 conserva `GOURMET`; el reintento envía `GOURMET`; tras recargar sigue `GOURMET`.
- Marcas: a 320 px el centro de "Estándar" coincide con el centro del slider (x=160), sin desborde horizontal.

- Valor fuera del enum a 320 px: `aria-valuetext` "Sin elegir", guardado deshabilitado, sin desborde horizontal.

Capturas: `evidence/antes-390.png`, `evidence/despues-390.png`, `evidence/despues-320.png`, `evidence/sin-elegir-320.png`.

## Límites de la evidencia

- jsdom no mueve un range con teclado: las pruebas aplican el paso según `min`, `max` y `step` reales. El teclado real se verificó una vez en el navegador; no hay E2E automatizado.
- Táctil: se verificó tap en el navegador y evento `change` en las pruebas; el arrastre continuo no se ejercitó.
- La API estuvo simulada; no se probó contra backend real.
- Lector de pantalla: se verificó el atributo `aria-valuetext`, no el anuncio en NVDA o VoiceOver.
