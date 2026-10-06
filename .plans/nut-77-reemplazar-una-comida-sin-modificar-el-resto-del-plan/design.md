# NUT-77 — Diseño: reemplazar una comida sin modificar el resto del plan

## 1. Contexto y alcance

**Objetivo.** Reemplazar una sola comida del plan sin modificar ni regenerar el resto de la semana.

**Contexto verificado en el código.**
- NUT-72 (`RecipeCoverageService`) existe: busca recetas del catálogo por `topic`/`categories`/`properties`/`maxPrepMinutes`/`excludeRecipeIds`, y agrega por su cuenta los grupos de categoría obligatorios que deriva del perfil (el caller no puede pisarlos). Lanza `InsufficientCoverageProfileError` para perfiles que no sabe traducir: dietas `PALEO`/`KETO`/`PESCATARIAN` o restricciones `NUTS`/`SHELLFISH`/`SOY`.
- NUT-73 (generar una receta) y NUT-74 (validarla) **no existen** todavía. Este ticket construye la versión mínima que necesita: un método de Gemini para generar una comida y la validación de restricciones ya existente, extraída para una sola comida.
- De NUT-75 existen `GenerationRun` (con `kind = MEAL_REPLACEMENT` declarado y sin uso), la máquina de estados, `computeIdempotencyKeyHash` y el índice único parcial `(userId, kind, idempotencyKeyHash) WHERE status NOT IN ('FAILED','REJECTED','EXPIRED')`.
- Ni `Recipe` ni NUT-72 tienen noción de tipo de comida (desayuno, cena…).
- El guard JWT del proyecto sólo lee la cookie `token`; el `Authorization: Bearer` del ticket no está soportado en ningún endpoint. Este endpoint usa el mismo guard que el resto de `/meal-plans` (discrepancia fuera de alcance).

**Dentro de alcance:** el endpoint, su DTO y sus errores; la generación de una sola comida con IA; la validación de restricciones por comida; la idempotencia por `Idempotency-Key`.

**Fuera de alcance:** elegir manualmente desde el catálogo, regenerar la semana, UI, autenticación por Bearer, filtrar el catálogo por tipo de comida.

## 2. Decisiones

**D1 — Edición en el lugar, sin nueva versión del plan.** Se actualiza sólo el `PlannedMeal` objetivo: se mantienen `plannedMeal.id`, `dayId`, `mealType` y las demás comidas. `MealPlan.version` no cambia y el `version` de la respuesta es informativo. Crear una versión nueva (como `PUT /meal-plans`) cambiaría los ids de todas las comidas, lo que contradice el ticket.

**D2 — Control optimista con `MealPlan.updatedAt`.** Al leer el plan se guarda su `updatedAt`. La transacción empieza con un `updateMany` condicionado a `{ id, userId, isCurrent: true, updatedAt: <leído> }` que actualiza `updatedAt`. Si afecta 0 filas, el plan cambió (otro reemplazo, una regeneración o un borrado) y se responde 409. `version` queda reservado para el versionado de semana completa de NUT-75.

**D3 — Idempotencia sin migración.** `idempotencyKeyHash = sha256({ userId, kind: MEAL_REPLACEMENT, idempotencyKey })`, y el índice único parcial que ya existe garantiza un solo `GenerationRun` activo por clave. El `requestSnapshot` (plan, comida, criterios normalizados y versión de prompt) se guarda aparte. Si la clave ya existe:
- mismo `requestSnapshot` y run `SUCCEEDED` → se devuelve el mismo reemplazo (`outputSnapshot.recipeId`/`title`), sin buscar ni generar de nuevo;
- `requestSnapshot` distinto → 409 (idempotencia conflictiva);
- run todavía `PENDING` → 409 (otra request con la misma clave en curso).

Un run `FAILED`/`REJECTED`/`EXPIRED` libera la clave, así que el cliente puede reintentar. Se descartó la columna nueva `clientIdempotencyKey` del borrador anterior: daba lo mismo y además requería migración.

- **Huella normalizada:** `categories` y `properties` se guardan ordenadas, sin duplicados y (las propiedades) en minúsculas; el mismo pedido escrito en otro orden no da 409.
- **Recuperación:** al chocar con el índice se buscan sólo los runs activos (`PENDING`, `READY_FOR_REVIEW`, `CONFIRMED`, `SUCCEEDED`, el mismo conjunto que cubre el índice parcial), priorizando el terminado. Un `FAILED` viejo con el mismo hash nunca se devuelve. Si el activo terminó mal entre el choque y la lectura, se reintenta crear una vez. El cambio está en el método compartido con el plan semanal y lo beneficia igual.

**D3b — Runs colgados.** Desde que se crea el run, cualquier error inesperado lo marca `FAILED` (`UNEXPECTED_ERROR`). Un `PENDING` más viejo que `MEAL_REPLACEMENT_PENDING_TTL_MINUTES` (por defecto 10) se considera colgado: cuando llega una request con esa clave, se lo pasa a `EXPIRED` (`PENDING_TIMEOUT`), lo que libera la clave, y el pedido sigue con un run nuevo. No hay procesos automáticos: sólo se revisa al recibir esa clave. Esto requiere habilitar `PENDING → EXPIRED` en la máquina de estados de NUT-75.

