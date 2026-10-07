# NUT-78 — Diseño: regenerar la semana como una nueva versión del plan

## 1. Contexto y alcance

**Objetivo.** Pedir una propuesta completa nueva para una semana que ya tiene plan, conservando la versión anterior para trazabilidad, sin confundir regeneración con la generación inicial idempotente (`POST /meal-plans/generate`, que devuelve el plan existente).

**Contexto verificado en el código** (rama `nut-78`, sobre `5936424` = NUT-74 con ajustes de revisión).
- Versionado de NUT-75: `MealPlan.version`, `isCurrent`, `supersedesId`, y el índice único parcial `meal_plans_user_week_current_key (userId, startDate) WHERE isCurrent = true` (una sola versión current por semana). **No hace falta migración.**
- `updatePlanTransaction` (lo usa `PUT /meal-plans`) ya hace el *supersede* en una transacción: marca la current `isCurrent=false`, crea la nueva con `version + 1` y `supersedesId`, traduce `P2002` a 409 y pasa el run a `SUCCEEDED`.
- `GET /meal-plans/current` ya filtra `isCurrent = true`.
- De NUT-74: validador determinístico, reuso de duplicados exactos (`DUPLICATE_RECIPE` + `reuseRecipeId`), `validationSnapshot` en la transacción, 503 de proveedor y TTL de `PENDING`.
- De NUT-77: idempotencia por `Idempotency-Key`, convención `uuidOr404` y guard JWT por cookie.
- **NUT-76 no existe todavía.** NUT-78 se entrega antes; acá se implementa sólo el mínimo de NUT-76 que NUT-78 necesita (§6).

**Fuera de alcance (del ticket):** historial visible de versiones, rollback de UI, shopping list, UI de confirmación.

## 2. Contrato

```
POST /meal-plans/:planId/regenerate
Idempotency-Key: <uuid>
{ "reason": "USER_REQUESTED" }
```

- `reason`: enum controlado `RegenerationReason` (sólo `USER_REQUESTED` en este sprint). Enum de TypeScript, no de Prisma (no se persiste como columna; va en el `requestSnapshot`).
- **201** con el `MealPlan` nuevo completo (días, comidas y recetas; imágenes públicas sin metadata de tracking): mismo `userId` y semana, `id` nuevo, `version = anterior + 1`, `isCurrent = true`, `supersedesId = anterior.id`, `generationRunId` nuevo.

| Código | Cuándo |
|---|---|
| 400 | `reason` inválido; `Idempotency-Key` ausente o no UUID; usuario sin perfil nutricional |
| 403 | el plan es de otro usuario |
| 404 | el plan no existe, o `planId` no es UUID |
| 409 | el plan no es la versión current; otra regeneración ganó (concurrencia); la misma key con otro pedido o todavía en curso |
| 422 | la propuesta no pasa el validador (códigos de NUT-74) o no es diferente tras 2 intentos (`NO_DIFFERENT_PROPOSAL`) |
| 503 | proveedor de IA caído o timeout |

**Desvíos documentados del ticket:**
- **"400 plan inválido" → 404.** Un `planId` que no es UUID no puede existir: 404, por la convención `uuidOr404` del proyecto (NUT-77). El 400 queda para `reason`, `Idempotency-Key` y falta de perfil.
- **`Authorization: Bearer`.** El guard JWT del proyecto sólo lee la cookie `token`; se usa el mismo guard que el resto de `/meal-plans` (misma discrepancia que NUT-77).

## 3. Decisiones

**D1 — Composición detrás de una interfaz.** `composeWeeklyProposal(input) → propuesta validada` (días listos para persistir, con `reuseRecipeId` donde corresponde, más el resumen de validación). La implementación de hoy es la generación semanal con Gemini validada por NUT-74 (la misma que usa `POST /generate`, extraída de `PlansService` para no duplicarla). NUT-76 puede reemplazar la implementación sin tocar el flujo de regeneración ni el de generación inicial.

**D2 — `MEAL_PLAN_REGENERATION` compartido con el `PUT`.** `PUT /meal-plans` (edición manual) ya usa `kind = MEAL_PLAN_REGENERATION`; se mantiene. Las dos operaciones no chocan: el hash de idempotencia de la regeneración se arma con la `Idempotency-Key` y el del `PUT` con el contenido de los días. Ticket aparte propuesto: `MEAL_PLAN_EDIT` para el `PUT` (requiere migración del enum `GenerationKind`).

