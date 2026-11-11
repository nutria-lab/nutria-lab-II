# NUT-99 — Mapa de requisitos y código

Este documento relaciona los requisitos del issue de cierre de compras y adherencia con la implementación que existe en la rama `fercesio11/nut-99-verificar-compras-y-registro-de-comidas-en`.

**Alcance de este documento:** inspección estática del código para preparar la revisión de la PR. No acredita por sí solo el recorrido integrado ni declara cerrado el issue. No se ejecutaron tests en esta pasada, de acuerdo con la instrucción de no hacerlos.

## Estado resumido

| Área | Estado en código | Evidencia pendiente para el cierre del issue |
| --- | --- | --- |
| Lista de compras | La página consume los endpoints reales; lectura, agregación y checks persistidos están implementados. | Recorrido con API/base de desarrollo, refresh, aislamiento de usuarios, regeneración y capturas integradas. |
| Adherencia | GET/PUT reales, persistencia, reglas de edición y controles conectados al plan están implementados. | Recorrido con API/base de desarrollo, reemplazo/regeneración y capturas integradas. |
| Persistencia | Modelos Prisma y migraciones aditivas están en el repositorio. | Confirmar revisión TL y aplicación/verificación sobre base de desarrollo; no se aplicaron migraciones en esta pasada. |
| Responsive, teclado y estados | Hay controles semánticos y estilos responsive en los componentes conectados. | La evidencia visual/teclado existente de NUT-102 es de un preview aislado con fixtures; no demuestra el flujo integrado de NUT-99. |
| Planificación | Se documenta abajo según el issue original. | La estimación, horas reales, handoff, estado de Linear y aprobaciones son datos de gestión, no verificables desde el código. |

## 1. Datos de planificación del issue

- Responsable: Fer Cesio (FE1).
- Estimación: **5 h / 5 puntos previstos**; no son horas registradas.
- Distribución: **5 h el jueves 05/11** para validación y correcciones concentradas en el cierre. Vencimiento de cierre: jueves **05/11/2026**, excepción explícita al miércoles habitual.
- Sprint 3: **15/10–11/11/2026**; semana del producto lunes–domingo y semana laboral jueves–miércoles. Capacidad bruta 72 h; presupuesto original 57 h + 15 h; estimaciones vigentes 60 h + 12 h de reserva (16,7%). El cambio de fecha no recupera por sí solo el 20% de contingencia.
- Máximo: 6 h por developer por semana. Las estimaciones son trabajo restante previsto, no horas trabajadas. No se registraron horas en esta pasada.
- Distribución del equipo: Frontend 1 Fer Cesio, Frontend 2 Majo y Backend Lara. El issue describe trabajo humano asistido por IA/MCP con revisión y pruebas incluidas; esta pasada documental no ejecutó pruebas ni equivale a esa revisión final.
- Sólo vencimientos de la semana vigente pasan a Todo; los futuros permanecen en Backlog. Este documento no modifica el estado del issue.
- Dependencias declaradas: NUT-89, NUT-90 y NUT-93 entregadas/probadas como máximo el miércoles 04/11; handoff con versión probada y fixtures. Las 5 h del jueves forman parte de la capacidad semanal, no son horas extra. NUT-88 y NUT-91 coordinan las migraciones aditivas, sin modificar migraciones ya aplicadas. NUT-98, NUT-99 y NUT-100 se ejecutan en paralelo sobre la versión integrada previa y no forman una cadena de bloqueo entre sí.
- Si falta un prerrequisito, falla una validación crítica o se necesita una entrega cruzada, el issue pide escalar el riesgo al PM; la fecha no elimina criterios de aceptación.