**D4 — Primero el catálogo, después la IA.** Se piden a NUT-72 hasta 5 candidatas y se toma la primera que también pasa la validación de restricciones por texto (defensa extra). Exclusiones: primero la receta actual más las usadas esa semana; si no queda ninguna, sólo la actual ("cuando haya alternativas"). Si NUT-72 lanza `InsufficientCoverageProfileError`, se trata como "sin candidatas" y se sigue con la IA.

**D5 — IA: exactamente una comida, siempre validada.** Gemini genera una comida (título, macros y receta) con el perfil, el `mealType` de la comida objetivo y los criterios del body como contexto, y además clasifica la receta en `categories` (del enum) y `properties`. La respuesta se valida con `MealDto`, con las restricciones del perfil y con el body, con la misma regla que NUT-72: `prepMinutes <= maxPrepMinutes`, al menos una categoría pedida y todas las propiedades pedidas. Si no cumple → 422 (`CRITERIA_NOT_MET`). La receta se guarda con esas categorías y propiedades. Nunca se reintenta. Límite: la clasificación la hace la propia IA; `topic` no se valida.

**D5b — Restricciones en español e inglés.** Cada restricción (`NUTS`, `DAIRY`, `GLUTEN`, `SHELLFISH`, `SOY`) tiene una lista de palabras en español y en inglés que la delatan (ej.: `NUTS` → nuez, almendra, maní, pistacho, turrón…). Se busca por palabra completa, sin acentos ni mayúsculas, con plural opcional, en título, descripción e ingredientes. Antes de buscar se quitan frases que no son el alérgeno (ej.: "leche de almendras" no es `DAIRY`, aunque sí `NUTS`; "harina de arroz" y "sin gluten" no son `GLUTEN`). Ante la duda se prefiere un falso positivo (descartar una receta) a dejar pasar un alérgeno. La misma función valida el plan semanal.

**D6 — Los criterios refinan, nunca relajan.** En el catálogo, los grupos obligatorios del perfil se combinan con AND dentro de NUT-72. En la IA, el prompt prohíbe relajar el perfil y el resultado se vuelve a validar. El DTO rechaza campos desconocidos (`forbidNonWhitelisted`).

**D7 — 403 vs 404.** El plan se busca sólo por id. Si no existe → 404; si es de otro usuario → 403; si la comida no está en ese plan → 404. Un `planId`/`plannedMealId` que no es UUID → 404: en el proyecto, un id inválido en la URL responde 404 (recetas e ingredientes no lo validan y simplemente no lo encuentran), así que se usa `ParseUUIDPipe` configurado con 404. Ningún otro endpoint cambia su comportamiento.

**D8 — Llamadas externas fuera de la transacción.** NUT-72 y Gemini se llaman antes; la transacción sólo bloquea el plan, crea la receta nueva si la hay, actualiza la comida y marca el run `SUCCEEDED`. Si algo falla adentro, Prisma revierte todo y el run se marca `FAILED` en una operación aparte.

**Alternativas descartadas:** nueva versión del plan (D1); columna `clientIdempotencyKey` (D3); reintentar la generación con IA (el ticket pide exactamente una); agregar `mealType` a `Recipe`/NUT-72 (amplía NUT-72, queda para un ticket futuro).

## 3. Contrato

`POST /meal-plans/:planId/meals/:plannedMealId/replace`, cookie JWT, header `Idempotency-Key: <uuid>` obligatorio.

Body opcional (todos los campos refinan):
```json
{ "topic": "cena liviana", "categories": ["VEGETARIAN"], "properties": [], "maxPrepMinutes": 30 }
```
`topic` string de hasta 100 caracteres; `categories` valores de `RecipeCategory`; `properties` strings (se normalizan); `maxPrepMinutes` entero ≥ 1. Con body vacío no se agrega ningún filtro: sólo aplica el perfil, y el `mealType` de la comida actual se usa como contexto de la IA.

Respuesta 200:
```json
{
  "planId": "uuid", "version": 1, "dayId": "uuid",
  "plannedMeal": { "id": "uuid", "mealType": "DINNER", "title": "...", "recipeId": "uuid", "recipe": { } },
  "generationRunId": "uuid"
}
```
`recipe` es la receta completa. `nutritionalValues` de la comida se actualiza: con la IA, los que devuelve; con una receta del catálogo, se mapean `{ calories, protein, fiber }` a `{ Calories, Protein, Fiber }` (0 si faltan) y `Description` = descripción de la receta.

| Código | Cuándo |
|---|---|
| 400 | Body inválido, `Idempotency-Key` ausente o no UUID, usuario sin perfil nutricional |
| 403 | El plan es de otro usuario |
| 404 | No existe el plan, la comida no está en ese plan, o un id de la URL no es UUID |
| 409 | Plan no current; el plan cambió durante la operación; clave usada con otro pedido; misma clave todavía en curso |
| 422 | La IA respondió algo inválido, que viola una restricción o que no cumple los criterios del body |
| 503 | La IA no respondió (timeout de 15 s) o falló |