**D3 — Propuesta "materialmente nueva".** Se compara la propuesta con la versión anterior por franja: día + `mealType` (+ orden dentro del día si hay más de una comida del mismo tipo), con la huella de NUT-72 (título + nombres de ingredientes normalizados). Basta con que **una** franja cambie (o que aparezca/desaparezca una franja). Si ninguna cambió, se genera una vez más; si sigue igual, **422 `NO_DIFFERENT_PROPOSAL`** (run `REJECTED`, con snapshot y log). **Máximo 2 generaciones.** No se excluyen sistemáticamente las recetas anteriores: repetir comidas está bien mientras al menos una cambie. Un rechazo del validador corta en el primer intento (no se reintenta).
- **Tiempo:** en el peor caso son 2 llamadas a Gemini (hasta 15 s cada una) más la búsqueda de imágenes: **la request puede superar los 30 s.**

**D4 — Idempotencia.** Como NUT-77: `idempotencyKeyHash = sha256({ userId, kind, idempotencyKey })`; `requestSnapshot = { kind, planId, reason, weekStart, promptVersion, schemaVersion }`.
- misma key + mismo snapshot + run `SUCCEEDED` → **la misma versión creada por ese run** (se busca por `generationRunId`), aunque después haya sido reemplazada por otra regeneración;
- misma key + otro snapshot (por ejemplo, otro `planId`) → 409;
- misma key con el run todavía `PENDING` → 409; si el `PENDING` es más viejo que el TTL (NUT-74 D12) → `EXPIRED` y se regenera de cero.

**D5 — Transacción única (extiende `updatePlanTransaction`).** En vez de duplicar la lógica, se extiende la transacción que ya usa el `PUT`:
1. `updateMany({ id: planId, userId, isCurrent: true, updatedAt: <leído> } → isCurrent: false)`; si afecta **0 filas** → 409 (otra regeneración o edición ganó, el plan dejó de ser current, o cambió desde que se leyó, por ejemplo por un reemplazo de comida de NUT-77: mismo control optimista que NUT-77).
2. Crear la versión nueva (`version + 1`, `supersedesId`, `generationRunId`); un `P2002` del índice parcial → 409.
3. Crear días y comidas; las comidas con `reuseRecipeId` apuntan a la receta existente (sin `recipe.create`).
4. Run `PENDING → SUCCEEDED` con `outputSnapshot` y el `validationSnapshot` de NUT-74.
5. Si cualquier paso falla, Prisma revierte todo: la anterior sigue current y no quedan planes ni recetas parciales.
- El `PUT` pasa a usar la misma variante condicional (`updateMany` sobre la current que leyó) en vez de `findFirst` + `update`: mismo resultado, pero una edición concurrente da 409 limpio en vez de depender sólo del `P2002`. El `recipeOrigin` sigue siendo `MANUAL` para el `PUT` y pasa a ser `AI` para la regeneración.
- Imágenes: se buscan antes de la transacción y el uso se registra después del commit (NUT-83), como en la generación inicial.

**D6 — Orden de validaciones.** dueño (404/403) → perfil (400) → idempotencia (409 / replay) → plan current (409) → composición (503/422) → diferencia (422) → imágenes → transacción (409 de concurrencia).

## 4. Flujo

1. Controller: `planId` UUID (si no, 404), `Idempotency-Key` UUID (si no, 400), body `RegenerateMealPlanDto` (400 por `ValidationPipe`).
2. Plan inexistente → 404; de otro usuario → 403; usuario sin perfil → 400.
3. `createOrRecoverGenerationRun` (`MEAL_PLAN_REGENERATION`), con TTL de `PENDING` y replay idempotente (D4).
4. Plan no current → run `REJECTED` (`PLAN_NOT_CURRENT`) y 409.
5. `composeWeeklyProposal` → 503 (run `FAILED`) o 422 (run `REJECTED` con snapshot de NUT-74).
6. Comparación con la versión anterior (D3); hasta 2 intentos; si no difiere → 422 `NO_DIFFERENT_PROPOSAL`.
7. Imágenes (Unsplash) para las recetas nuevas.
8. Transacción única (D5).
9. Tracking de imágenes después del commit; 201 con el plan nuevo completo.
- Cualquier error inesperado después de crear el run → `FAILED UNEXPECTED_ERROR` (nunca `PENDING` para siempre).