Fuente de planificación: [documento Sprint 3 — capacidad y distribución semanal](https://linear.app/nutria-lab2/document/sprint-3-capacidad-y-distribucion-semanal-de05ffa684f5).

## 2. Convenciones comunes y seguridad

| Requisito | Implementación |
| --- | --- |
| Autenticación por la cookie de sesión actual | Los controladores de compras y adherencia usan `JwtAuthGuard`; el cliente web usa `apiClient` con `withCredentials: true`. [`shopping-list.controller.ts`](../apps/api/src/modules/shopping-list/shopping-list.controller.ts#L8), [`adherence.controller.ts`](../apps/api/src/modules/adherence/adherence.controller.ts#L7), [`apiClient.ts`](../apps/web/src/services/apiClient.ts#L28). |
| El servidor determina el usuario; ningún endpoint nuevo acepta `userId` del cliente | Ambos controladores obtienen `request.user.sub` y pasan ese ID al servicio. Los DTO de escritura sólo reciben los campos del contrato. [`shopping-list.controller.ts`](../apps/api/src/modules/shopping-list/shopping-list.controller.ts#L13), [`adherence.controller.ts`](../apps/api/src/modules/adherence/adherence.controller.ts#L12), [`shopping-list-item-check.dto.ts`](../apps/api/src/modules/shopping-list/dto/shopping-list-item-check.dto.ts#L17), [`set-meal-status.dto.ts`](../apps/api/src/modules/adherence/dto/set-meal-status.dto.ts#L18). |
| `weekStart` real, lunes, `YYYY-MM-DD`, sin convertir fecha calendario por zona del navegador | Un validador común comprueba los componentes y el día lunes mediante aritmética UTC; ambos DTO lo usan. La página de compras conserva la fecha en la URL y calcula su semana por Buenos Aires. [`calendar-monday.validator.ts`](../apps/api/src/utils/calendar-monday.validator.ts#L9), [`shopping-list-query.dto.ts`](../apps/api/src/modules/shopping-list/dto/shopping-list-query.dto.ts#L3), [`adherence-week-query.dto.ts`](../apps/api/src/modules/adherence/dto/adherence-week-query.dto.ts#L3), [`utils.ts`](../apps/web/src/modules/shopping-list/utils.ts#L3). |
| Rechazo de campos desconocidos y DTO inválidos | `ValidationPipe` global tiene `whitelist` y `forbidNonWhitelisted`; los DTO validan UUID, timestamp ISO UTC y tipos/enum. [`main.ts`](../apps/api/src/main.ts#L13), [`shopping-list-item-check.dto.ts`](../apps/api/src/modules/shopping-list/dto/shopping-list-item-check.dto.ts#L17), [`set-meal-status.dto.ts`](../apps/api/src/modules/adherence/dto/set-meal-status.dto.ts#L18). |
| Fechas de auditoría/tokens en ISO UTC; calendario como `YYYY-MM-DD` | Las respuestas serializan `updatedAt` y `mealUpdatedAt` con `toISOString()`; las fechas civiles de adherencia se derivan de las fechas de los días del plan. [`shopping-list.transform.ts`](../apps/api/src/modules/shopping-list/shopping-list.transform.ts#L200), [`adherence.transform.ts`](../apps/api/src/modules/adherence/adherence.transform.ts#L26). |
| Zona de Buenos Aires para “hoy” y límites de futuro | El servidor obtiene la fecha civil con `Intl.DateTimeFormat` en `America/Argentina/Buenos_Aires` y la devuelve en la respuesta de adherencia. [`adherence.repository.ts`](../apps/api/src/modules/adherence/adherence.repository.ts#L30), [`adherence.transform.ts`](../apps/api/src/modules/adherence/adherence.transform.ts#L94). |
| No filtrar existencia de recursos de otro usuario; sesión ausente 401 | Las rutas están protegidas por JWT. Las consultas/escrituras filtran por el `userId` autenticado y usan errores 404 para recursos ajenos/inexistentes. [`shopping-list.repository.ts`](../apps/api/src/modules/shopping-list/shopping-list.repository.ts#L49), [`adherence.repository.ts`](../apps/api/src/modules/adherence/adherence.repository.ts#L48), [`shopping-list.errors.ts`](../apps/api/src/modules/shopping-list/shopping-list.errors.ts#L6), [`adherence.errors.ts`](../apps/api/src/modules/adherence/adherence.errors.ts#L8). |
| Errores de conflicto con código estable; recargar ante datos obsoletos | Las excepciones de dominio incluyen `statusCode`, `error`, `message` y `code`. La UI de compras muestra acción de recarga; adherencia recarga plan/datos al detectar `ADHERENCE_STALE` y no reenvía automáticamente la intención. [`shopping-list.errors.ts`](../apps/api/src/modules/shopping-list/shopping-list.errors.ts#L14), [`adherence.errors.ts`](../apps/api/src/modules/adherence/adherence.errors.ts#L16), [`useShoppingList.ts`](../apps/web/src/modules/shopping-list/hooks/useShoppingList.ts#L243), [`useAdherence.ts`](../apps/web/src/modules/adherence/hooks/useAdherence.ts#L192). |
| Mutaciones limitadas a la versión actual del plan | Los repositorios buscan/validan `isCurrent` dentro de la escritura transaccional. Leer una versión vieja no habilita editarla. [`shopping-list.repository.ts`](../apps/api/src/modules/shopping-list/shopping-list.repository.ts#L72), [`adherence.repository.ts`](../apps/api/src/modules/adherence/adherence.repository.ts#L79). |

Los errores de dominio nuevos tienen forma estable. La política general de errores internos `500` no se cambia en estos módulos; esta revisión estática no sustituye la comprobación de respuestas del servidor en el recorrido integrado.

## 3. Contrato C — lista de compras

### API, agregación y warnings

| Requisito | Implementación |
| --- | --- |
| `GET /shopping-list?weekStart=...`, metadata del plan, items, fuentes, resumen y warnings | `ShoppingListController` expone GET y delega al servicio; `transformShoppingList` forma la respuesta. [`shopping-list.controller.ts`](../apps/api/src/modules/shopping-list/shopping-list.controller.ts#L13), [`shopping-list.service.ts`](../apps/api/src/modules/shopping-list/shopping-list.service.ts#L11), [`shopping-list.types.ts`](../apps/api/src/modules/shopping-list/shopping-list.types.ts#L1), [`shopping-list.transform.ts`](../apps/api/src/modules/shopping-list/shopping-list.transform.ts#L110). |
| Sin plan: respuesta vacía; plan sin ingredientes: items vacíos; comida sin receta: warning | La transformación contempla plan `null`, emite `MISSING_RECIPE` y conserva la respuesta con items/warnings. [`shopping-list.transform.ts`](../apps/api/src/modules/shopping-list/shopping-list.transform.ts#L110). |
| Cada aparición de receta cuenta una vez; sin multiplicador de porciones | Las fuentes se recorren por cada comida planificada; las cantidades se agregan desde los ingredientes guardados, sin aplicar multiplicador de comensales. [`shopping-list.transform.ts`](../apps/api/src/modules/shopping-list/shopping-list.transform.ts#L125). |
| Normalizar nombre con NFKC, trim, espacios colapsados y minúsculas; conservar acentos/diferencias semánticas | `normalizeText` aplica exactamente esas transformaciones. No hay fusión por IA ni tabla de sinónimos. [`shopping-list.transform.ts`](../apps/api/src/modules/shopping-list/shopping-list.transform.ts#L22). |
| Tabla cerrada de unidades; sin convertir `g`↔`kg` ni volumen↔masa | `UNIT_ALIASES` sólo canoniza g, kg, ml, l y unidad(es) con sus aliases inequívocos. No realiza conversiones. [`shopping-list.transform.ts`](../apps/api/src/modules/shopping-list/shopping-list.transform.ts#L11). |
| Sumar sólo nombre y unidad canónicos idénticos; cantidades finitas positivas; máximo 3 decimales | La agregación separa nombre/unidad y usa acumulación decimal entera para redondear al presentar. [`shopping-list.transform.ts`](../apps/api/src/modules/shopping-list/shopping-list.transform.ts#L37), [`shopping-list.transform.ts`](../apps/api/src/modules/shopping-list/shopping-list.transform.ts#L54), [`shopping-list.transform.ts`](../apps/api/src/modules/shopping-list/shopping-list.transform.ts#L141). |
| La petición posterior de producto aclara que nombres repetidos con cantidades válidas se muestran una vez y con el total, también cuando la unidad normalizada visible es `null`. Cantidad inválida sigue separada por origen y con warning; sin nombre válido se omite sólo esa entrada. | La transformación agrupa por nombre y unidad normalizados (incluyendo `null`), suma las cantidades positivas y conserva la firma de fuentes para el key/check. [`shopping-list.transform.ts`](../apps/api/src/modules/shopping-list/shopping-list.transform.ts#L146), [`shopping-list.transform.ts`](../apps/api/src/modules/shopping-list/shopping-list.transform.ts#L166). |
| Orden estable por nombre normalizado, unidad y key; no añadir categorías | Se ordenan las entradas transformadas; los tipos de respuesta no agregan categorías de ingredientes. [`shopping-list.transform.ts`](../apps/api/src/modules/shopping-list/shopping-list.transform.ts#L193), [`shopping-list.types.ts`](../apps/api/src/modules/shopping-list/shopping-list.types.ts#L15). |

### Checks persistidos y concurrencia

| Requisito | Implementación |
| --- | --- |
| Key opaca ligada a plan y contenido/fuentes; cambiar contenido invalida el check | `createItem` genera SHA-256 desde JSON canónico de plan, nombre, unidad y fuentes ordenadas. En cada lectura se buscan checks por las keys recién calculadas. [`shopping-list.transform.ts`](../apps/api/src/modules/shopping-list/shopping-list.transform.ts#L91), [`shopping-list.repository.ts`](../apps/api/src/modules/shopping-list/shopping-list.repository.ts#L49). |
| `PATCH /shopping-list/items/:itemKey` es un set idempotente, no un toggle | El DTO exige `checked: boolean`; el repositorio hace `upsert` del valor solicitado y devuelve el estado establecido. [`shopping-list.controller.ts`](../apps/api/src/modules/shopping-list/shopping-list.controller.ts#L20), [`shopping-list-item-check.dto.ts`](../apps/api/src/modules/shopping-list/dto/shopping-list-item-check.dto.ts#L17), [`shopping-list.repository.ts`](../apps/api/src/modules/shopping-list/shopping-list.repository.ts#L115). |
| Validar `planId`, timestamp original ISO UTC, plan actual y key en la transacción de escritura | El repositorio bloquea el plan con `FOR UPDATE`, compara el `updatedAt` exacto, vuelve a generar las keys actuales y rechaza tokens/keys obsoletos antes del `upsert`. [`shopping-list-item-check.dto.ts`](../apps/api/src/modules/shopping-list/dto/shopping-list-item-check.dto.ts#L4), [`shopping-list.repository.ts`](../apps/api/src/modules/shopping-list/shopping-list.repository.ts#L72). |
| Item ausente/ajeno 404; versión/firma obsoleta 409 `SHOPPING_LIST_STALE` | Errores de dominio separados con códigos estables. El hook trata el 409 como conflicto y exige recargar antes de seguir. [`shopping-list.errors.ts`](../apps/api/src/modules/shopping-list/shopping-list.errors.ts#L3), [`useShoppingList.ts`](../apps/web/src/modules/shopping-list/hooks/useShoppingList.ts#L243). |
| Persistir sólo checks; unique `(userId, planId, itemKey)`, índice por plan y cascade; lectura sin escrituras | Modelo y migración crean `ShoppingItemCheck`, su unicidad/índice y FKs con cascade. El GET consulta checks existentes; no crea ni actualiza filas. [`shoppingItemCheck.prisma`](../apps/api/prisma/models/shoppingItemCheck.prisma#L1), [migración de checks](../apps/api/prisma/migrations/20261022040000_add_shopping_item_checks/migration.sql#L2), [`shopping-list.repository.ts`](../apps/api/src/modules/shopping-list/shopping-list.repository.ts#L49). |

## 4. Contrato A — adherencia

### Lectura y reglas de cálculo

| Requisito | Implementación |
| --- | --- |
| `GET /adherence?weekStart=...` con timezone, hoy, plan, días, comidas y resumen | El controlador llama a `getForWeek`; el transformador construye el contrato y serializa tokens. [`adherence.controller.ts`](../apps/api/src/modules/adherence/adherence.controller.ts#L12), [`adherence.service.ts`](../apps/api/src/modules/adherence/adherence.service.ts#L14), [`adherence.transform.ts`](../apps/api/src/modules/adherence/adherence.transform.ts#L34), [`types.ts`](../apps/web/src/modules/adherence/types.ts#L2). |
| Sin plan: días vacíos y contadores cero; porcentaje `null` si no hay comidas | El resumen inicia con contadores cero y `calculateAdherencePercent` devuelve `null` cuando el denominador es cero. [`adherence.transform.ts`](../apps/api/src/modules/adherence/adherence.transform.ts#L11), [`adherence.transform.ts`](../apps/api/src/modules/adherence/adherence.transform.ts#L18). |
| Porcentaje = completadas/planificadas, redondeado a 1 decimal; denominador incluye futuras | Se cuenta cada comida planificada del día y se calcula tanto por día como para toda la semana. No se excluyen comidas futuras del total planificado. [`adherence.transform.ts`](../apps/api/src/modules/adherence/adherence.transform.ts#L11), [`adherence.transform.ts`](../apps/api/src/modules/adherence/adherence.transform.ts#L70), [`adherence.transform.ts`](../apps/api/src/modules/adherence/adherence.transform.ts#L81). |
| Diferenciar `NOT_LOGGED`, `SKIPPED`, `COMPLETED`; no inferir por visitas/objetivos | La lectura deriva el estado sólo del registro de `MealCompletion` y su snapshot coincidente. [`effective-meal-status.ts`](../apps/api/src/modules/adherence/effective-meal-status.ts#L22). |
| `canEdit` autoritativo del servidor: sólo hoy/pasado en plan actual | El transformador calcula `canEdit` comparando la fecha civil de la comida con `today`; la escritura además valida el plan actual. [`adherence.transform.ts`](../apps/api/src/modules/adherence/adherence.transform.ts#L56), [`adherence.repository.ts`](../apps/api/src/modules/adherence/adherence.repository.ts#L116). |

### Escritura, snapshot y persistencia

| Requisito | Implementación |
| --- | --- |
| `PUT /adherence/meals/:plannedMealId`, con `planId`, `mealUpdatedAt` exacto y status | Ruta, DTO con validación del timestamp ISO UTC y enum de estados. [`adherence.controller.ts`](../apps/api/src/modules/adherence/adherence.controller.ts#L19), [`set-meal-status.dto.ts`](../apps/api/src/modules/adherence/dto/set-meal-status.dto.ts#L18). |
| Misma marca idempotente; `NOT_LOGGED` deshace; `SKIPPED` es explícito | El cliente envía el nuevo estado elegido y el repositorio realiza `upsert`; si ya existe el mismo estado evita cambios redundantes. [`useAdherence.ts`](../apps/web/src/modules/adherence/hooks/useAdherence.ts#L133), [`adherence.repository.ts`](../apps/api/src/modules/adherence/adherence.repository.ts#L129). |
| Comida futura: 400 `MEAL_IN_FUTURE`; plan/comida obsoletos: 409 `ADHERENCE_STALE`; ajena/inexistente: 404 | El repositorio verifica fecha, propiedad, `isCurrent`, plan y timestamp; errores incluyen códigos estables. [`adherence.repository.ts`](../apps/api/src/modules/adherence/adherence.repository.ts#L79), [`adherence.errors.ts`](../apps/api/src/modules/adherence/adherence.errors.ts#L4). |
| Escrituras serializadas con reemplazo/regeneración; snapshot distinto devuelve `NOT_LOGGED`; nuevo plan no hereda marcas | La escritura bloquea plan y comida; guarda `recipeIdSnapshot` y `mealUpdatedAtSnapshot`. El estado leído vuelve a `NOT_LOGGED` si alguno difiere. La regeneración crea otro plan y otra identidad de comidas. [`adherence.repository.ts`](../apps/api/src/modules/adherence/adherence.repository.ts#L96), [`effective-meal-status.ts`](../apps/api/src/modules/adherence/effective-meal-status.ts#L15), [`plans.repository.ts`](../apps/api/src/modules/plans/plans.repository.ts#L463). |
| Reemplazo de una comida comparte el protocolo de concurrencia (NUT-91) | `replaceMealTransaction` actualiza condicionalmente el plan actual con su token y comprueba el timestamp de la comida. [`plans.repository.ts`](../apps/api/src/modules/plans/plans.repository.ts#L659). |
| Persistencia `MealCompletion`, única por planned meal, FK a usuario/comida con cascade, sin historial de eventos | El modelo contiene estado/snapshots y relaciones; la migración crea el enum, tabla, unicidad, índice y FKs cascade. [`mealCompletion.prisma`](../apps/api/prisma/models/mealCompletion.prisma#L1), [migración de adherencia](../apps/api/prisma/migrations/20261022050000_add_meal_completions/migration.sql#L19). |

## 5. Integración web y aceptación funcional

| Criterio de aceptación | Dónde está conectado | Estado de evidencia |
| --- | --- | --- |
| Compras usa API real y semana en URL; cambiar semana/sesión descarta snapshot anterior | [`ShoppingListPage.tsx`](../apps/web/src/modules/shopping-list/pages/ShoppingListPage.tsx#L13), [`shoppingListService.ts`](../apps/web/src/services/shoppingListService.ts#L79), [`useShoppingList.ts`](../apps/web/src/modules/shopping-list/hooks/useShoppingList.ts#L73). Al cambiar contexto, `confirmed` y la respuesta anterior se limpian antes de cargar; `hasSnapshot` sólo se aplica al snapshot confirmado de ese contexto. | Código presente; el escenario de semana anterior y cambio de sesión no se reejecutó manualmente en esta pasada. |
| Checks se guardan en backend; summary recalculado desde items | [`useShoppingList.ts`](../apps/web/src/modules/shopping-list/hooks/useShoppingList.ts#L172), [`shoppingListService.ts`](../apps/web/src/services/shoppingListService.ts#L95). | Código presente; persistencia tras refresh requiere API/base de desarrollo. |
| Estados de carga, vacío, warning, error, sesión vencida y conflicto | [`ShoppingListView.tsx`](../apps/web/src/modules/shopping-list/components/ShoppingListView.tsx#L71), [`ShoppingListItem.tsx`](../apps/web/src/modules/shopping-list/components/ShoppingListItem.tsx#L16). | Estados representados; no se capturaron en el flujo integrado de esta branch. |
| Adherencia conectada al plan con API GET/PUT real | [`MealPlanPage.tsx`](../apps/web/src/modules/meal-plan/pages/MealPlanPage.tsx#L87), [`useAdherence.ts`](../apps/web/src/modules/adherence/hooks/useAdherence.ts#L34), [`adherenceService.ts`](../apps/web/src/services/adherenceService.ts#L11), [`MealCard.tsx`](../apps/web/src/modules/meal-plan/components/MealCard.tsx#L109). | Integración presente; recorrido con sesión/API real pendiente de evidencia. |
| Recargar después de reemplazar/regenerar; no repetir automáticamente una intención obsoleta | [`MealPlanPage.tsx`](../apps/web/src/modules/meal-plan/pages/MealPlanPage.tsx#L128), [`MealPlanPage.tsx`](../apps/web/src/modules/meal-plan/pages/MealPlanPage.tsx#L163), [`useAdherence.ts`](../apps/web/src/modules/adherence/hooks/useAdherence.ts#L192), [`useShoppingList.ts`](../apps/web/src/modules/shopping-list/hooks/useShoppingList.ts#L243). | La ruta está en código; falta evidencia de regresión ejecutada contra la integración actual. |
| Teclado, foco, nombres accesibles y anuncios de estado | Checkbox de compras y selector nativo de adherencia incluyen nombres/estados accesibles y estilos `focus-visible`. [`ShoppingListItem.tsx`](../apps/web/src/modules/shopping-list/components/ShoppingListItem.tsx#L32), [`MealAdherenceControl.tsx`](../apps/web/src/modules/adherence/components/MealAdherenceControl.tsx#L43). | Evidencia histórica de NUT-102 cubre el control aislado/preview; no equivale a una comprobación manual del flujo integrado de NUT-99. |
| Mobile, tablet y desktop, sin rediseño adicional | Los componentes usan layout responsive y conservan el lenguaje visual Terra. | Deben adjuntarse capturas actuales de compras y plan en los tres tamaños; no se generaron capturas en esta pasada. |

La implementación de compras no es sólo fixtures: `ShoppingListPage` llama a `useShoppingList`, el hook invoca `shoppingListService`, y el backend expone GET/PATCH con persistencia. La implementación de adherencia también está conectada al API y a las tarjetas del plan. Los fixtures se conservan para previews/pruebas, pero no son el origen de datos de estas páginas integradas.

## 6. Referencias visuales, revisiones y datos que no viven en el código

El issue exige referencias de Compras desktop/móvil y Plan desktop/móvil, además de aprobación PO para estados nuevos no representados. Los cuatro frames fueron localizados en el proyecto vigente y registrados en [`management/links.md`](../management/links.md); esta mejora de compras conserva el alcance Terra y se guía por los frames de Lista de compras. La aprobación PO de estados nuevos no representados sigue siendo una decisión aparte. Las capturas de [`NUT-102`](../.plans/nut-102-adherence-controls/evidence.md) son del componente/preview con fixtures y se citan sólo como evidencia histórica del control aislado.

La coordinación de capacidad, el handoff de NUT-89/NUT-90/NUT-93, la aprobación TL de migraciones, la verificación sobre base de desarrollo y el estado de Linear son tareas de gestión/revisión. No se modificaron ni se dan por completadas por este documento. Las migraciones citadas están en el repositorio; su aplicación en una base no se infiere de su presencia.

## 7. Suites existentes y límites de esta evidencia

Hay suites dedicadas a transformación, contrato HTTP, persistencia y hooks web, entre ellas:

- Compras API: [`shopping-list.transform.spec.ts`](../apps/api/src/modules/shopping-list/tests/shopping-list.transform.spec.ts), [`shopping-list.http.spec.ts`](../apps/api/src/modules/shopping-list/tests/shopping-list.http.spec.ts), [`shopping-list.persistence.integration.spec.ts`](../apps/api/src/modules/shopping-list/tests/shopping-list.persistence.integration.spec.ts).
- Compras web: [`useShoppingList.test.tsx`](../apps/web/src/modules/shopping-list/hooks/tests/useShoppingList.test.tsx), [`shoppingListService.test.ts`](../apps/web/src/services/tests/shoppingListService.test.ts), [`ShoppingListPage.test.tsx`](../apps/web/src/modules/shopping-list/pages/tests/ShoppingListPage.test.tsx).
- Adherencia API: [`adherence.transform.spec.ts`](../apps/api/src/modules/adherence/tests/adherence.transform.spec.ts), [`adherence.http.spec.ts`](../apps/api/src/modules/adherence/tests/adherence.http.spec.ts), [`adherence.persistence.integration.spec.ts`](../apps/api/src/modules/adherence/tests/adherence.persistence.integration.spec.ts).
- Adherencia web: [`useAdherence.test.tsx`](../apps/web/src/modules/adherence/hooks/tests/useAdherence.test.tsx), [`MealPlanPage.test.tsx`](../apps/web/src/modules/meal-plan/pages/tests/MealPlanPage.test.tsx).

**No se ejecutaron estas suites ni se corrió build en esta pasada**, por la instrucción explícita del usuario. Los resultados escritos en evidencias anteriores pertenecen a sus fechas/alcances originales; no se presentan aquí como resultados nuevos ni como verificación del recorrido integrado actual.

## 8. Pendientes para poder afirmar cierre completo

1. Correr la validación integrada aprobada por el equipo: compras y adherencia en mobile/desktop, refresh, 401, fallo de red y 409; teclado/foco; evidencia de estados críticos; regresión tras reemplazo y regeneración.
2. Verificar los dos modelos/migraciones en la base de desarrollo después de la revisión TL, sin modificar migraciones ya aplicadas.
3. Adjuntar evidencia visual actual de compras y plan comparada con los frames ya registrados, y obtener aprobación PO para estados no representados.
4. Si aparece falta de prerrequisito o defecto cruzado, escalar según el issue; no omitir pruebas para conservar la fecha.

Hasta completar esos puntos, la conclusión correcta es **“implementación localizada en código; cierre integrado aún requiere evidencia”**, no “issue terminado”.
