# NUT-75 — Diseño: persistir contexto y versiones de cada generación IA

Estado: decision record inicial (primera iteración de este documento). Conceptual: no nombra archivos ni rutas del repositorio — eso es trabajo del explorer. Este ticket define una decisión de arquitectura/persistencia; **TL debe aprobar el modelo y la migración antes de que se ejecute nada**, tal como pide el ticket explícitamente.

**Restricción de esta sesión de diseño, para que quede trazada:** no hay acceso a Neon MCP (no autenticado) y no se toca la base de datos local de la usuaria. Este documento sigue el protocolo de migración en dos pasos ya establecido para el proyecto: primero generar y revisar el SQL de la migración, y sólo ejecutarla contra un ambiente de desarrollo o compartido después de que TL la apruebe explícitamente. Ningún comando de migración ni ninguna consulta contra una base compartida se ejecuta como parte de este ticket ni de las etapas que lo consuman, hasta esa aprobación.

## 0. Resumen no técnico

Hoy, cuando se genera una receta o un plan de comidas con IA, no queda registro de **qué se le pidió al proveedor de IA, con qué perfil, con qué proveedor/modelo/versión de prompt, ni qué devolvió**. Tampoco existe historial cuando se regenera un plan: hoy se borra el plan viejo y se crea uno nuevo en la misma transacción, así que la versión anterior desaparece sin dejar rastro.

Este diseño agrega una tabla `GenerationRun` que registra cada intento de generación IA (qué se pidió, con qué perfil, qué proveedor/modelo/versión, qué devolvió, en qué estado quedó), sin guardar nombre, email, credenciales ni el prompt completo. Además, cambia cómo se regenera un plan de comidas: en vez de borrar y recrear, se crea una **nueva versión** y se marca la anterior como no-actual, conservando el vínculo entre versiones. Las recetas ganan un campo para saber si fueron creadas a mano o por IA, y opcionalmente de qué generación salieron.

## 1. Decision record (ADR)

### Contexto

- El único generador IA real que existe hoy en el código es el de planes de comidas semanales (vía Gemini, no OpenAI — ver nota de discrepancia al final de esta sección). No existe hoy generación IA de recetas sueltas ni de reemplazo de una comida puntual; el módulo de recetas es CRUD manual puro.
- La generación de plan hoy es "todo o nada": se llama al proveedor, se valida la estructura, y si pasa, se persiste directamente (`Recipe`/`MealPlan`/`MealPlanDay`/`PlannedMeal`) sin dejar ningún registro de la llamada en sí (ni request normalizado, ni snapshot del perfil usado, ni proveedor/modelo/versión de prompt, ni el output crudo antes de persistir).
- La idempotencia de la generación de plan hoy es implícita y débil: sólo comprueba "¿ya existe un plan para esta semana?" antes de llamar al proveedor; no hay ninguna clave de idempotencia explícita ni deduplicación de reintentos.
- La regeneración de plan hoy **borra** el plan existente (cascada sobre días y comidas) y crea uno nuevo dentro de la misma transacción. No hay versiones, no hay "superseded by", no hay forma de explicar después "esta era la versión anterior del plan".
- `MealPlan` tiene hoy una restricción `@@unique([userId, startDate])` que impide, por diseño de base de datos, que exista más de una fila para el mismo usuario/semana — exactamente lo que hace falta relajar para poder versionar conservando historial.
- El perfil nutricional (`NutritionProfile`) ya es, en sí mismo, un conjunto de campos sin PII (objetivo, dieta, restricciones, preferencia de tiempo de cocción) — no contiene nombre ni email; esos viven en `User`. Este hecho simplifica la regla de privacidad de `profileSnapshot`: alcanza con tomar el perfil completo menos sus columnas de identidad (`id`, `userId`) y timestamps.
- **Discrepancia detectada, documentada para que TL la tenga en cuenta (no es parte del alcance de este ticket resolverla):** la documentación de arquitectura del proyecto describe el proveedor de IA como uno distinto del que el código real usa hoy para generar planes (Gemini, modelo `gemini-1.5-flash`, versión de prompt `1.0.0`). El campo `provider`/`model` de `GenerationRun` es agnóstico a esto (son `String` libres), así que el diseño no depende de resolver esta discrepancia, pero vale la pena que quede señalada.

### Decisión

Se adopta el modelo `GenerationRun` tal como lo especifica el ticket (enums `GenerationKind`, `GenerationStatus`, `RecipeOrigin`, y el modelo con sus relaciones a `Recipe`/`MealPlan`), con estas precisiones de diseño que el ticket deja abiertas y que este documento cierra:

1. **Snapshots por lista blanca explícita**, nunca por copia del objeto completo (detalle en sección 6).
2. **`idempotencyKeyHash` se deriva del lado del servidor** a partir de una serialización canónica de `{userId, kind, requestSnapshot normalizado}`, hasheada con SHA-256 (determinístico, no salteado — ver justificación en sección 6). No se introduce ningún contrato nuevo de cliente (ni header, ni campo de DTO) para este ticket: es una decisión puramente de backend, consistente con que este es un ticket de backend y la usuaria de este repositorio es frontend-only.
3. **La máquina de estados se valida en código de aplicación**, no sólo en la base de datos; la base de datos actúa como respaldo de concurrencia vía updates condicionales (detalle en sección 7).
4. **El índice único parcial que garantiza "una sola versión actual por usuario/semana" no es representable en el DSL de `schema.prisma`** (Prisma no soporta índices parciales con `WHERE` en el conector relacional que usa este proyecto) y por lo tanto vive **únicamente en SQL escrito a mano** en la migración (detalle en sección 5). `schema.prisma` declara en su lugar un `@@index` simple (no único) sobre las mismas columnas, para que Prisma no intente tocar ese índice parcial en futuras corridas de `prisma migrate dev`.
5. **Corrección de un supuesto incorrecto del ticket**: el ticket asume columnas en snake_case (`user_id`, `start_date`, `is_current`) razonando por analogía con `@@map("meal_plans")`. Se verificó el schema real: **ningún modelo del proyecto usa `@map` a nivel de campo**, sólo `@@map` a nivel de tabla. Por lo tanto las columnas reales son las mismas que los nombres de campo de Prisma, en camelCase y como identificadores entre comillas dobles: `"userId"`, `"startDate"`, `"isCurrent"`, etc. Todo el SQL de la sección 5 usa los nombres reales, no snake_case.
6. **Confirmación transaccional real hoy vs. camino de revisión humana futuro**: como hoy no existe ninguna UI/endpoint de revisión humana antes de persistir un plan generado, este ticket implementa el camino corto `PENDING → SUCCEEDED` (crear filas de dominio + marcar `SUCCEEDED` en la misma transacción) para los generadores que ya existen (plan de comidas). El camino largo `PENDING → READY_FOR_REVIEW → CONFIRMED` queda definido y disponible en el enum/máquina de estados para cuando exista un flujo real que lo necesite (por ejemplo, generación de recetas sueltas con confirmación explícita del usuario), pero **no se conecta a ningún caller en esta iteración** porque no hay ningún caller real que lo necesite todavía (ver sección 8).