## 4. Flujo

1. Cargar el plan por id → 404/403; ubicar la comida → 404; `isCurrent` → 409. No se crea ningún `GenerationRun` en estos casos.
2. Cargar el perfil (400 si no hay); normalizar criterios; armar `requestSnapshot` y el hash de la clave.
3. Crear o recuperar el `GenerationRun` (D3).
4. Buscar en el catálogo (D4). Si no hay candidata, generar con IA (D5): si falla → run `FAILED` + 503; si es inválida → run `REJECTED` + 422.
5. Transacción (D2, D8): bloquear el plan, crear la receta si es de la IA (`origin: AI`, `generationRunId`), actualizar sólo la comida, run `SUCCEEDED` con `outputSnapshot { path: REUSED_EXISTING_RECIPE | AI_GENERATED, recipeId, title }`.
6. Si la transacción falla: run `FAILED` (`CONCURRENT_CONFLICT` → 409, o `PERSISTENCE_FAILED` → el error sigue).

La receta anterior nunca se borra: sólo deja de estar referenciada por esa comida.

## 5. Persistencia y migración

**Sin cambios de esquema ni migraciones.** El único cambio de dominio fuera del endpoint es la transición `PENDING → EXPIRED` en la máquina de estados de aplicación (D3b). Se usan `GenerationRun` (`kind = MEAL_REPLACEMENT`, ya en el enum) y su índice único parcial existente, `MealPlan.updatedAt` y `PlannedMeal`/`Recipe` tal como están. Rollback: revertir el código.

## 6. Criterios de aceptación y pruebas

1. **Reutiliza una receta existente sin IA**: con una candidata del catálogo, la comida apunta a ella, no se llama a la IA y no se crea receta.
2. **Genera una cuando falta**: sin candidatas (o con un perfil que NUT-72 no evalúa), se llama una vez a la IA y se crea una receta `origin: AI` vinculada al run.
3. **Sólo cambia la comida objetivo**: la transacción actualiza un único `PlannedMeal` por id; `dayId`, `mealType`, las demás comidas y `version` no cambian.
4. **La receta anterior no se borra**: la transacción no borra recetas.
5. **Restricciones**: una receta (del catálogo o de la IA) con un ingrediente excluido se descarta; si es de la IA → 422 y run `REJECTED`; los criterios del body sólo refinan.
6. **Plan/comida ajenos**: 403 para un plan de otro usuario; 404 para un plan inexistente o una comida fuera del plan; sin run en ambos casos.
7. **Idempotencia y concurrencia**: la misma clave con el mismo pedido (en cualquier orden) devuelve el mismo reemplazo sin repetir trabajo, aunque haya un intento `FAILED` anterior con esa clave; con otro pedido → 409; una request en curso con la misma clave → 409, salvo que esté colgada más del TTL (→ `EXPIRED` y se reintenta); un plan que cambia durante la operación → 409 sin cambios.
8. **Rollback**: si la IA falla, no hay transacción ni cambios; si la transacción falla, Prisma revierte todo y el run queda `FAILED`.
9. **Validación**: body inválido o `Idempotency-Key` inválida → 400.

## 7. Pendientes (fuera de este ticket) y propuesta de tickets

1. **Tipo de comida en el catálogo.** NUT-72 no distingue desayuno de cena, así que una cena puede reutilizar una receta pensada como desayuno. *Ticket propuesto:* agregar a `Recipe` un campo `mealTypes` (o "apta para") con migración aditiva, poblarlo al crear recetas (manuales y de IA) y sumarlo como filtro opcional de NUT-72; el reemplazo pasaría el `mealType` de la comida objetivo.
2. **`DELETE /meal-plans` borra recetas compartidas.** Al borrar un plan se borran todas sus recetas, incluidas las del catálogo reutilizadas por este endpoint u otros planes. *Ticket propuesto:* borrar sólo las recetas `origin: AI` creadas por ese plan y que ninguna otra comida referencia (o no borrar recetas y dejarlas en el catálogo), con tests de que un plan no puede borrar recetas de otro.
3. **Auth por Bearer.** El ticket habla de `Authorization: Bearer`, pero `JwtAuthGuard` sólo lee la cookie `token` en todo el proyecto, y este endpoint sigue esa convención. *Ticket propuesto:* decidir con TL si se acepta también Bearer (para clientes no web) y, si sí, hacerlo en el guard para todos los endpoints a la vez.

## 8. Otros riesgos

- **Dieta en la IA**: la validación por texto cubre las restricciones (`excludedIngredients`), no la dieta (por ejemplo, vegano); la dieta va en el prompt, igual que en el plan semanal.
- **Clasificación de la IA**: las categorías y propiedades de una receta generada las declara la propia IA; se validan contra el body pero no se pueden verificar independientemente.
- **Listas de palabras**: la detección de alérgenos depende de las listas de D5b; un ingrediente que no esté en ellas no se detecta. Conviene revisarlas con quien defina el contenido nutricional.
