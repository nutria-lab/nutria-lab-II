# NUT-96 — Inicio con datos reales de plan, compras y adherencia (diseño frontend)

Etapa: diseño. Generado: 2026-10-29. Alcance: solo frontend. Endpoints, persistencia y migraciones son de backend (contratos A y C de referencia). Fuente visual: Stitch proyecto `5785725448623770239`, frames "Dashboard - Terra Kitchen" (`e631a85a…`) y "Dashboard - Móvil" (`ae8d7cb5…`), solo lectura.

## 1. Decisiones

| # | Decisión | Motivo |
|---|---|---|
| D1 | Un único coordinador del Inicio pide en paralelo el plan actual, la adherencia (contrato A) y el resumen de compras (contrato C) para la semana en curso, y entrega a cada tarjeta datos, estado y reintento. Las tarjetas no hacen HTTP. | El ticket es el único dueño de la coordinación; NUT-94 no tiene un segundo coordinador. |
| D2 | La consulta del plan reutiliza el servicio existente del planificador sin modificarlo: 404 = sin plan; cualquier otro fallo es error. | CA4; no se cambia el planificador. |
| D3 | El adaptador de adherencia es propio del Inicio y valida el contrato A completo (formas, `timezone` literal, enums de `mealType` y `status`). Un `mealType` desconocido invalida la respuesta (error recuperable). Un `status` desconocido se conserva y la tarjeta de comidas lo muestra como "estado no disponible" (sin chips, nota fija). | Regla de enums: un valor nuevo nunca se presenta como un estado conocido. |
| D4 | El adaptador de compras es propio del Inicio, mínimo: valida solo `weekStart`, `plan` (`id`, `version`, `updatedAt`) y `summary` (`totalItems`, `checkedItems` enteros ≥ 0, marcados ≤ total, sin plan ⇒ total 0). Se unificará con el adaptador de compras de NUT-90 cuando se mergee. | No se toca el cliente HTTP compartido ni se duplica el adaptador completo de NUT-90. |
| D5 | El tipo `AdherenceResponse` (y `MealCompletionStatus`, comida y día) tiene un único modelo: el del módulo de adherencia (NUT-102). El dashboard lo re-exporta. | Un solo modelo por dato entre tickets. |
| D6 | Semana y "hoy" se calculan en `America/Argentina/Buenos_Aires` con la fecha calendario, nunca con la zona del navegador. `weekStart` = lunes de hoy en esa zona. Cuando la adherencia responde, su `today` manda. | Reglas comunes 2 y 3. |
| D7 | Toda respuesta debe ser de la semana pedida (`weekStart` de A y C, `startDate` del plan); si no, es inválida (error). En A, `today` debe caer dentro de esa semana. Lo que el Inicio lee del plan (id, fechas, comidas con id, tipo y título) se valida antes de usarlo; un plan mal formado es error recuperable. | No usar datos de otra semana (CA2); nunca afirmar "hoy no hay comidas" por un dato inválido ni romper la pantalla. |
| D8 | Coherencia de versión: se comparan los `planId` de las respuestas exitosas (plan actual, adherencia, compras; `null` cuenta como valor). Si difieren, se cancela y se reconsulta todo **una sola vez**. Si siguen difiriendo, las tres tarjetas de datos pasan a error recuperable ("conflicto") y no se muestran datos de ninguna. Reintentar vuelve a habilitar una reconsulta acotada. | CA3; no mezclar versiones. |
| D9 | Un dato retenido de una carga anterior (refresco que falló) se descarta si su `planId` no coincide con el de la carga nueva. | No mezclar versiones en refrescos. |
| D10 | Cancelación: cada carga aborta la anterior (AbortController) y lleva un número de pedido; una respuesta de un pedido viejo o cancelado por nosotros se ignora y nunca se muestra como error. Una cancelación que no pedimos sobre el pedido vigente es error recuperable (nunca una carga infinita). Desmontar aborta. | Respuesta obsoleta (CA5). |
| D11 | Identidad: el estado queda atado a `(usuario, semana)`. Si cambia el usuario de la sesión, los datos previos no se muestran ni un render: se ve la carga y se pide de nuevo. Sin usuario no se pide nada. | No mostrar datos de otro usuario (CA2). |
| D12 | Refresco al volver: cada vez que se monta el Inicio se consulta todo (volver desde el plan o la lista de compras remonta la página); además, al volver a la pestaña (`visibilitychange` → visible) se refresca conservando los datos mientras carga, como mucho una vez cada 30 s desde la última carga (montaje, pestaña o Reintentar); un cambio de semana no espera. Reintentar nunca se limita. Cada carga (montaje, pestaña o Reintentar) recalcula la semana: pasada la medianoche del domingo en Buenos Aires pide la semana nueva y oculta la anterior. | CA2. |
| D13 | Sin acceso (401 y todo 403) no es un error de tarjeta: el 401 y el 403 de sesión los resuelve la sesión global (cierra sesión y navega a /login) y el 403 `ACCESS_GATE_REQUIRED` es del access gate. El recurso queda "No disponible todavía", sin carga, sin mensaje y sin Reintentar. Los componentes nunca reciben un 401 ni un 403. | Contrato D; un Reintentar que nunca puede funcionar no es una salida. |
| D14 | Los mensajes de error que viajan a las tarjetas son códigos internos fijos; la UI usa textos fijos. | Regla 2. |
| D15 | Los fixtures `?estado=` siguen existiendo solo en desarrollo; con una clave válida reemplazan al coordinador (que no pide nada). Sin clave válida, desarrollo y producción usan datos reales. | El PO puede ver cada estado; producción nunca muestra datos de ejemplo. |
| D16 | Las imágenes de "Comidas de hoy" se completan con la imagen de la receta del plan actual (por `plannedMealId`), solo si existe. | NUT-95 §15: imagen opcional, sin placeholder. |