### Alternativas consideradas

1. **Guardar la trazabilidad como JSON embebido directamente en `Recipe`/`MealPlan`**, sin tabla separada. Rechazada: no permite deduplicar por idempotencia (no hay tabla contra la cual buscar), duplica el snapshot del perfil una vez por cada receta de una generación batch, y no permite responder "dame todas las generaciones de este usuario" sin escanear dos tablas de dominio distintas.
2. **Versionar `MealPlan` sólo con un booleano `isCurrent` sin `supersedesId`**. Rechazada: pierde la cadena explícita de "esta versión reemplazó a esta otra", que el ticket pide explícitamente y que es la pieza que realmente sirve para auditoría/explicabilidad (el objetivo no técnico del ticket).
3. **Expresar el índice único parcial dentro de `schema.prisma`**. No es una alternativa real: no está soportada por el proveedor relacional en la versión de Prisma que usa este proyecto (no hay atributo en el DSL para condicionar un `@@unique` con `WHERE`). Se documenta igual para que quede explícito que no fue una omisión, sino una imposibilidad de la herramienta.
4. **Mantener el borrado+recreación actual de `MealPlan` al regenerar**. Rechazada: es exactamente el comportamiento que este ticket reemplaza; mantenerlo contradice el objetivo no técnico del ticket.
5. **Validar transiciones de estado con un trigger/constraint de base de datos** (function + `CHECK`/trigger en Postgres). Rechazada por consistencia con el resto del proyecto: no hay ningún precedente de lógica de negocio en triggers de base de datos hoy (todas las reglas de dominio, como `validateRestrictions`, viven en la capa de servicio); introducir triggers agregaría una superficie nueva de complejidad operativa y de testing que no está justificada para este alcance. La base de datos sigue interviniendo, pero sólo como respaldo de concurrencia (updates condicionales + índice único), nunca como dueña de la regla de qué transición es válida.

### Consecuencias

- Toda llamada de generación IA gana un paso de escritura adicional (crear el `GenerationRun` antes de llamar al proveedor, y actualizarlo después), en las dos capas ya existentes (servicio construye/decide, repositorio persiste).
- El flujo de regeneración de plan se vuelve más complejo: ya no es "borrar y crear", es "marcar anterior no-actual + crear nueva versión + estos dos pasos en un orden que nunca deje dos filas `isCurrent = true` visibles a la vez dentro de la misma transacción" (detalle en sección 3, flujo D).
- `Recipe` y `MealPlan` ganan una FK nullable con `onDelete: SetNull` hacia `GenerationRun`: borrar un `GenerationRun` (por ejemplo, en una futura limpieza de retención) nunca borra ni huerfaniza destructivamente una receta o un plan ya persistidos, sólo desvincula la trazabilidad.
- Superficie de pruebas nueva considerable: backfill, versión única actual por semana, deduplicación por idempotencia, aislamiento entre usuarios, transiciones inválidas, `SetNull`, confirmación transaccional, exclusión de PII en snapshots (todas detalladas en la sección 4).
- El ticket, tal como está redactado, es grande para una sola iteración bounded — ver recomendación de partición en sección 8.

## 2. Arquitectura y responsabilidades por capa

El proyecto sigue `Controller → Service → Repository → Prisma`. Este diseño respeta esa separación y no introduce una capa nueva:

- **Construcción de snapshots (`profileSnapshot`, `requestSnapshot`) y su scrubbing de PII**: responsabilidad de la **capa de servicio** que ya orquesta la generación (la misma que hoy arma el DTO y llama al adaptador del proveedor de IA). Nunca en el repositorio (que debe seguir siendo una capa de persistencia fina) ni en el adaptador del proveedor de IA (que debe seguir limitado a llamar a la API externa y devolver el output estructurado crudo, sin decidir qué es seguro persistir).
- **Cómputo del hash de idempotencia**: responsabilidad de la **capa de servicio**, porque sólo el servicio sabe qué significa "la misma solicitud" para cada `GenerationKind` (para plan de comidas, hoy, es `userId + kind + startDate normalizada + promptVersion + schemaVersion`). El repositorio sólo recibe el hash ya calculado y hace el `create`/manejo de conflicto único contra la tabla.
- **Máquina de estados (tabla de transiciones válidas + función que decide si una transición está permitida)**: responsabilidad de la **capa de servicio**, como una función/tabla pequeña y pura, en el mismo espíritu que `validateRestrictions` ya vive hoy en el servicio de planes y no en el repositorio. El repositorio expone una escritura condicional (`updateMany` con `where: { id, status: { in: estadosDeOrigenPermitidos } }`) y devuelve cuántas filas se afectaron; el servicio traduce "0 filas afectadas" en un error de dominio de transición inválida. Esto es lo que hace que la validación **no dependa sólo de la base de datos**: la tabla de transiciones legales vive en código TypeScript testeable unitariamente sin tocar Postgres, y la base de datos sólo actúa como candado de concurrencia (evita que dos requests concurrentes hagan la misma transición dos veces).
- **Versionado transaccional de `MealPlan` (supersede) y confirmación transaccional (crear `Recipe`/`MealPlan` + marcar el `GenerationRun` como `CONFIRMED`/`SUCCEEDED`)**: responsabilidad de la **capa de repositorio**, expresada como una única `$transaction`, siguiendo exactamente el patrón que ya usan hoy `createPlanTransaction`/`updatePlanTransaction`/`deletePlanTransaction`. El servicio decide **cuándo** llamar a esa transacción y con qué datos ya validados; el repositorio es responsable de **cómo** esas escrituras múltiples ocurren atómicamente.
- **Lectura de `GET /meal-plans/current`**: sigue viviendo en el par servicio/repositorio de planes ya existente; cambia únicamente el criterio de búsqueda (de `findUnique` por la unicidad simple antigua, a un filtro explícito por `isCurrent = true`, ver flujo E).
- **Aislamiento entre usuarios** (nadie lee la ejecución ajena): responsabilidad de la **capa de repositorio**, como invariante estructural — cualquier método que lea un `GenerationRun` por id debe recibir también el `userId` y filtrarlo en el propio `WHERE` de la consulta (nunca "buscar por id y comprobar después en memoria"), para que sea imposible construir accidentalmente una consulta que filtre sólo por id.