## 5. Historias y criterios de aceptación

- **AC1** Regenerar crea una versión nueva con `version + 1`, `supersedesId = anterior.id`, `isCurrent = true` y un `generationRunId` nuevo; responde 201 con el plan completo.
- **AC2** La versión anterior queda `isCurrent = false` y no se modifica ni se borra (ni sus días, comidas ni recetas).
- **AC3** `GET /meal-plans/current?weekStart=…` devuelve sólo la versión nueva.
- **AC4** La misma `Idempotency-Key` con el mismo pedido devuelve la misma versión nueva (aun si después fue reemplazada); con otro pedido (otro plan) → 409.
- **AC5** Dos regeneraciones concurrentes sobre el mismo plan: una gana; la otra recibe 409 (`updateMany` con 0 filas o `P2002`).
- **AC6** Un fallo en cualquier paso deja la anterior current y sin escrituras parciales.
- **AC7** La propuesta nueva difiere de la anterior en al menos una franja; si no se logra en 2 generaciones → 422 `NO_DIFFERENT_PROPOSAL`.
- **AC8** Una comida que coincide con una receta existente (incluida una de la versión anterior) reutiliza ese `recipeId`, sin `recipe.create`.
- **AC9** 403, 404, 409 (plan no current), 400 (`reason`), 503 (proveedor) y 422 (validación).
- **AC10** Borrar la versión current no borra recetas (ni las que usa la versión anterior); la anterior queda intacta.

## 6. Mínimo de NUT-76 implementado acá

**a) Recetas reutilizadas sin duplicar.** Se reutiliza el mecanismo de NUT-74 tal cual: cada comida propuesta se valida contra las recetas del catálogo con el mismo título normalizado; si la huella coincide (`DUPLICATE_RECIPE`), la comida se persiste con `reuseRecipeId` y nunca se copia la receta.
- **Por qué las recetas de la versión anterior ya entran en la búsqueda sin nada extra:** son filas comunes de `recipes` (no hay recetas "privadas" de un plan), y la huella exacta incluye el título normalizado. Un duplicado exacto comparte, por definición, el título normalizado, así que la búsqueda por título (`findByNormalizedTitles`) siempre lo encuentra. Buscar por otros criterios sólo agregaría candidatos que nunca pueden ser duplicados exactos.
- Una receta anterior que hoy viola el perfil (si el perfil cambió) no se reutiliza (filtro de seguridad de NUT-74) y se crea una nueva.
- Test: una comida igual a una receta de la versión anterior → la versión nueva apunta al mismo `recipeId` y no hay `recipe.create` para esa comida.

**b) No borrar recetas compartidas — decisión: no borrar ninguna receta al borrar un plan.**
- Hoy `deletePlanTransaction` ya conserva las recetas que sigue usando otra `PlannedMeal` (borra el plan y después sólo las que quedaron sin referencias), así que "borrar la current no borra recetas de la anterior" ya se cumple.
- Pero sí borra una receta que sólo usaba ese plan aunque sea del catálogo o del seed, reutilizada por NUT-77, NUT-74 o esta regeneración. Con versiones y reuso eso destruye catálogo compartido, que es justamente lo que NUT-76 quiere construir.
- Se elige la opción más simple y segura: **`DELETE /meal-plans` no borra recetas**; sólo el plan (sus días y comidas caen por cascade). Las recetas generadas quedan en el catálogo compartido. Costo: recetas que quedan sin uso; si hace falta limpiarlas, será una tarea aparte con criterio explícito (por ejemplo, `origin = AI` y sin referencias después de N días).
- **Semántica de DELETE (no cambia):** borra **sólo la versión current** de la semana. Las versiones anteriores quedan con `isCurrent = false` y la semana se queda sin current (`GET current` → 404). Regenerar un plan borrado da 404. No rompe NUT-78, así que no se toca.
- **`POST /generate` después de un `DELETE` (verificado):**
  - *Numeración:* no choca. El índice único viejo `(userId, weekStart, version)` se eliminó en la migración `20260905140630`; hoy sólo existe el parcial `(userId, startDate) WHERE isCurrent = true`, y `checkPlanExists` mira sólo la current. El plan nuevo arranca en `version = 1` aunque existan versiones viejas: es sólo cosmético (sin `P2002` ni 500). Queda como ticket aparte.
  - *Bloqueo (previo, de NUT-75, no lo introduce NUT-78):* el hash de idempotencia de `/generate` es fijo por usuario + semana + versión de prompt, y el run original sigue `SUCCEEDED` (ocupa la clave). Después del `DELETE`, `/generate` recupera ese run, lo considera usable y responde **404 para siempre** en esa semana, sin llamar a Gemini (confirmado con un test temporal). Continuar la numeración no lo arregla. Decisión: ticket aparte con prioridad alta (§9).
