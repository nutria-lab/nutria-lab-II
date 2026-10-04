# NUT-83 — Diseño: encontrar una imagen confiable para cada receta nueva

## 1. Contexto y alcance

**Resultado para la persona usuaria.** Cada receta nueva, manual o generada con IA, intenta obtener una foto ilustrativa de comida desde Unsplash. La foto no garantiza que represente exactamente los ingredientes o el resultado de la receta. La receta sigue siendo válida si no hay resultados o si el proveedor falla: queda con `image: null`.

**Contexto técnico.**
- NUT-61 define el contrato base de `Recipe`; NUT-75 agregó `origin` (`MANUAL` | `AI`) y `generationRunId`, como decisiones independientes entre sí.
- Una receta nace por tres caminos: creación manual individual (`POST /recipes`, una sola escritura sin transacción), creación/generación de plan (`POST /meal-plans` y generación con IA, una transacción que crea plan, días, comidas y recetas) y edición/regeneración de plan (`PUT /meal-plans`, una transacción que reemplaza la versión actual por una nueva).
- El backend usa el `fetch` global de Node, sin librerías HTTP adicionales, con el patrón ya establecido para llamadas externas: `AbortController` + timeout fijo, un único intento.
- Este ticket adapta el trabajo del PR #46 para usar Unsplash como proveedor único. Se conservan las mejoras de ese PR (persistencia única, resiliencia, concurrencia acotada, reutilización por query, llamadas externas fuera de transacciones y la migración aditiva de `Recipe.image`) y no queda ninguna integración paralela.

**Dentro de alcance.** Búsqueda y selección de una foto de Unsplash para toda receta nueva; persistencia de la foto elegida; registro de uso (`download_location`) después de guardar; metadata privada de tracking filtrada de todo DTO; recuperación explícita de tracking pendiente o fallido; manejo de cuota; conservación de la imagen de recetas existentes en `PUT /meal-plans`.

**Fuera de alcance.** Generación de imágenes con IA, scraping, backfill masivo, selector manual de imágenes, almacenamiento o descarga de archivos, nueva infraestructura de colas o workers. Tampoco se agrega otra llamada de IA para traducir la búsqueda.

**Dependencias.** NUT-61 (contrato base de `Recipe`). La persona responsable del proyecto configura la Access Key de Unsplash antes de la prueba real. Este ticket bloquea NUT-84 y la integración de imágenes de NUT-73.

## 2. Registro de decisiones

**D1 — Toda receta nueva intenta obtener imagen, sin importar `origin`.** Aplica a `POST /recipes`, a la creación y generación de planes, a las recetas nuevas de `PUT /meal-plans` y, cuando existan, a los borradores de NUT-73. La única distinción es creación vs. lectura: una lectura nunca busca ni reemplaza.

**D2 — Ninguna llamada externa ocurre dentro de una transacción de Prisma.** La búsqueda se resuelve en la capa de servicio antes de abrir la transacción, y el registro de uso ocurre después de que la escritura terminó. La transacción solo recibe `image` como dato plano. Razón: una transacción mantiene una conexión (y posibles locks) abierta; sumarle la latencia de un proveedor externo arriesga conexiones "idle in transaction" y mezcla un fallo ajeno con un rollback de datos propios.

**D3 — Concurrencia acotada a 3 y reutilización por query.** En una operación con varias recetas, las búsquedas corren con un máximo de 3 llamadas simultáneas (constante de código) y se hace una sola búsqueda por query normalizada. Secuencial sumaría hasta un timeout por receta al camino crítico; sin límite dispararía ráfagas contra una cuota compartida por key. El mismo límite aplica al registro de uso y a la recuperación.

**D4 — La ausencia de `UNSPLASH_ACCESS_KEY` no rompe nada.** El adaptador se construye sin la key; cada intento la lee en el momento, y si falta devuelve `image: null` sin request y con un warning saneado. Unsplash es opcional, a diferencia del proveedor de IA.

**D5 — El registro de uso ocurre después de guardar, con estado persistido.** La imagen se guarda con su metadata privada de tracking en estado `PENDING`; luego se invoca `download_location` y se actualiza a `SUCCEEDED` o `FAILED`. Si la escritura de la receta falla, no se registra ningún uso.

**D6 — La recuperación es un script operativo, no un endpoint.** No hay precedente de endpoints de administración (requeriría autenticación de admin, protección contra abuso y monitoreo nuevos). El proyecto ya opera scripts manuales con el mismo patrón que el seed de la base.