## 3. Flujos

### Flujo A — Iniciar una generación IA (cualquier `GenerationKind`)

1. El servicio recibe la solicitud ya validada por DTO (por ejemplo, `weekStart` para plan de comidas).
2. El servicio carga el perfil nutricional del usuario (ya lo hace hoy) y construye `profileSnapshot` por lista blanca (sección 6).
3. El servicio normaliza los criterios de la solicitud y construye `requestSnapshot` por lista blanca (sección 6).
4. El servicio calcula `idempotencyKeyHash = sha256(canonicalJson({ userId, kind, requestSnapshot }))`.
5. El servicio pide al repositorio crear el `GenerationRun` con `status: PENDING`, `provider`, `model`, `promptVersion`, `schemaVersion` ya conocidos de antemano (son constantes del adaptador de IA, no dependen de la respuesta), y los snapshots ya armados.
   - Si ya existe una fila con el mismo `(userId, kind, idempotencyKeyHash)` (constraint único), el repositorio no crea una fila nueva: recupera la existente y la devuelve (ver Flujo idempotencia más abajo). El servicio corta el flujo ahí — no se vuelve a llamar al proveedor de IA para una solicitud ya en curso o ya resuelta con el mismo fingerprint.
6. El servicio llama al proveedor de IA (adaptador ya existente).
7. Si el proveedor falla o el timeout se dispara: transición `PENDING → FAILED`, `errorCode` con un código simbólico corto (nunca el stack trace ni el mensaje crudo del proveedor), `completedAt` seteado, dentro de una única escritura condicional.
8. Si el proveedor responde: el servicio valida la estructura (como ya hace hoy) y las restricciones de dominio.
   - Si la validación de esquema falla: `PENDING → FAILED`, `errorCode` simbólico (p. ej. `AI_INVALID_SCHEMA`).
   - Si la validación de restricciones de dominio falla: `PENDING → REJECTED`, `errorCode` simbólico (p. ej. `RESTRICTION_VIOLATION`).
   - Si todo pasa: sigue el Flujo C (confirmación transaccional), camino corto `PENDING → SUCCEEDED` para los generadores existentes hoy (ver decisión 6 del ADR).

### Flujo B — Transición de estados

Ver tabla completa en la sección 7. Regla operativa común a toda transición: se ejecuta como un `updateMany` condicionado por el estado de origen esperado (`where: { id, status: { in: [...origenesPermitidos] } }`); si el conteo de filas afectadas es 0, el servicio lanza un error de dominio de "transición inválida" sin tocar nada más. Toda transición hacia un estado terminal (`CONFIRMED`, `SUCCEEDED`, `REJECTED`, `FAILED`, `EXPIRED`) completa `completedAt = now()` en la misma escritura.

### Flujo C — Confirmación transaccional

Para los generadores que ya existen hoy (plan de comidas, camino corto sin revisión humana):

1. Dentro de una única `$transaction`:
   a. Crear las filas de dominio (`MealPlan` + `MealPlanDay` + `PlannedMeal`, y `Recipe` cuando la comida trae receta) con `generationRunId` apuntando al `GenerationRun` en curso, y `Recipe.origin = 'AI'` para las recetas creadas por este camino.
   b. Ejecutar la transición condicional `PENDING → SUCCEEDED` sobre ese `GenerationRun`, con `outputSnapshot`/`validationSnapshot` ya poblados y `completedAt` seteado.
   c. Si el `updateMany` de (b) afecta 0 filas (alguien ya movió este run a otro estado — condición de carrera), la transacción entera se aborta (rollback) y no queda ninguna fila de dominio creada a medias.
2. Si cualquier paso de (a) falla (por ejemplo, una violación de constraint inesperada), la transacción completa hace rollback y el `GenerationRun` se transiciona a `FAILED` en una operación separada posterior (fuera de la transacción abortada, porque esa fila sí necesita sobrevivir para explicar el fallo).

Para el camino largo (no conectado a ningún caller todavía, definido para uso futuro): `READY_FOR_REVIEW → CONFIRMED` sigue el mismo patrón (a)-(b)-(c), con la diferencia de que las filas de dominio recién se crean en el paso de `CONFIRMED` (en `READY_FOR_REVIEW` sólo existe el draft dentro de `outputSnapshot`, ninguna fila de `Recipe`/`MealPlan` todavía).

### Flujo D — Regeneración de plan de comidas (supersede)

Reemplaza el borrado+recreación actual. Dentro de una única `$transaction`:

1. Buscar la versión actual: `MealPlan` con `userId`, `startDate = weekStart`, `isCurrent = true` (debe existir exactamente una, por el índice único parcial de la sección 5; si no existe ninguna, es una regeneración inválida — no hay nada que reemplazar, debería usarse el flujo de creación inicial).
2. `UPDATE` esa fila: `isCurrent = false`. Esta escritura debe ejecutarse **antes** de insertar la fila nueva (ver nota de orden más abajo).
3. `INSERT` la nueva versión: mismo `userId`/`startDate`, `version = anterior.version + 1`, `isCurrent = true`, `supersedesId = anterior.id`, `generationRunId` apuntando al nuevo `GenerationRun`.
4. Crear los `MealPlanDay`/`PlannedMeal`/`Recipe` nuevos colgando de la nueva versión, igual que hoy.
5. La versión anterior **no se borra**: queda con `isCurrent = false`, sigue teniendo sus propios `MealPlanDay`/`PlannedMeal`/`Recipe` intactos (a diferencia de hoy, que los borraba en cascada).