- Tests: borrar la current no ejecuta `recipe.deleteMany`; la versión anterior y sus recetas quedan intactas.

## 6b. Notas de implementación

- **Composición:** `WeeklyProposalComposer` es una clase abstracta usada como token de Nest; hoy se registra `GeminiWeeklyProposalComposer`. Es una dependencia obligatoria de `PlansService` y de `MealPlanRegenerationService` (la misma instancia). La generación inicial no cambió de comportamiento: en sus tests sólo cambió el armado del servicio, ninguna aserción. La propuesta trae `dto` (para persistir, con `reuseRecipeId`), `comparableDays` (con la receta normalizada también de las comidas reutilizadas, para comparar) y el resumen de NUT-74.
- **Rechazo por propuesta igual:** `NO_DIFFERENT_PROPOSAL` se registra como los demás rechazos (run `REJECTED`, `validationSnapshot { stage: 'difference', codes: ['NO_DIFFERENT_PROPOSAL'] }` y log `recipe_validation_rejected`).
- **Códigos del run en la regeneración:** `PLAN_NOT_CURRENT` (409, `REJECTED`), `CONCURRENT_CONFLICT` (409 de la transacción, `FAILED`), `DOMAIN_TRANSACTION_FAILED` (otro error de la transacción, `FAILED`), `UNEXPECTED_ERROR` (cualquier error que no sea HTTP, `FAILED`); los de proveedor y validación los registra el compositor como en el plan semanal.
- **Transacción:** con versión esperada, si la current de la semana ya es otra o no existe (se borró durante la regeneración), 409 sin tocar nada; después, el `updateMany` condicional (con `updatedAt` en la regeneración; 0 filas → 409) y el `P2002` (→ 409). Los tres conflictos usan el mismo mensaje (`The meal plan changed; retry`). Sin versión esperada, si no hay current se mantiene el error previo.
- **El `PUT` también pasa la versión que leyó** (`expectedPlanId`), así una regeneración que termina mientras el `PUT` busca imágenes no queda pisada en silencio: 409.
- **`failRun` de la regeneración:** mismo orden de argumentos que el resto del módulo (`status, errorCode`) y, si no logra marcar el run, deja el log `generation_run_fail_persist_failed` (sin el mensaje del error). El catch de la regeneración siempre lo intenta, también ante un `HttpException`: sólo afecta runs todavía `PENDING`, así que no pisa el resultado que ya registró el compositor, y protege de una implementación futura del compositor (NUT-76) que no marque el run.
- **Relectura después del commit:** si la versión recién creada ya no existe (se borró en el medio), 409 explícito.
- **`DELETE`:** borra con `delete({ where: { id, userId, isCurrent: true } })`: un único `DELETE … WHERE` atómico que devuelve el mismo registro que antes. Si una regeneración reemplazó la current entretanto (o el plan no es del usuario), Prisma lanza `P2025` → 409, en vez de borrar una versión que ya es historia. Verificado contra Postgres real (2026-10-07).
- **Lecturas:** `findPlanWithMeals` ahora incluye las recetas de cada comida (la regeneración las compara; NUT-77 sólo recibe más datos). `findPlanByGenerationRunId` devuelve la versión creada por un run, sea o no la current.
- **Imágenes:** `resolveImagesOrDegrade` y `trackNewRecipeImages` se extrajeron de `PlansService` a un servicio chico, `RecipeImagesService` (sólo depende de Unsplash y del repositorio), que usan la generación, la edición y la regeneración. Las comidas reutilizadas no tienen receta, así que no se les busca foto.