**D7 — En `PUT /meal-plans`, una receta existente se identifica por `id`.** `RecipeDto` admite un `id` opcional (UUID). Solo cuenta si pertenece a la versión actual del plan del mismo usuario para la misma semana; en ese caso se copia desde la base la imagen completa, con su metadata de tracking tal como esté, sin buscar ni registrar uso. Cualquier otro `id` (inexistente, de otro usuario o de una versión vieja) se trata como receta nueva, sin error. `image` nunca forma parte del DTO.

**D8 — Un registro de uso por foto en cada operación.** Si varias recetas de una misma operación (un plan, o una corrida de recuperación) quedan asociadas a la misma foto (mismo `download_location`), se envía un solo evento y su resultado se escribe en cada receta. Esto conserva el comportamiento del PR #46 y garantiza que la copia de una receta conservada en la versión nueva de un plan no genere un segundo evento cuando la recuperación procesa la original y la copia.

**Alternativas descartadas.**
- Resolver la imagen en la primera lectura: el ticket prohíbe buscar o reemplazar en cada GET.
- Limitar la búsqueda a `origin: 'AI'`: la dueña del ticket corrigió el alcance a "cada receta nueva".
- Reintentos automáticos ante 429, 5xx o timeout: el ticket pide un intento acotado; reintentar empeora justamente el caso 429.
- Tomar `image` del payload de `PUT /meal-plans`: el cliente no es confiable.
- Identificar recetas existentes por título normalizado: dos recetas distintas con el mismo título compartirían imagen.
- Endpoint HTTP de recuperación: ver D6.
- Proyectar en SQL solo los campos públicos del JSON: duplicaría la lista del contrato en una segunda fuente de verdad sin chequeo de tipos.

**Consecuencias.**
- En el peor caso (todas las búsquedas agotan el timeout), crear un plan suma `ceil(queries_únicas / 3) × timeout` de búsqueda más lo mismo para el registro de uso, acotado y sin reintentos.
- El estado de cuota vive en memoria por proceso: se reinicia en cada despliegue y no se comparte entre réplicas. Es una limitación aceptada para la demo (instancia única); compartirlo requeriría infraestructura nueva.
- No se puede afirmar "exactamente una vez" ante un timeout: Unsplash puede haber recibido el evento aunque la respuesta falle. La recuperación puede reenviarlo; eso se acepta.

## 3. Búsqueda y selección

### 3.1 Query reproducible

A partir del título que se persiste (sin modificarlo), en este orden:
1. Normalización Unicode NFKD.
2. Eliminar las marcas diacríticas combinantes (rango U+0300–U+036F): mismo criterio que la búsqueda de recetas ya aplica en la base con `unaccent`.
3. Trim.
4. Colapsar todo espacio en blanco interno a un único espacio.
5. Minúsculas.
6. Agregar el sufijo fijo: `` `${normalizado} food recipe` ``.

El resultado es el parámetro `query`, el valor persistido en `image.query` y la clave de reutilización de D3. Un título que queda vacío degrada a `"food recipe"`, sin error. Ejemplo: `"  Ñoquis   de\tPapá  "` → `"noquis de papa food recipe"`.

### 3.2 Request y selección del candidato

`GET https://api.unsplash.com/search/photos` con `Authorization: Client-ID <UNSPLASH_ACCESS_KEY>` (búsqueda pública: sin Secret Key ni OAuth) y parámetros `query`, `page=1`, `per_page=5`, `order_by=relevant`, `content_filter=high`.

Se recorre `results` en el orden de relevancia que devuelve Unsplash y se elige **el primer candidato válido**. Un candidato es válido si tiene:
- `id` string no vacío (Unsplash devuelve ids string, por ejemplo `"eOLpJytrbsQ"`);
- `urls.regular`, `links.html`, `links.download_location`, `user.name` y `user.links.html` como strings no vacíos;
- `width` y `height` enteros positivos;
- todas sus URLs válidas según 3.4.

Si la respuesta repite un `id`, las repeticiones se ignoran. La selección es reproducible para una misma respuesta; no se promete que el catálogo externo devuelva siempre los mismos resultados.

### 3.3 Texto alternativo y reutilización por query