**Nota de orden y concurrencia:** el paso 2 debe completarse antes de que el paso 3 inserte la fila con `isCurrent = true`, para que el índice único parcial nunca vea dos filas `isCurrent = true` para el mismo `(userId, startDate)` al mismo tiempo — dentro de una misma transacción esto es simplemente un tema de orden de sentencias (Postgres valida el índice único al final de cada sentencia, no al final de la transacción, salvo que se declare `DEFERRABLE`, que no es necesario aquí si se respeta el orden). Si dos regeneraciones concurrentes de la **misma** semana/usuario se solapan, la segunda transacción bloquea en el `UPDATE` del paso 2 (fila ya lockeada por la primera) y, al reintentar tras el commit de la primera, o bien encuentra que la versión "actual" ya cambió (y debería re-leer antes de decidir sobre qué versión hacer supersede — responsabilidad del servicio, no de este documento de bajo nivel), o si de todos modos intenta insertar una segunda fila `isCurrent = true` para la misma clave, el índice único parcial la rechaza con una violación de unicidad, que el servicio traduce en un error de conflicto (409) en vez de dejar dos "actuales" simultáneas.

### Flujo E — Lectura de `GET /meal-plans/current`

Hoy el repositorio busca con `findUnique` sobre la unicidad simple `(userId, startDate)`, que ya no alcanza (porque ahora pueden existir varias filas históricas para el mismo `(userId, startDate)`, todas menos una con `isCurrent = false`). El criterio de búsqueda cambia a: `findFirst` (o `findUnique` contra el nuevo índice único parcial, si Prisma permite direccionar un índice parcial como `where` compuesto — a confirmar en la etapa de exploración; si no lo permite, `findFirst` con `where: { userId, startDate, isCurrent: true }` es funcionalmente equivalente y seguro gracias al índice único parcial) filtrando explícitamente por `isCurrent: true`, manteniendo el mismo parámetro `weekStart` de query que el endpoint ya expone hoy.

## 4. Historias de usuario y criterios de aceptación

Numeradas AC1–AC8 = las ocho "pruebas mínimas" literales del ticket, en formato Given/When/Then. AC9–AC11 son adicionales, derivadas directamente de los flujos A/D/E de la sección 3, necesarias para que los flujos descritos sean testeables de punta a punta aunque el ticket no las liste explícitamente bajo "pruebas mínimas".

**AC1 — Backfill sobre datos existentes**
Given una base con filas de `Recipe` y `MealPlan` creadas antes de esta migración,
When se aplica la migración,
Then toda fila existente de `Recipe` queda con `origin = 'MANUAL'` y `generationRunId = null`, y toda fila existente de `MealPlan` queda con `version = 1`, `isCurrent = true`, `generationRunId = null` y `supersedesId = null`, sin que ninguna fila pierda ningún dato previo.

**AC2 — Una sola versión current por semana**
Given un usuario con una versión actual de plan para una semana dada,
When se intenta insertar una segunda fila `MealPlan` con el mismo `(userId, startDate)` e `isCurrent = true` (ya sea por un bug de concurrencia o por no marcar primero la anterior como no-actual),
Then la base de datos rechaza la escritura por violación del índice único parcial, y ese rechazo se traduce en un error de dominio manejado (no una excepción no controlada que llegue al usuario como error 500 genérico).

**AC3 — Misma idempotency hash no duplica ejecución**
Given una solicitud de generación con un `(userId, kind, requestSnapshot)` que ya produjo un `GenerationRun` previamente (mismo `idempotencyKeyHash`),
When se repite esa misma solicitud,
Then no se crea un segundo `GenerationRun` ni se vuelve a invocar al proveedor de IA; se recupera y devuelve el `GenerationRun` ya existente.

**AC4 — Usuario no lee ejecución ajena**
Given un `GenerationRun` que pertenece al usuario A,
When el usuario B intenta leerlo (por id) a través de cualquier método de la capa de repositorio/servicio que exponga esa lectura,
Then la consulta no devuelve esa fila (se filtra por `userId` en el propio `WHERE`, nunca se expone un método que busque sólo por id de `GenerationRun`).

**AC5 — Transiciones inválidas**
Given un `GenerationRun` en un estado terminal (`CONFIRMED`, `SUCCEEDED`, `REJECTED`, `FAILED` o `EXPIRED`),
When se intenta transicionarlo a cualquier otro estado, incluyendo `PENDING`,
Then la transición se rechaza con un error de dominio y el estado/`completedAt` de la fila no cambian. Adicionalmente: dado un `GenerationRun` en `PENDING`, intentar transicionarlo directamente a `CONFIRMED` (saltando `READY_FOR_REVIEW`) también se rechaza, porque `CONFIRMED` sólo es alcanzable desde `READY_FOR_REVIEW` según la tabla de la sección 7.

**AC6 — OnDelete SetNull conserva Recipe/MealPlan**
Given una `Recipe` y un `MealPlan` que apuntan a un `GenerationRun` existente vía `generationRunId`,
When ese `GenerationRun` se borra,
Then la `Recipe` y el `MealPlan` siguen existiendo intactos (ningún otro campo se pierde), sólo con `generationRunId = null`.

**AC7 — Confirmación transaccional**
Given una generación de plan de comidas que pasó validación de esquema y de restricciones,
When se ejecuta la confirmación (Flujo C),
Then las filas de `MealPlan`/`MealPlanDay`/`PlannedMeal`/`Recipe` y la transición del `GenerationRun` a `SUCCEEDED` se confirman juntas (misma transacción): si cualquiera de las escrituras de dominio falla, ninguna fila de dominio queda creada a medias y el `GenerationRun` no queda en `SUCCEEDED` con datos de dominio faltantes.

**AC8 — Snapshots excluyen PII/secretos**
Given un `GenerationRun` recién creado para cualquier `userId`,
When se inspeccionan `profileSnapshot` y `requestSnapshot`,
Then ninguno de los dos contiene `email`, `name`, headers, tokens/API keys, el prompt de sistema completo, ni la `idempotencyKey` cruda (sólo su hash en la columna dedicada) — ver lista blanca/negra exacta en sección 6.

**AC9 — Creación de `GenerationRun` al iniciar una generación (Flujo A)**
Given una solicitud válida de generación de plan de comidas,
When el servicio la procesa,
Then se crea un `GenerationRun` en `PENDING` con `provider`/`model`/`promptVersion`/`schemaVersion` correctos **antes** de invocar al proveedor de IA, de modo que incluso si el proveedor nunca responde, queda registro de que el intento ocurrió.

