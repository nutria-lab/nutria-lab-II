# Plan de implementación: compras con fixtures C

## Resultado

Reemplazar el placeholder de `/shopping-list` por una pantalla de compras accesible en desktop, tablet y móvil. La entrega acredita UI con fixtures del contrato C. NUT-90 conectará GET/PATCH reutilizando estos componentes.

Responsable: Fer Cesio (FE1). Estimación: 4 h / 4 puntos, incluyendo revisión y pruebas. Son horas previstas, no registradas. Vencimiento original: 2026-10-21; este plan no modifica calendario ni capacidad.

## Hallazgos confirmados

- La ruta está en `apps/web/src/app/App.tsx`; muestra `PlaceholderPage` con título `Shopping List`.
- Está protegida por `ProtectedApp` y usa `AuthProvider` y `AppLayout`. Existen `/meal-plan` y `/login` para los CTA.
- No se encontró un módulo de compras implementado.
- Terra se define en `apps/web/src/index.css`. La implementación utilizará sus tokens mediante Tailwind, sin CSS propio.
- Los helpers de `apps/web/src/modules/meal-plan/utils.ts` no son un validador estricto de fecha calendario. No ampliar este ticket para refactorizarlos globalmente.
- CodeGraph no tenía un índice utilizable; se utilizó `rg` como alternativa.

## Archivos propuestos

Dentro de `apps/web/src/modules/shopping-list/`:

| Archivo | Responsabilidad |
|---|---|
| `types.ts` | Contrato `ShoppingListResponse` exacto, más tipos de estado y props locales. |
| `fixtures/shoppingList.fixture.ts` | Datos deterministas y escenarios de pantalla. |
| `pages/ShoppingListPage.tsx` | Composición y contenedor local de fixtures intercambiable por NUT-90. |
| `components/ShoppingListView.tsx` | Vista controlada: estados, semana, avisos y progreso; sin HTTP. |
| `components/ShoppingListItem.tsx` | Fila con cantidad, unidad y checkbox nativo accesible. |
| `components/tests/ShoppingListView.test.ts` | Estados, cantidades, warnings y acciones. |
| `pages/tests/ShoppingListPage.test.ts` | Semana y comportamiento local con fixtures. |

Modificar la entrada de compras en `apps/web/src/app/App.tsx` para montar la página. Conservar protección, layout y navegación. La UI debe aparecer en la ruta real, no quedar disponible únicamente en una demo separada.

Crear helpers locales de formato/fecha solo si hacen falta. No construir un agregador de ingredientes en frontend.

## Secuencia y presupuesto previsto

### 1. Validar diseño — 30 min

Revisar Compras desktop y Compras móvil; acordar con PO los estados nuevos de carga, sin plan, vacío, parcial, error y sesión vencida. La aprobación anterior de adherencia no aprueba estos estados de compras. Conservar Terra y Tailwind.

### 2. Contrato, fixtures y pruebas iniciales — 45 min

- Preservar nombres, nulabilidad, enums y fuentes del contrato C sin modificar el DTO.
- Crear fixtures completos, parciales, sin plan y con plan sin ingredientes. Loading, error y sesión son estados del contenedor, no campos nuevos del contrato.
- Incluir cantidad/unidad null, decimales, acentos, g y kg separados, filas con igual nombre y distinta key, checks y ambos tipos de warning.
- Conservar orden y semana recibidos. No normalizar ni sumar ingredientes, fusionar sinónimos, convertir unidades o inventar porciones.
- Preparar pruebas que fallen antes de implementar la UI.

### 3. UI y ruta — 90 min

