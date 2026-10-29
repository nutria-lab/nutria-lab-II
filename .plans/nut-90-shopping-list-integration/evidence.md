# NUT-90 — Evidencia de implementación

Fecha de verificación: 2026-10-26 UTC (2026-10-25 en America/Argentina/Buenos_Aires). El trabajo se implementó sobre el frontend de NUT-89 y consume el contrato C existente.

## Implementado

- Lectura `GET /shopping-list?weekStart=...` y escritura absoluta `PATCH /shopping-list/items/:itemKey` con `apiClient`, cookie de sesión, timeout, cancelación de lectura y validación de la forma de respuesta.
- Semana en `?weekStart=YYYY-MM-DD`; se valida fecha real y lunes y se calcula el fallback con `America/Argentina/Buenos_Aires` sin convertir la fecha calendario por la zona local del navegador.
- La página utiliza la sesión actual, mantiene el encabezado y el selector durante carga/error, descarta datos y callbacks de otra semana/sesión y preserva otros parámetros de URL.
- Check confirmado sólo tras PATCH válido; guarda inmediata contra doble envío por producto, concurrencia entre productos con cálculo de resumen desde `items`, reintento manual de la misma intención y aviso de error inline.
- `409 SHOPPING_LIST_STALE` bloquea las marcas del snapshot vencido, espera escrituras iniciadas, hace una sola lectura de reconciliación y no repite intenciones. `404` pide actualizar la lista.
- El interceptor de autenticación ignora 401/403 de solicitudes ya obsoletas; las solicitudes vigentes conservan el manejo global existente.
- Se eliminó el aviso de fixture de la página real. Se conservan estados sin plan, plan vacío, lista parcial, cantidades desconocidas y warnings.

## Verificaciones ejecutadas

| Comando | Resultado |
|---|---|
| `npm.cmd test -- --reporter=dot` | Suite frontend completa: 54 archivos y 609 pruebas aprobadas. |
| `npm.cmd test -- --reporter=dot src/modules/shopping-list src/services/tests/shoppingListService.test.ts src/services/tests/apiClient.test.ts` | 6 archivos, 39 pruebas aprobadas. Incluye servicio GET/PATCH, token intacto, no `userId`, 409 sin replay, reintento explícito, doble envío y respuesta tardía de otra semana/sesión. |
| `npm.cmd test -- --reporter=dot src/features/auth/tests/AuthProvider.test.tsx` | 1 archivo, 11 pruebas aprobadas. |
| `npm.cmd run build` | TypeScript y Vite aprobaron. Vite reporta un chunk JS de 502.17 kB, por encima del umbral de 500 kB. |

## Límites y pendientes de cierre

- No se ejecutó contra API de desarrollo con sesión real. Persistencia al recargar, aislamiento entre dos usuarios y comportamiento al regenerar el plan siguen pendientes de validación integrada.
- No se obtuvo captura de la implementación en 390, 768 y 1280 px ni validación manual con lector de pantalla. Las pruebas de componentes cubren foco, checkbox accesible y estado pendiente; no sustituyen esa revisión visual/manual.
- El comando requerido por `google-modern-web-guidance` (`npx`/`npm exec`) terminó con código `-1` y salida vacía en este entorno. No se inventó guía ni ID.
- La elección del usuario de avisos inline Terra define el enfoque visual, pero el plan exige aprobación PO de los estados nuevos antes del cierre.
- La revisión de código fue realizada por el agente principal; no se usaron subagentes. No se registraron horas reales.

## Archivos principales

- Servicio y validación HTTP: `apps/web/src/services/shoppingListService.ts`.
- Estado, concurrencia, reintentos y reconciliación: `apps/web/src/modules/shopping-list/hooks/useShoppingList.ts`.
- URL, semana y sesión: `apps/web/src/modules/shopping-list/pages/ShoppingListPage.tsx`.
- Estados y controles: `apps/web/src/modules/shopping-list/components/ShoppingListView.tsx` y `ShoppingListItem.tsx`.