## 6c. Prueba real contra Postgres (2026-10-06)

Base temporal `nutria_nut78_tmp` en el contenedor local `nutria-postgres` (Postgres 16), con todas las migraciones; repositorio, servicios y transacción reales; compositor falso en lugar de Gemini. La base y el script se borraron al terminar.

- **Concurrencia:** 5 rondas de dos regeneraciones simultáneas con distinta key sobre el mismo plan → las 5 dieron un 201 y un 409. Al final: una sola versión current, versiones 1..6 sin repetir, cada una con `supersedesId` a la anterior; 5 runs `SUCCEEDED` y 5 `FAILED / CONCURRENT_CONFLICT`.
- **Idempotencia:** la misma key devolvió la misma versión (mismo id y `version`) aunque después se regeneró otra vez; el replay no creó otra versión.
- **Rollback forzado** (FK inexistente en la última comida, dentro de la transacción): mismas cantidades antes y después (planes, días, comidas y recetas), la anterior siguió current y el run quedó `FAILED / DOMAIN_TRANSACTION_FAILED`.
- **DELETE de la current:** no se borró ninguna receta (incluida una compartida con la versión anterior); la anterior siguió existiendo con `isCurrent=false` y sus 14 comidas intactas.

**Segunda corrida (2026-10-07), con el código final después de la revisión** (misma base temporal y compositor falso):
- Concurrencia: otra vez 5 de 5 rondas con un 201 y un 409; una sola current, versiones 1..6 encadenadas.
- Idempotencia: la misma key devolvió la misma versión después de otra regeneración, sin crear versiones.
- Rollback forzado: mismas cantidades antes y después, la anterior siguió current, run `FAILED / DOMAIN_TRANSACTION_FAILED`.
- **Reemplazo de comida (NUT-77, con su transacción real) durante la regeneración:** la regeneración dio 409 por el chequeo de `updatedAt`, el reemplazo quedó guardado, la versión siguió current, no se creó ninguna versión ni receta y el run quedó `FAILED / CONCURRENT_CONFLICT`.
- `DELETE` con `{ id, userId, isCurrent: true }`: una versión no current, un plan de otro usuario o un id inexistente dan 409 sin borrar nada; la current se borra y devuelve el mismo registro que antes.

## 7. Cambios de comportamiento visibles (para el PR)

- **`DELETE /meal-plans` ya no borra recetas.** Sólo borra la versión current del plan (días y comidas por cascade). Antes borraba las recetas que no usaba ninguna otra comida, incluidas recetas del catálogo o del seed reutilizadas sólo por ese plan.
- **`DELETE /meal-plans` puede responder 409** si una regeneración reemplazó la current entre la lectura y el borrado (no se borra nada). La respuesta exitosa no cambia: sigue siendo el plan borrado.
- **`PUT /meal-plans` reemplaza sólo la versión current que leyó** (`expectedPlanId` + `updateMany` condicional). Si otra edición o una regeneración cambió la current entre la lectura y la transacción (incluido el tiempo de la búsqueda de imágenes), responde **409** en vez de pisarla. El resto del `PUT` no cambia (sigue con `kind = MEAL_PLAN_REGENERATION` y `recipeOrigin = MANUAL`).
- **Endpoint nuevo** `POST /meal-plans/:planId/regenerate` (201).
- **La generación inicial (`POST /generate`) no cambia:** sólo se extrae su composición a `composeWeeklyProposal`; sus tests existentes siguen sin modificarse.

## 8. Pendiente de NUT-76

- Componer primero desde el catálogo (NUT-72) y generar con IA sólo las comidas faltantes.
- Derivar los macros de la comida de la receta elegida del catálogo.
- El modo batch de NUT-73 (preview y confirmación) y la detección de duplicados dentro del lote.
- Cualquier exclusión o rotación de recetas entre versiones más allá de la regla de "al menos una comida distinta".

## 9. Tickets aparte (anotados, no se hacen acá)