- Mostrar la semana seleccionada y mantener `weekStart` como fecha calendario. Si se recibe por URL, validar fecha real y lunes sin convertirla a la zona del navegador.
- Un cambio de semana usa su fixture correspondiente o un estado explícito sin plan; no reutiliza silenciosamente datos de otra semana.
- Formatear cantidades con máximo tres decimales. Mostrar null como «Cantidad no disponible» y no inventar una unidad ausente.
- Mostrar warnings usando solo información disponible en el DTO. Conservarlos aunque todos los ítems estén marcados.
- Progreso: ítems marcados sobre ítems disponibles. Con cero ítems no declarar compra completa; con warnings advertir que la lista puede estar incompleta.
- Checkbox nativo y callback `onSetChecked(key, checked)`. La simulación local aplica el booleano solicitado y recalcula el contador desde `items`, sin deltas acumulados ni persistencia.
- Identificar claramente los datos ficticios hasta NUT-90. Los controles para forzar escenarios quedan limitados a pruebas o desarrollo.
- Conectar CTA al planificador, reintento y acceso a login según el estado. No modificar el mecanismo global de autenticación.

### 4. Verificación — 45 min

- Cubrir estados, acciones, orden, semana y distinción entre `plan:null` y plan con `items:[]`.
- Verificar cantidades null, formato decimal, warnings persistentes y contadores desde ítems.
- Teclado, foco visible, labels y estados anunciados; no depender exclusivamente del color.
- Revisar desktop, tablet y móvil: texto largo, ajuste de cantidades y ausencia de desbordamiento horizontal.
- Capturas desktop/móvil y comprobación de tablet. Distinguir semántica automatizada de pruebas manuales con lector de pantalla.
- Ejecutar pruebas enfocadas, TypeScript y build; ampliar regresión solo si hay cambios o fallos que lo justifiquen.

### 5. Revisión y handoff — 30 min

Realizar las cuatro revisiones previstas en AGENTS.md. Documentar props, callbacks, fixtures, resultados y limitaciones. Entregar versión probada a NUT-90. No registrar como reales las horas previstas.

## Estados requeridos

| Estado | Presentación |
|---|---|
| Loading | Mensaje anunciado; sin datos falsos ni acciones sobre otra semana. |
| Sin plan | `plan:null`, CTA a `/meal-plan`; no declarar lista completa. |
| Plan sin ingredientes | Plan presente y lista vacía con explicación propia. |
| Lista disponible | Orden recibido, cantidades, unidades, checks y progreso. |
| Parcial | Ítems recuperados y cantidades desconocidas junto a warnings visibles. |
| Error | Mensaje y reintento; sin fingir éxito. |
| Sesión vencida | Estado representable mediante fixture y acceso a login. |

## Frontera con NUT-90

Este ticket no implementa HTTP, cookies, autorización, base de datos ni persistencia. NUT-90 conectará `apiClient` con credentials y enviará `planId`, el `planUpdatedAt` original y `checked`.

El manejo real de 401/404/409/500 corresponde a NUT-90. Ante `409 SHOPPING_LIST_STALE`, recargará y pedirá otra interacción sin trasladar el check a otra key. Si se propone una superficie visual nueva de conflicto, requiere validación PO.

No modificar landing, dashboard, backend, Prisma, migraciones o PWA. Omitir costo, PDF, compartir, agregar/borrar productos, categorías sin fuente y consejos no implementados.

## Pendientes y límites de la investigación

- Fuente: ticket completo pegado por el usuario. El documento enlazado de Linear no fue accesible con las herramientas disponibles.
- Stitch solicitó autenticación. Los frames obligatorios no fueron inspeccionados; los estados nuevos de compras no se consideran aprobados.
- No se encontró `management/links.md` en el checkout revisado. No se inventaron enlaces de referencia.
- La validación visual sigue pendiente antes de implementar esos estados; no impide preparar contrato, fixtures o pruebas.

## Cierre

La ruta real muestra fixtures C, cubre los estados requeridos, conserva semana y orden, comunica cantidades desconocidas y advertencias y tiene evidencia responsive y de accesibilidad. El cierre no acredita API real.

Este documento es planificación basada en la investigación realizada. No se implementó producto ni se ejecutaron pruebas al prepararlo.