**AC10 — Regeneración crea nueva versión y conserva la anterior (Flujo D)**
Given un plan de comidas ya existente y `isCurrent = true` para una semana,
When se regenera esa semana,
Then se crea una nueva fila `MealPlan` con `version` incrementada, `isCurrent = true` y `supersedesId` apuntando a la versión anterior, la versión anterior queda con `isCurrent = false` pero **no se borra** (sus `MealPlanDay`/`PlannedMeal`/`Recipe` siguen existiendo), y ambos pasos ocurren en la misma transacción.

**AC11 — `GET /meal-plans/current` filtra por `isCurrent`**
Given un usuario con una versión actual y al menos una versión histórica (`isCurrent = false`) para la misma semana,
When se llama `GET /meal-plans/current?weekStart=...`,
Then la respuesta corresponde siempre a la fila con `isCurrent = true`, nunca a una versión histórica.

## 5. Estrategia de Prisma / base de datos / migración

**Ningún comando de Prisma se ejecuta en este ticket.** Todo lo de esta sección es SQL y schema para que TL lo revise; la ejecución (commit 2 del protocolo de dos commits) queda pendiente de aprobación humana explícita y de una rama de desarrollo de Neon, no de esta sesión.

### 5.1 Modelo completo a agregar (nuevo archivo de modelo, respetando la convención multi-archivo ya usada — uno por modelo)

```prisma
enum GenerationKind {
  RECIPE_SINGLE
  RECIPE_BATCH
  MEAL_PLAN_INITIAL
  MEAL_PLAN_REGENERATION
  MEAL_REPLACEMENT
}

enum GenerationStatus {
  PENDING
  READY_FOR_REVIEW
  CONFIRMED
  SUCCEEDED
  REJECTED
  FAILED
  EXPIRED
}

model GenerationRun {
  id                 String           @id @default(uuid())
  userId             String
  user               User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  kind               GenerationKind
  status             GenerationStatus @default(PENDING)
  provider           String
  model              String
  promptVersion      String
  schemaVersion      String
  idempotencyKeyHash String?
  requestSnapshot    Json
  profileSnapshot    Json
  outputSnapshot     Json?
  validationSnapshot Json?
  errorCode          String?
  expiresAt          DateTime?
  startedAt          DateTime         @default(now())
  completedAt        DateTime?
  createdAt          DateTime         @default(now())
  updatedAt          DateTime         @updatedAt

  recipes   Recipe[]
  mealPlans MealPlan[]

  @@index([userId, createdAt])
  @@unique([userId, kind, idempotencyKeyHash])
  @@map("generation_runs")
}
```

Nota sobre el `@@unique([userId, kind, idempotencyKeyHash])`: como `idempotencyKeyHash` es nullable, Postgres trata cada `NULL` como distinto de cualquier otro `NULL` a efectos de unicidad. Esto es intencional y deseable: una generación sin hash de idempotencia (si alguna vez existiera un caso así) nunca choca contra otra, sólo las que sí traen el mismo hash se deduplican. En el diseño de este ticket, sección 3 Flujo A, **todo** `GenerationRun` se crea con un hash calculado, así que en la práctica esta rama de "hash nulo" no debería ocurrir para los generadores conectados en esta iteración; se documenta igual porque el modelo del ticket declara el campo como opcional.

### 5.2 Cambios en `Recipe` (agregar al archivo de modelo existente)

```prisma
enum RecipeOrigin {
  MANUAL
  AI
}

model Recipe {
  // ...campos existentes sin cambios...
  origin          RecipeOrigin   @default(MANUAL)
  generationRunId String?
  generationRun   GenerationRun? @relation(fields: [generationRunId], references: [id], onDelete: SetNull)

  @@index([generationRunId])
}
```

### 5.3 Cambios en `MealPlan` (agregar/reemplazar en el archivo de modelo existente)

```prisma
model MealPlan {
  // ...campos existentes (id, userId, user, startDate, endDate, createdAt, updatedAt, days)...

  generationRunId String?
  generationRun   GenerationRun? @relation(fields: [generationRunId], references: [id], onDelete: SetNull)
  version         Int            @default(1)
  isCurrent       Boolean        @default(true)
  supersedesId    String?
  supersedes      MealPlan?      @relation("MealPlanVersions", fields: [supersedesId], references: [id], onDelete: SetNull)
  supersededBy    MealPlan[]     @relation("MealPlanVersions")

  // se elimina @@unique([userId, startDate]) — ver 5.5 sobre por qué no se reemplaza
  // por otro @@unique en schema.prisma, sino por un @@index simple + SQL a mano.
  @@index([userId, startDate])
  @@index([generationRunId])
  @@index([supersedesId])
  @@map("meal_plans")
}
```

### 5.4 Cambio necesario en `User` (no mencionado explícitamente por el ticket, pero obligatorio)

Prisma exige declarar ambos lados de una relación uno-a-muchos explícitamente. El snippet del ticket para `GenerationRun` declara `user User @relation(...)` del lado de `GenerationRun`, pero `User` necesita el lado inverso o el schema no compila:

```prisma
model User {
  // ...campos existentes...
  generationRuns GenerationRun[]
}
```

### 5.5 Por qué el índice único parcial no va en `schema.prisma`

La regla de negocio "una sola versión `isCurrent = true` por `(userId, startDate)`" es un índice único **parcial** (`WHERE isCurrent = true`) en Postgres. El DSL de `schema.prisma` de este proyecto (Prisma con el conector `postgresql` estándar, sin *preview features* de índices avanzados habilitadas) no tiene forma de expresar un predicado `WHERE` sobre un `@@unique`/`@@index`. Por eso:

- `schema.prisma` sólo declara `@@index([userId, startDate])` (no único) — sirve para que las consultas por semana sigan siendo rápidas, pero no impone la regla de unicidad.
- El índice único parcial real se crea **sólo** en el SQL de la migración escrita a mano (sección 5.6). Mientras `schema.prisma` no declare ningún `@@unique` que choque con esas mismas columnas, Prisma no va a intentar tocar ni recrear ese índice parcial en futuras ejecuciones de `prisma migrate dev` (Prisma sólo gestiona lo que puede expresar en el schema; un índice que existe en la base pero no en el schema, y que no genera un `drift` porque no hay un `@@unique`/`@@index` en conflicto declarado sobre las mismas columnas con otra forma, queda "fuera de su radar" de gestión automática). Esto debe verificarse en el commit 2 (ejecución), no es parte de esta sesión, pero queda documentado aquí para que TL lo tenga presente al aprobar.