- **[PRIORIDAD ALTA] Permisos sobre recetas** (el ticket de NUT-74, prioridad subida en la revisión de NUT-78): `Recipe` no tiene dueño y `PATCH`/`DELETE /recipes/:id` sólo exigen estar logueado. Con NUT-78 las versiones comparten recetas (reuso sin copiar), así que **la promesa de que la versión anterior no se modifica depende de que nadie edite ni borre esas recetas compartidas**: cualquier usuario logueado podría cambiar el contenido de la versión vieja de otro (o dejar comidas sin receta al borrarla). Propuesta mínima: restringir `PATCH`/`DELETE` de recetas referenciadas por algún plan o con `origin = AI`.
- **`MEAL_PLAN_EDIT`** para `PUT /meal-plans` (migración del enum `GenerationKind`), para no compartir kind con la regeneración. Incluir ahí la **idempotencia del `PUT`**: hoy su hash se arma sólo con el contenido de los días, así que repetir una edición idéntica después de una regeneración (para "deshacerla") recupera el run viejo y no hace nada. Agregar al `requestSnapshot` la versión que se reemplaza.
- **Refactor: helper común para runs** (NUT-77, NUT-78 y `/generate`): hoy cada servicio tiene su copia de "crear o recuperar el run + expirar el `PENDING` colgado", del replay idempotente y de `failRun`. Unificarlos en un helper de ciclo de vida del `GenerationRun`.
- **Versionado al borrar:** decidir si `DELETE` debe borrar todas las versiones de la semana o reactivar la anterior, y que un `/generate` posterior continúe la numeración (máxima versión de la semana + 1) en vez de volver a `version = 1`.
- **[PRIORIDAD ALTA] `/generate` bloqueado después de `DELETE`** (bug previo de NUT-75, decidido como ticket aparte el 2026-10-06): después de borrar el plan de una semana, `POST /generate` recupera el run idempotente `SUCCEEDED` de la primera generación y responde 404 para siempre en esa semana (hasta que cambie la versión del prompt), sin llamar a Gemini. Arreglo propuesto: liberar o ignorar el run `SUCCEEDED` cuya versión ya no existe, para que se pueda volver a generar la semana.
- **Limpieza de recetas huérfanas** con un criterio explícito, si el catálogo crece con recetas sin uso.
- **Tiempo de respuesta:** con 2 generaciones la request puede superar los 30 s; evaluar un flujo asíncrono si se vuelve un problema.
- **Detalles de la revisión (no bloqueantes):**
  - *Observabilidad:* registrar cuántas generaciones usó una regeneración (si la primera fue igual a la anterior y la segunda falló, hoy sólo queda registrado el segundo intento).
  - *Comida anterior sin receta:* si la receta de una comida anterior se borró (`SetNull`), esa franja siempre cuenta como distinta aunque la propuesta tenga el mismo título; se podría comparar por título cuando sólo un lado tiene receta.
  - *Cosméticos:* renombrar `SupersedeOptions`/`updatePlanTransaction` (hoy también lo usa la regeneración) y `deletePlanTransaction`; un provider por línea en `plans.module.ts`; que el `clone` del test de flujo reviva todas las fechas (`endDate`).

## 10. Rollout

- Sin migración.
- **Timeouts:** en el peor caso una regeneración tarda más de 30 s (2 generaciones con Gemini de hasta 15 s cada una, más la búsqueda de imágenes y la transacción). Antes de liberar, revisar el timeout del proxy y del cliente para este endpoint. Si el cliente corta y reintenta con la misma `Idempotency-Key`, recibe 409 mientras la primera sigue en curso, o la misma versión cuando terminó.

## 11. Pruebas requeridas

- Servicio (repositorio y Gemini mockeados): versión+1 y `supersedesId`; anterior no current y no borrada; replay idempotente (incluso ya reemplazada); misma key en otro plan → 409; `PENDING` → 409; concurrencia (`updateMany` 0 filas → 409, `P2002` → 409); fallo de transacción → anterior current y sin escrituras parciales; propuesta igual dos veces → 422 `NO_DIFFERENT_PROPOSAL`; una franja distinta → OK; reuso de receta de la versión anterior sin `recipe.create`; 403, 404, 409, 400, 503 y 422 por validación.
- Repositorio (transacción mockeada): `updateMany` condicional antes del `create`; reuso; `SUCCEEDED` en la misma transacción; `deletePlanTransaction` no borra recetas.
- Controller y DTO: `Idempotency-Key`, enum de `reason`, 201, `uuidOr404`.
- Flujo: después de regenerar, `GET current` devuelve sólo la versión nueva.