ADR: no requerido (no cambia contratos de API ni modelo de datos).

## 2. Estados por recurso

Cada recurso tiene `status ∈ {loading, success, error, unauthorized}` y opcionalmente datos retenidos de la misma `(usuario, semana)`. Más un indicador global `conflict` (D8).

### 2.1 Tarjeta "Comidas de hoy" y "Siguiente comida"

Prioridad de arriba hacia abajo; la primera fila que aplica gana.

| Condición | Se muestra |
|---|---|
| `conflict` | error "No pudimos cargar tus comidas de hoy." + Reintentar |
| plan `unauthorized` | "No disponible todavía" |
| plan sin datos y `loading` | skeleton |
| plan sin datos y `error` (500, red, otra semana, mal formado) | error + Reintentar (nunca "sin plan") |
| plan = sin plan (404) | "Todavía no tenés un plan para esta semana." |
| plan con datos y adherencia con datos | comidas de `today` (adherencia) ordenadas, con imagen si la receta del plan la tiene; vacío → "No hay comidas planificadas para hoy." |
| plan con datos, adherencia sin datos y `loading` | skeleton |
| plan con datos, adherencia sin datos y alguna comida de hoy del plan con `mealType` desconocido | error + Reintentar |
| plan con datos, adherencia sin datos (`error` o `unauthorized`) | error parcial: comidas de hoy (fecha Buenos Aires) del plan, sin chips + "El estado de registro no está disponible por ahora."; vacío → "No hay comidas planificadas para hoy." |

### 2.2 Widget "Progreso de la semana" (NUT-94)

Recibe `{ data, loading, error, onRetry, expectedWeekStart, expectedPlanId }`; la precedencia visual es la del design de NUT-94 §2.

| Condición | Props |
|---|---|
| `conflict` | `data: null`, `loading: false`, `error: 'PLAN_CONFLICT'` → error + Reintentar |
| adherencia `unauthorized` | `data: null`, `loading: false`, `error: null` → "No disponible todavía" |
| adherencia `loading` | datos retenidos o `null`, `loading: true`, `error: null` → skeleton o refresco |
| adherencia `error` | datos retenidos o `null`, `loading: false`, `error: 'ADHERENCE_UNAVAILABLE'` → error o aviso "No pudimos actualizar tu progreso." |
| adherencia `success` | respuesta, `loading: false`, `error: null` |

Siempre: `expectedWeekStart` = semana pedida; `expectedPlanId` = id del plan actual (o `null` si no hay) solo cuando la consulta del plan tiene datos; si no, sin valor esperado.

### 2.3 Acceso "Lista de compras"

El texto secundario del acceso refleja el resumen del contrato C; el acceso siempre navega.

| Condición | Texto secundario | Extra |
|---|---|---|
| `loading` sin datos, `unauthorized`, o sin plan (`plan: null`) | "Ingredientes de tu plan" | — |
| datos con plan y `totalItems = 0` | "Todavía no hay productos para marcar." | — |
| datos con plan y `totalItems > 0` (también durante un refresco) | "{checkedItems} de {totalItems} marcados" (valores del contrato, sin recalcular) | — |
| `error` (con o sin datos retenidos) o `conflict` | "Ingredientes de tu plan" | debajo del acceso, fuera del enlace: "No pudimos cargar el avance de tus compras." + Reintentar |