### 5.6 SQL de la migración aditiva (a escribir a mano, sólo para revisión — no ejecutar)

Nombres de tabla/columna verificados contra el schema real (ver 5.1–5.3): `generation_runs` (nueva), `recipes`, `meal_plans` — columnas en camelCase entre comillas dobles, **no** snake_case.

```sql
-- 1) Enums nuevos
CREATE TYPE "GenerationKind" AS ENUM ('RECIPE_SINGLE', 'RECIPE_BATCH', 'MEAL_PLAN_INITIAL', 'MEAL_PLAN_REGENERATION', 'MEAL_REPLACEMENT');
CREATE TYPE "GenerationStatus" AS ENUM ('PENDING', 'READY_FOR_REVIEW', 'CONFIRMED', 'SUCCEEDED', 'REJECTED', 'FAILED', 'EXPIRED');
CREATE TYPE "RecipeOrigin" AS ENUM ('MANUAL', 'AI');

-- 2) Tabla nueva generation_runs
CREATE TABLE "generation_runs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "GenerationKind" NOT NULL,
    "status" "GenerationStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "idempotencyKeyHash" TEXT,
    "requestSnapshot" JSONB NOT NULL,
    "profileSnapshot" JSONB NOT NULL,
    "outputSnapshot" JSONB,
    "validationSnapshot" JSONB,
    "errorCode" TEXT,
    "expiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generation_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "generation_runs_userId_createdAt_idx" ON "generation_runs"("userId", "createdAt");
CREATE UNIQUE INDEX "generation_runs_userId_kind_idempotencyKeyHash_key" ON "generation_runs"("userId", "kind", "idempotencyKeyHash");

ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) recipes: origin + generationRunId
ALTER TABLE "recipes"
    ADD COLUMN "origin" "RecipeOrigin" NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN "generationRunId" TEXT;

CREATE INDEX "recipes_generationRunId_idx" ON "recipes"("generationRunId");

ALTER TABLE "recipes" ADD CONSTRAINT "recipes_generationRunId_fkey"
    FOREIGN KEY ("generationRunId") REFERENCES "generation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) meal_plans: quitar la unicidad simple vieja, agregar versionado
DROP INDEX "meal_plans_userId_startDate_key";

ALTER TABLE "meal_plans"
    ADD COLUMN "generationRunId" TEXT,
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "supersedesId" TEXT;

CREATE INDEX "meal_plans_userId_startDate_idx" ON "meal_plans"("userId", "startDate");
CREATE INDEX "meal_plans_generationRunId_idx" ON "meal_plans"("generationRunId");
CREATE INDEX "meal_plans_supersedesId_idx" ON "meal_plans"("supersedesId");

-- Índice único PARCIAL: sustituye a la unicidad simple que se quitó arriba.
-- No representable en schema.prisma (ver 5.5) — vive sólo acá.
CREATE UNIQUE INDEX "meal_plans_user_week_current_key"
    ON "meal_plans"("userId", "startDate")
    WHERE "isCurrent" = true;

ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_generationRunId_fkey"
    FOREIGN KEY ("generationRunId") REFERENCES "generation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_supersedesId_fkey"
    FOREIGN KEY ("supersedesId") REFERENCES "meal_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

### 5.7 Backfill

**No hace falta ningún `UPDATE` explícito.** Postgres (desde la versión 11, y Neon corre versiones muy por encima de esa) resuelve `ADD COLUMN ... NOT NULL DEFAULT <valor no volátil>` como un cambio de metadata, sin reescribir la tabla: toda fila existente lee el `DEFAULT` al vuelo. Esto cubre exactamente lo que pide el ticket:

- `recipes.origin` → `'MANUAL'` para toda fila existente (por el `DEFAULT 'MANUAL'` del paso 3).
- `meal_plans.version` → `1` para toda fila existente (por el `DEFAULT 1` del paso 4).
- `meal_plans.isCurrent` → `true` para toda fila existente (por el `DEFAULT true` del paso 4) — esto es seguro porque la vieja `@@unique([userId, startDate])` ya garantizaba que nunca hubo dos filas para el mismo `(userId, startDate)`, así que poner `isCurrent = true` en todas las filas existentes no puede violar el índice único parcial nuevo que se crea después en el mismo script.
- `recipes.generationRunId`, `meal_plans.generationRunId`, `meal_plans.supersedesId` → quedan en `NULL` simplemente porque no se les declaró `DEFAULT` (columnas nuevas nullable sin default son `NULL` por definición).

Verificación recomendada para la evidencia del commit 2 (no ejecutar ahora, sólo documentar qué se debería correr cuando TL apruebe): consultas de sólo lectura tipo `SELECT count(*) FROM meal_plans WHERE is_current IS NULL` (debe dar 0) — vale la pena confirmar el nombre real de columna al ejecutar, no asumir snake_case, por la misma razón de la sección 1.

### 5.8 Después de aprobado el commit 2 (fuera de esta sesión)

Regenerar el Prisma Client (`prisma generate` no toca la base de datos, sólo lee `schema.prisma`) y actualizar el seed y los fixtures de test para reflejar los campos nuevos (`origin` por defecto en los seeds de receta, `version`/`isCurrent` en los seeds de plan) es trabajo de la etapa de explorer/implementer, no de este documento de diseño ni de la ejecución de la migración en sí.

### 5.9 Impacto esperado y plan de rollback (requerido por la política de migraciones del proyecto)

**Impacto esperado:** migración aditiva. Agrega una tabla nueva, columnas nuevas (todas nullable o con `DEFAULT`) y reemplaza un índice único simple por uno parcial equivalente. No hay `UPDATE` de filas existentes (el backfill ocurre por `DEFAULT`, sección 5.7) ni pérdida de datos. El único cambio no aditivo es reemplazar el índice único de `meal_plans` por su versión parcial — el reemplazo es necesario para permitir versiones históricas y se ejecuta dentro de la misma migración transaccional, sin ventana sin invariante.

**Secuencia de rollout:** (1) TL aprueba el modelo y la migración; (2) se aplica en un ambiente de desarrollo/staging aprobado y se corre la suite de tests de integración ahí; (3) se promueve a producción a través del pipeline de despliegue ya existente del proyecto, que aplica las migraciones pendientes como parte del build.

**Plan de rollback:** depende de si ya se generaron versiones históricas de algún plan (`isCurrent:false`) para cuando se decide revertir:

- **Si todavía no se regeneró ningún plan** (a lo sumo una fila por `(userId, startDate)` en toda la tabla): revertir es seguro con una migración de reversa (nunca editando esta migración ya aplicada) que, en orden: elimina las FKs y los índices nuevos; elimina las columnas nuevas de `recipes`/`meal_plans`; recrea el índice único simple original sobre `(userId, startDate)`; elimina la tabla nueva y sus índices/FK; elimina los tres enums nuevos.
- **Si ya existen versiones históricas** (más de una fila para algún `(userId, startDate)`): recrear el índice único simple original fallaría hasta decidir qué hacer con esas filas adicionales (conservarlas fuera del modelo, o descartarlas). En ese caso el camino de rollback recomendado es revertir primero el **código de aplicación** (que deje de escribir/depender de `version`/`isCurrent`/`supersedesId`/`generationRunId`) manteniendo el esquema como está — todas las columnas nuevas son nullable o tienen `DEFAULT`, así que el esquema ampliado es compatible con código viejo — y tratar la reversión completa del esquema como una decisión de datos aparte, no automática.

## 6. Privacidad de snapshots

### `profileSnapshot` — lista blanca exacta

Se copian **únicamente** estos campos de `NutritionProfile`, tal como están al momento de la generación (nunca el objeto completo de Prisma, que también trae `id`, `userId`, `createdAt`, `updatedAt`):

- `goal` (objetivo — enum `NutritionGoal`)
- `diet` (preferencia dietaria — enum `Diet`)
- `excludedIngredients` (restricciones — array de `DietaryRestriction`)
- `cookTimePreference` (preferencia de tiempo de cocción — enum `CookTimePreference`)

`NutritionProfile` no tiene hoy ningún campo adicional de "properties" separado de estos cuatro; si en el futuro se agrega alguno, **queda excluido de `profileSnapshot` por defecto** hasta que se decida explícitamente incorporarlo a esta lista — la regla es lista blanca, nunca lista negra sobre el objeto completo.

### `requestSnapshot` — lista blanca exacta (para los `kind` conectados en esta iteración, `MEAL_PLAN_INITIAL`/`MEAL_PLAN_REGENERATION`)

- `kind` (el propio `GenerationKind` de esta corrida)
- `weekStart` (fecha normalizada, sólo la fecha, sin hora/zona horaria más allá de lo ya normalizado hoy por `parseDateString`)
- `promptVersion`
- `schemaVersion`

Para los `kind` no conectados todavía (`RECIPE_SINGLE`, `RECIPE_BATCH`, `MEAL_REPLACEMENT` — ver sección 8), esta misma regla de "sólo criterios normalizados, nunca texto libre ni PII" aplica cuando se conecten; el ticket no pide cerrar su forma exacta en esta iteración.

### `outputSnapshot` / `validationSnapshot`

Contienen el draft estructurado devuelto por el proveedor (para `outputSnapshot`) y el resultado de la validación de dominio (para `validationSnapshot`, por ejemplo qué restricción se evaluó y si pasó). Ninguno de los dos debe contener nada de la lista negra siguiente; dado que el prompt actual sólo interpola los cuatro campos de `profileSnapshot` (verificado contra el prompt real), el output del proveedor no debería traer PII salvo que el propio proveedor la alucine — igual no corresponde persistirla si apareciera, así que el paso de validación de dominio (que ya existe) es también el lugar natural para rechazar/sanitizar antes de guardar `outputSnapshot`.

### `errorCode`

Código simbólico corto de un conjunto cerrado (por ejemplo `AI_TIMEOUT`, `AI_INVALID_SCHEMA`, `RESTRICTION_VIOLATION`, `STALE_PENDING`). Nunca el mensaje crudo de la excepción ni un stack trace — mismo criterio que ya usan las excepciones actuales del servicio de planes (mensajes genéricos, no el error interno crudo).

### Lista negra explícita — nunca en ningún snapshot ni columna de `GenerationRun`

- `User.email`, `User.name`, `User.passwordHash` ni ningún otro dato de identidad.
- Headers HTTP, cookies, tokens de sesión/JWT, el header `Authorization`.
- API keys o credenciales del proveedor de IA (p. ej. la variable `GEMINI_API_KEY`).
- El prompt de sistema completo — sólo se persiste `promptVersion` (el identificador de versión), nunca el cuerpo del prompt.
- La clave de idempotencia cruda — sólo su hash en `idempotencyKeyHash`.
- IP del cliente o user agent (no forman parte de ningún campo pedido por el ticket).

### Sobre `idempotencyKeyHash`: por qué SHA-256 y no bcrypt

El proyecto ya usa `bcrypt` para `User.passwordHash`, pero `bcrypt` no sirve para este campo: genera un salt aleatorio en cada llamada, así que dos hashes de la misma clave de idempotencia **no son iguales entre sí** — rompería exactamente la búsqueda por igualdad (`@@unique`) que este campo necesita para deduplicar. Se usa en cambio un hash determinístico (SHA-256 sobre la serialización canónica de `{userId, kind, requestSnapshot}`), sin salt: el contenido hasheado no es un secreto de baja entropía que haga falta proteger contra fuerza bruta (ya es información normalizada y no sensible, listada arriba), el objetivo acá es sólo un fingerprint estable para deduplicar, no ocultar el contenido.

## 7. Máquina de estados

| Estado origen | Transiciones válidas | ¿Terminal? |
|---|---|---|
| `PENDING` | → `READY_FOR_REVIEW` \| `SUCCEEDED` \| `REJECTED` \| `FAILED` | No |
| `READY_FOR_REVIEW` | → `CONFIRMED` \| `EXPIRED` \| `REJECTED` | No |
| `CONFIRMED` | (ninguna) | Sí |
| `SUCCEEDED` | (ninguna) | Sí |
| `REJECTED` | (ninguna) | Sí |
| `FAILED` | (ninguna) | Sí |
| `EXPIRED` | (ninguna) | Sí |

Reglas:
- Ningún estado terminal transiciona a ningún otro estado, incluyendo `PENDING` (regla explícita del ticket).
- Toda transición **hacia** un estado terminal completa `completedAt = now()` en la misma escritura.
- Cualquier transición que no aparezca en la tabla (por ejemplo `PENDING → CONFIRMED` directo, saltando `READY_FOR_REVIEW`) es inválida.

**Dónde se valida (no depende sólo de la base de datos):**
1. Una tabla/función en código de aplicación (capa de servicio) declara exactamente las filas de esta tabla y es la fuente de verdad sobre qué transición es semánticamente legal — testeable con pruebas unitarias puras, sin base de datos.
2. Cada escritura de transición se ejecuta como `updateMany({ where: { id, status: { in: origenesPermitidos } }, data: { status: nuevoEstado, ... } })`. Si el conteo de filas afectadas es 0, el servicio lo traduce en un error de dominio de transición inválida.
3. El paso 2 es además el respaldo de concurrencia: si dos requests intentan transicionar el mismo `GenerationRun` al mismo tiempo, sólo una de las dos escrituras condicionales afecta una fila; la otra ve 0 filas afectadas y falla de forma controlada, sin condición de carrera silenciosa.

**Retención de drafts no confirmados (`expiresAt`):**
- Al entrar en `READY_FOR_REVIEW`, se propone `expiresAt = now() + 7 días` (valor de configuración, a confirmar con TL) como ventana de revisión.
- Cuando un `GenerationRun` en `READY_FOR_REVIEW` se lee y su `expiresAt` ya pasó, se transiciona en ese momento a `EXPIRED` (chequeo perezoso en lectura, sin un job/scheduler nuevo — el proyecto no tiene hoy infraestructura de tareas programadas, y agregar una para este ticket ampliaría el alcance; queda anotado como posible ticket de seguimiento en la sección 8). Al transicionar a `EXPIRED`, se limpian (`null`) `outputSnapshot` y `validationSnapshot` — son los campos que representan el contenido "pesado" del draft — pero **se conservan** `requestSnapshot`/`profileSnapshot` (ya sin PII) y el resto de la metadata (`kind`, `provider`, `model`, `promptVersion`, `schemaVersion`, timestamps), que es la "metadata mínima para auditoría" que pide el ticket.
- Un `GenerationRun` en `PENDING` que queda abandonado por mucho más tiempo del que cualquier llamada al proveedor podría tardar razonablemente (por ejemplo, una hora, con margen generoso sobre el timeout de 15s que ya usa hoy el adaptador de IA) se trata, con el mismo chequeo perezoso en lectura, como `FAILED` con `errorCode: 'STALE_PENDING'` — cubre el caso de un proceso que murió a mitad de una generación sin poder escribir el estado final.

## 8. Alcance de esta iteración y recomendación de partición

### Dentro de alcance de este diseño

- El modelo `GenerationRun` completo y los cambios relacionados en `Recipe`/`MealPlan`/`User`, tal como pide el ticket.
- El SQL de migración aditiva completo, revisado pero **no ejecutado**.
- El backfill (implícito por `DEFAULT`, sin `UPDATE`s).
- La máquina de estados completa (los siete estados, las transiciones válidas) definida y validable en código, aunque sólo el camino corto `PENDING → SUCCEEDED`/`FAILED`/`REJECTED` tenga hoy un caller real.
- El versionado transaccional de `MealPlan` (supersede) conectado al único flujo de regeneración que existe hoy.
- `GET /meal-plans/current` migrado a filtrar por `isCurrent`.
- Las reglas de privacidad de snapshots, aplicadas al único generador real (plan de comidas).

### Fuera de alcance (ya listado explícitamente por el ticket, se reafirma acá)

Panel administrativo, analytics de costo, guardar prompts completos, historial visible avanzado.

### Recomendación de partición (no se implementa acá, es una recomendación para decidir con el explorer)

Este ticket, tal como está redactado, mezcla dos cosas de tamaño bien distinto:

1. **Infraestructura de trazabilidad + versionado de plan de comidas**, que tiene un caller real hoy (el único generador IA que existe) y por lo tanto es completamente testeable de punta a punta con datos reales del sistema: esto es lo que cubre este documento y es, en tamaño, un cambio bounded razonable para un ciclo de `*_explorer → *_tester → *_implementer`.
2. **Los `GenerationKind` `RECIPE_SINGLE`, `RECIPE_BATCH` y `MEAL_REPLACEMENT`**, que el ticket pide declarar en el enum (y este documento los declara, sección 5.1, porque el enum es una sola pieza y no tiene sentido partirlo), pero que **no tienen ningún caller hoy**: no existe generación IA de recetas sueltas ni de reemplazo de una comida puntual en el código actual (la documentación de producto del módulo de recetas confirma explícitamente que la generación IA está fuera de su alcance). Conectar lógica de servicio real para estos tres `kind` ahora sería trabajo especulativo sobre una funcionalidad que todavía no existe, y agregaría pruebas y ramas de código sin ningún flujo real que las ejercite de punta a punta.

Recomendación concreta: mantener este `design.md` único (el modelo de datos es una sola decisión coherente y no tiene sentido partirlo), pero pedirle al explorer que produzca un `plan.md` **acotado sólo a los flujos de plan de comidas** (Flujos A, B, C, D, E de la sección 3; AC1–AC11 de la sección 4 con datos de plan de comidas). Cuando exista un ticket futuro que introduzca generación IA de recetas sueltas o reemplazo de comida, ese ticket puede apoyarse en el mismo `GenerationRun` ya construido (sin tocar el modelo de datos de nuevo) y sólo necesita un `plan.md`/ciclo de implementación propio para conectar esos `kind` a un caller real. Esto evita que el primer PR de este ticket cargue con pruebas y ramas de código muertas para funcionalidad que no existe todavía.

Adicionalmente, si TL lo prefiere, el sweeper activo de expiración (mencionado en la sección 7 como "posible ticket de seguimiento") puede separarse como una tercera pieza independiente, ya que el chequeo perezoso en lectura definido en este documento cubre la regla de negocio sin necesitar infraestructura de tareas programadas nueva.