`alt` es `alt_description` si es un string no vacío; si no, `` `Imagen ilustrativa de ${título}` `` con el título original de **esa** receta. Por eso, dentro de una operación, se reutiliza por query solo el candidato elegido, nunca el `alt` ya calculado: dos títulos que normalizan igual comparten la foto, pero cada uno tiene su propio texto alternativo.

### 3.4 Validación de URLs y de hosts

Antes de persistir o de registrar uso, cada URL se parsea con `URL` (no por substring) y debe ser `https:` con un host exacto:

| Campo | Host exacto |
|---|---|
| `urls.regular` | `images.unsplash.com` |
| `links.html`, `user.links.html` | `unsplash.com` |
| `links.download_location` | `api.unsplash.com` |

Parsear evita trucos de userinfo (`https://api.unsplash.com@evil.com/...` resuelve a `evil.com`) y subdominios parecidos. Un candidato con cualquier URL inválida se descarta. El header `Authorization` **nunca** se envía a un host sin validar: la URL de tracking se vuelve a validar justo antes de cada llamada (también en la recuperación), porque un valor leído de la base es un dato, no una fuente de confianza.

## 4. Errores y resiliencia

Cada llamada (búsqueda o registro de uso) hace un único intento con timeout de 5000 ms que cubre también la lectura del body. Ningún caso reintenta. Ningún fallo del adaptador impide guardar la receta o el plan.

| Caso | Resultado | Log (siempre sin la key) |
|---|---|---|
| Key ausente o vacía | `image: null`, sin request | warning |
| Cuota conocida agotada (sección 7) | `image: null`, sin request | warning con la hora de habilitación |
| 200 con `results: []` | `image: null` | ninguno |
| 200 sin candidatos válidos | `image: null` | warning |
| 401 / 403 | `image: null` | warning "Unsplash configuration appears invalid (status N)" |
| 429 / 5xx / otro status | `image: null` | warning con el status |
| Timeout | `image: null` | warning de timeout |
| JSON inválido | `image: null` | warning de respuesta inválida |
| Error de red | `image: null` | warning |
| Fallo inesperado del propio adaptador | `image: null` | error con stack |

Reglas de logs: nunca la key, nunca el header `Authorization`, nunca el body crudo de Unsplash, nunca la URL de tracking. Sí se pueden registrar el status, la categoría del fallo, la query normalizada y el `providerPhotoId`.

## 5. Contrato público

### 5.1 `RecipeImage`

```ts
type RecipeImage = {
  provider: 'UNSPLASH';
  providerPhotoId: string;
  imageUrl: string;
  sourceUrl: string;
  photographer: string;
  photographerUrl: string;
  alt: string;
  query: string;
  retrievedAt: string; // ISO 8601 UTC
};
```

`image` es `RecipeImage | null`: `null` cuando no hay candidato válido o la búsqueda falla.

### 5.2 Mapeo

`id` → `providerPhotoId`; `urls.regular` → `imageUrl`; `links.html` → `sourceUrl`; `user.name` → `photographer`; `user.links.html` → `photographerUrl`; `alt` según 3.3; `query` según 3.1; `retrievedAt` = momento de la búsqueda.

### 5.3 URLs de imagen y atribución

`imageUrl` se guarda tal como la entrega Unsplash, con `ixid` y todos sus parámetros: no se descargan bytes ni se sirven copias propias (hotlinking según las guías de Unsplash). A `sourceUrl` y `photographerUrl` se les agrega `utm_source=nutria&utm_medium=referral` conservando sus parámetros; si ya traían `utm_source`/`utm_medium`, se reemplazan en vez de duplicarse.

### 5.4 Filtrado de la metadata privada

Una única función de mapeo construye la imagen pública con lista blanca explícita de los 9 campos (nunca con spread). Se aplica en toda respuesta que incluya una receta: `POST /recipes`, `GET /recipes` (el listado por SQL crudo trae el JSON completo y se filtra en la capa de servicio), `GET /recipes/:id`, `PATCH /recipes/:id`, `DELETE /recipes/:id` y toda respuesta de planes. Los snapshots de `GenerationRun` no incluyen la clave `image` en ninguna receta.

**Nota para NUT-72.** El servicio de cobertura de recetas (recetas existentes reutilizables) devuelve hoy el `Recipe` completo, `image` con su metadata privada incluida. No se expone por HTTP todavía y no se modifica en este ticket; **cuando se exponga, su salida tiene que pasar por la función de mapeo público de 5.4**.