### 2.4 Combinaciones globales

| Caso | Resultado |
|---|---|
| sin usuario en sesión | no se pide nada; todas las tarjetas "No disponible todavía" |
| fixture de desarrollo válido | se muestra el fixture; el coordinador no pide nada |
| todo falla con 500 | tres errores independientes, cada uno con Reintentar |
| plan 404 + adherencia `plan: null` + compras `plan: null` | coherente: "sin plan" en comidas y progreso, compras sin contador |
| plan 404 + adherencia con plan | `planId` distinto → reconsulta → conflicto si persiste |

Reintentar (de cualquier tarjeta) vuelve a pedir los tres recursos conservando los datos retenidos.

## 3. Flujos

1. Montaje: calcular semana → pedir en paralelo → validar → comparar `planId` → publicar.
2. `planId` discordante: abortar → reconsultar todo una vez → publicar o `conflict`.
3. Volver de registrar una comida o compra: remontaje o `visibilitychange` → refresco con datos visibles → nuevo resumen.
4. Cambio de usuario: los datos del anterior se ocultan en el mismo render; carga nueva.
5. 401/403: la sesión global navega a /login (o el access gate toma el control); el Inicio no muestra error ni Reintentar.

## 4. Textos visibles

Reutilizados (aprobados): todos los de NUT-95/NUT-94 y "X de Y marcados" / "Todavía no hay productos para marcar." (NUT-89).
Nuevos, pendientes de validación PO: "No pudimos cargar el avance de tus compras." (+ "Reintentar").

## 5. Criterios de aceptación → pruebas

| CA | Pruebas requeridas |
|---|---|
| 1 | El widget muestra exactamente `summary.adherencePercent` y contadores del contrato A; el acceso muestra exactamente `checkedItems`/`totalItems` del contrato C aunque los `items` no coincidan. |
| 2 | Remontar o volver a la pestaña vuelve a pedir y muestra el nuevo resumen; cambiar de usuario no muestra datos previos; respuesta de otra semana es error. |
| 3 | `planId` discordante → exactamente una reconsulta; si se resuelve, datos; si persiste, error recuperable en las tres tarjetas y Reintentar vuelve a pedir. |
| 4 | 404 del plan → "sin plan"; 500 del plan → error con Reintentar, nunca "sin plan". |
| 5 | Respuesta obsoleta/cancelada ignorada (y sin error), cancelación no pedida como error, StrictMode, aborto al desmontar, 401/403 (incluido el de access gate) sin error de tarjeta ni Reintentar, límite de 30 s al volver a la pestaña, fallo parcial de cada recurso con las otras tarjetas utilizables, conflicto persistente después de Reintentar. |

Más: validación de cada adaptador (formas, enums aislados: `status` desconocido solo, `mealType` desconocido solo, `timezone` distinto, `today` fuera de la semana), validación del plan (otra semana, comida mal formada), cambio de semana al volver a la pestaña o reintentar, semana/hoy en Buenos Aires en bordes (domingo 23:30 ART, lunes 00:30 ART con navegador en otra zona), fixtures de compras en desarrollo y centinela fuera del build.

## 6. Base de datos

Ninguna: sin cambios de schema, migraciones ni endpoints.

## 7. Diferencias con Stitch (validar con PO)

- El frame no muestra contador de compras ni aviso de error de compras en el acceso: agregados por CA1/regla 2.
- Errores, conflicto y "no disponible" por tarjeta no están en los frames (heredados de NUT-95/NUT-94).
- La foto de la siguiente comida aparece solo si la receta del plan trae imagen.

## 8. Pendientes escalados (fuera del alcance de NUT-96)

| # | Pendiente | Efecto actual | Dónde se resuelve |
|---|---|---|---|
| P1 | Access gate requerido a mitad de sesión. La verificación del access gate ocurre una sola vez al montar la app; un 403 `ACCESS_GATE_REQUIRED` posterior no vuelve a mostrar la pantalla del access gate. | El Inicio deja las tarjetas afectadas en "No disponible todavía", sin Reintentar, hasta que se recarga la página. | Componente de access gate (app shell), en un ticket aparte con su responsable. NUT-96 no lo modifica. |