### 5.5 `image` nunca viene de afuera

Ni el cliente ni la salida de la IA pueden aportar `image`. Los DTOs de entrada no lo declaran, así que el `ValidationPipe` global (`whitelist` + `forbidNonWhitelisted`) responde 400 si un payload lo trae. Además, la capa de servicio descarta cualquier `image` que llegue en los días de un plan antes de buscar, por si el dato no pasó por el pipe (por ejemplo, la salida de la IA, que se valida sin `whitelist`).

## 6. Registro de uso de Unsplash

### 6.1 Qué es

Al asociar una foto a una receta (o a un borrador aceptado) el backend invoca el `links.download_location` devuelto por Unsplash con el mismo header `Client-ID`. Es un evento de uso: no es la URL para mostrar la imagen ni descarga el archivo. No se registra en búsquedas descartadas, en GET, en render ni en cambios de tamaño.

### 6.2 Metadata privada

Vive dentro del mismo JSON de `Recipe.image`, bajo una única clave anidada (así un spread descuidado la arrastra de forma visible) y nunca sale en DTOs, logs ni snapshots:

```ts
type UnsplashTrackingMetadata = {
  trackingUrl: string;        // links.download_location
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  lastAttemptAt: string | null;
};
type PersistedRecipeImage = RecipeImage & { tracking: UnsplashTrackingMetadata };
```

No se guarda la respuesta cruda ni credenciales.

### 6.3 Cuándo se dispara

1. Búsqueda y selección (sin registro de uso) antes de la escritura; la imagen queda armada con `tracking.status = 'PENDING'`.
2. Escritura de la receta o de la transacción del plan, con la imagen en `PENDING`.
3. Después de que la escritura terminó, fuera de toda transacción y antes de responder: registro de uso y actualización suelta de cada receta a `SUCCEEDED` o `FAILED` con `lastAttemptAt`. En un plan, con concurrencia 3 y un evento por foto (D8).

Se espera (`await`) el registro antes de responder porque en un despliegue serverless una tarea lanzada después de responder puede cortarse. Si el proceso muere entre los pasos 2 y 3, la receta ya quedó en `PENDING` y la recuperación la encuentra. Si la escritura del paso 2 falla, no se registra nada. Si falla la escritura del resultado del paso 3, la receta queda en `PENDING` para la recuperación y la request igual responde con éxito.

Un fallo o timeout del registro nunca elimina la imagen ni revierte la receta: queda `FAILED` con un warning saneado.

**Receta ya asociada.** Nunca se reenvía el evento de una receta `SUCCEEDED`. Una receta conservada en `PUT /meal-plans` (D7) mantiene su metadata tal como estaba, y el PUT no registra uso aunque esté `PENDING` o `FAILED`: eso lo maneja la recuperación. El mismo principio aplica a NUT-73: confirmar un borrador que ya tiene imagen asociada conserva la imagen y no registra otra asociación.

### 6.4 Recuperación explícita

Un método de servicio, invocado desde un script manual del backend:
1. Busca recetas con `image.tracking.status` en `PENDING` o `FAILED` (filtro JSON nativo de Prisma), las más antiguas primero, con un límite por corrida (50 por defecto). Las `SUCCEEDED` quedan excluidas por la propia consulta, así que nunca se reprocesan.
2. Agrupa por `trackingUrl` (D8), revalida el host (3.4) y hace un único intento por grupo, con concurrencia 3.
3. Escribe el resultado en cada receta del grupo, conservando sus campos públicos.
4. Imprime un resumen: encontradas, recuperadas y las que siguen `FAILED` (con `recipeId` y `providerPhotoId`).

No corre en GET, ni en cron, ni en el arranque, ni en loop. Es seguro correrla más de una vez. Ante un timeout no se puede afirmar exactamente una vez (sección 2, consecuencias).

**Operación para la demo.** Con `DATABASE_URL` y `UNSPLASH_ACCESS_KEY` en el entorno del backend, correr el script de recuperación de tracking del paquete de la API (opcionalmente con `--limit=N`) y leer el resumen. Sin la key, las filas encontradas quedan `FAILED` (no lanza).

## 7. Cuota

### 7.1 Límite y presupuesto para la demo

Una aplicación de Unsplash en modo demo tiene 50 requests por hora; tanto las búsquedas como los registros de uso pasan por la API. Límite real verificado el 2026-10-03 con la aplicación configurada: **`X-Ratelimit-Limit: 50`**. Unsplash no envía `X-Ratelimit-Reset`, así que tras agotar la cuota aplica el bloqueo de una hora de 7.2.

Presupuesto por operación:
- `POST /recipes`: hasta 2 requests (1 búsqueda + 1 registro).
- Plan de 7 días: 1 búsqueda por título único y 1 registro por foto distinta. Un plan con 21 recetas de títulos distintos puede consumir hasta 42 requests: con 50/h alcanza para un solo plan grande por hora.
- `PUT /meal-plans` que conserva recetas por `id`: 0 requests para esas recetas.
- Recuperación: 1 request por foto pendiente.

Recomendación para la demo: generar pocos planes por hora, preferir títulos repetidos cuando sea posible y, si la cuota se agota, esperar el reinicio en vez de reintentar.

### 7.2 `X-Ratelimit-Remaining`

Cada respuesta de búsqueda (200 o de error) actualiza el estado en memoria:
- `Remaining > 0` → búsquedas habilitadas.
- `Remaining = 0` → se usa el resultado de esa misma respuesta, pero las búsquedas siguientes no hacen request (`image: null` + warning) hasta el reinicio de la cuota: la hora indicada por `X-Ratelimit-Reset` si viene (timestamp epoch en segundos, o segundos desde ahora si es un número chico); si no viene, una hora después.
- Header ausente o mal formado → el estado no cambia.

## 8. Flujos

**Flujo A — `POST /recipes`.** Buscar y seleccionar → guardar la receta con la imagen en `PENDING` → registrar uso → actualizar a `SUCCEEDED`/`FAILED` → responder con la imagen pública. Sin candidato: guarda `image: null` y no registra nada.

**Flujo B — Creación o generación de un plan.** Validar → descartar todo `image` entrante (5.5) → buscar por query única con concurrencia 3 → transacción que crea plan, días, comidas y recetas con su imagen → después del commit, registrar uso (un evento por foto) y actualizar cada receta → responder el plan filtrado. Si la búsqueda en lote falla de forma inesperada, el plan se guarda sin imágenes. Si la transacción falla, no se registra nada.

**Flujo C — `PUT /meal-plans`.** Cargar la versión actual del plan del usuario para esa semana → por cada receta del payload: descartar `image`; si su `id` pertenece a esa versión, copiar la imagen persistida (D7); si no, dejarla como nueva → buscar solo las nuevas → transacción de reemplazo de versión → registrar uso solo para las imágenes recién encontradas → responder el plan filtrado.

**Flujo D — Lecturas.** Todo GET devuelve la imagen persistida filtrada (5.4). Nunca busca, reemplaza ni registra uso, aunque `image` sea `null`.

**Flujo E — Recuperación.** Ver 6.4.

## 9. Persistencia, Prisma y migración

Se reutiliza sin cambios la migración aditiva del PR #46: `Recipe.image Json?` nullable, sin default ni backfill (`ALTER TABLE "recipes" ADD COLUMN "image" JSONB;`). No hay migración nueva: la metadata de tracking vive dentro del mismo JSON.
- Filas existentes: `image = NULL`; se leen como `image: null`. No hay backfill masivo.
- Escrituras: `image` se escribe al crear la receta y se reescribe completo (el `Json` reemplaza el valor entero) al guardar el resultado del registro de uso. Ningún DTO de actualización permite escribir `image`.
- Consulta de recuperación: filtro por ruta JSON `['tracking', 'status']`.
- Rollback de esquema: `ALTER TABLE "recipes" DROP COLUMN "image";`, sin pérdida de otros campos. Revertir solo el código no deja datos inconsistentes: la metadata es aditiva dentro del JSON.

## 10. Historias, criterios de aceptación y pruebas requeridas

1. **Parámetros y normalización.** Dado un título con acentos, mayúsculas y espacios irregulares, cuando se busca, la request va a `/search/photos` con `query` normalizada (3.1), `page=1`, `per_page=5`, `order_by=relevant`, `content_filter=high` y `Authorization: Client-ID <key>`; la normalización es determinística.
2. **Primer candidato válido.** Dada una respuesta real con ids string, se elige el primer candidato válido por orden de relevancia; un candidato sin `download_location`, con dimensiones no positivas o con una URL no HTTPS o de otro host se descarta y se sigue con el siguiente.
3. **Mapeo, UTM y alt.** El DTO tiene los 9 campos mapeados según 5.2; `imageUrl` queda idéntica (con `ixid`); `sourceUrl` y `photographerUrl` llevan la UTM y conservan sus parámetros; sin `alt_description`, `alt` = "Imagen ilustrativa de <título>".
4. **Host no validado.** Nunca se hace una request (ni se envía la key) a una URL de tracking cuyo host no sea `api.unsplash.com` por HTTPS.
5. **Errores.** Key ausente (sin request), 401/403 (warning de configuración inválida), 429, 5xx, timeout (también durante la lectura del body), JSON inválido y error de red: `image: null`, un solo intento, la receta o el plan se guardan igual.
6. **Cuota.** Con `Remaining = 0` no se hacen más búsquedas hasta el reset (header o 1 hora); después se vuelve a buscar.
7. **Creación manual.** `POST /recipes` busca antes de guardar, guarda `PENDING`, registra el uso después y deja `SUCCEEDED`; si guardar falla, no registra; si el registro falla, la receta y la imagen quedan con `FAILED`.
8. **Planes.** La creación, la generación y la regeneración buscan antes de la transacción y registran el uso después del commit, con concurrencia 3 y una búsqueda por query.
9. **`PUT /meal-plans`.** Un `id` válido conserva la misma imagen con 0 búsquedas y 0 registros; un `id` de otro usuario, de una versión vieja o inexistente se trata como receta nueva; un payload con `image` responde 400 y el servicio lo descarta igual.
10. **Lecturas estables.** Leer dos veces la misma receta devuelve la misma imagen pública sin llamadas externas; una receta existente con `image: null` sigue en `null`.
11. **Recuperación.** Procesa solo `PENDING`/`FAILED`, nunca reenvía `SUCCEEDED`, envía un evento por `trackingUrl` y conserva receta e imagen ante un nuevo fallo.
12. **Sin llamadas externas en transacciones.** El repositorio de planes no referencia al adaptador de Unsplash; las pruebas verifican el orden búsqueda → transacción → registro.
13. **Sin filtraciones.** Ningún DTO (creación, listado, detalle, PATCH, DELETE, planes), log ni snapshot de `GenerationRun` contiene la key, el header `Authorization` ni la metadata de tracking.
14. **Prueba real.** Con la aplicación de Unsplash configurada: `POST /recipes` devuelve foto, fotógrafo y enlaces con UTM; la base muestra `tracking.status = 'SUCCEEDED'`; un GET devuelve la misma imagen sin metadata privada; se registra el `X-Ratelimit-Limit` real (sección 11).

Todas las pruebas automáticas usan respuestas con la forma real de Unsplash (ids string, URLs con `ixid`, `download_location` con `ixid`) y nunca hacen requests reales.

## 11. Release y evidencia

### 11.1 Checklist

- **Issue:** NUT-83 (el MCP de Linear no está autorizado en esta sesión; el vínculo se verifica a mano al abrir el PR).
- **Criterios de aceptación:** los 14 de la sección 10.
- **Migración:** sin migración nueva; se reutiliza la aditiva del PR #46.
- **Secretos:** la key solo existe en el entorno del backend; nunca en frontend, logs, respuestas ni snapshots (secciones 4 y 5.4).
- **Accesibilidad:** no aplica (solo backend); el `alt` siempre tiene texto.
- **Rollout:** despliegue normal de backend; configurar `UNSPLASH_ACCESS_KEY` en el entorno. Sin la key, la feature degrada a `image: null`.
- **Rollback:** revertir el código; el esquema se mantiene compatible (sección 9).

### 11.2 Prueba real

Evidencia de la prueba con la Access Key real de la aplicación (sin mostrar la key): ver la sección "Evidencia" del plan.

**Hallazgo de la prueba real.** Unsplash exige que coincidan todos los términos de la query, y con `content_filter=high` una sola palabra en español sin equivalente en su índice vacía los resultados: `"ensalada de quinoa con palta food recipe"` y `"guacamole casero food recipe"` devolvieron 0 resultados (`image: null`), mientras que `"guacamole food recipe"` devolvió 1094. El comportamiento es el especificado (sin traducción este sprint), pero en la práctica muchas recetas con títulos en español van a quedar sin imagen. Es un insumo para decidir una traducción o simplificación de la query en un ticket futuro (por ejemplo, para NUT-84).
