# NUT-83 — Diseño: encontrar una imagen confiable para cada receta nueva

## 0. Resumen no técnico

Cada vez que se crea una receta nueva en NutrIA — generada por IA dentro de un plan de comidas, o cargada a mano por una persona usuaria — el backend va a intentar, una sola vez y de forma acotada, buscar en Pexels una foto real de comida para esa receta. Esa búsqueda se hace con un texto reproducible (el título de la receta normalizado + "food recipe"), y si Pexels encuentra algo válido, ese resultado se guarda una sola vez junto con la receta — no se vuelve a buscar cada vez que alguien la lee. Si Pexels no tiene resultados, no está configurado, o falla (lento, caído, error), la receta se guarda igual, sin imagen (`image: null`), sin romper la creación/generación ni la confirmación del plan.

## 1. Decision record (ADR)

### Contexto

- NUT-61 define el contrato base de `Recipe` (catálogo instruccional: título, descripción, tiempos, ingredientes, instrucciones). NUT-75 (recién mergeado) agregó `origin: RecipeOrigin` (`MANUAL` | `AI`, default `MANUAL`) y `generationRunId` opcional, y dejó explícitamente documentado que **`origin` y `generationRunId` son decisiones independientes**: `generationRunId` sólo marca trazabilidad hacia un `GenerationRun`, y `origin` se estampa según un parámetro explícito separado. Existe hoy un camino de persistencia de plan que estampa `origin: 'MANUAL'` aun cuando pasa un `generationRunId` (edición/regeneración de plan), precisamente para no confundir "hubo un `GenerationRun` de por medio" con "esta receta puntual la generó la IA".
- Existen dos caminos de creación de `Recipe` en el sistema: (a) creación manual sin ningún proveedor de IA de por medio, y (b) creación dentro de la generación/regeneración de un plan de comidas, donde las filas de plan/día/comida/receta se crean juntas dentro de una única transacción de base de datos.
- El proyecto no tiene ninguna librería HTTP de propósito general instalada; el `fetch` global de Node es la opción sin agregar dependencias nuevas, igual que ya se decidió (implícitamente, por ausencia de alternativa) para cualquier llamada saliente que no sea al SDK propio de un proveedor.
- Ya existe en el proyecto un patrón establecido para llamadas externas acotadas: `AbortController` + `setTimeout` fijo, un solo intento, traduciendo el fallo del proveedor a un estado controlado en vez de dejar subir la excepción cruda. Ese patrón hoy se usa para una dependencia dura (sin ese proveedor no hay plan), así que el fallo ahí sí se propaga como error de dominio.
- Ya existe en el proyecto una convención de normalización de texto libre (trim + colapso de espacios) usada para otro campo de texto, y una convención de comparación insensible a acentos/mayúsculas para búsqueda de recetas a nivel de base de datos (usando la extensión `unaccent` de Postgres). Ninguna de las dos resuelve, tal cual, el problema de construir una query determinística para un proveedor externo, pero ambas informan el criterio de esta decisión: el dominio ya trata los acentos como ruido a eliminar para efectos de comparación/búsqueda, no como información significativa.
- Contrato real verificado de Pexels: `GET /v1/search` con header `Authorization: <key>` (sin prefijo `Bearer`), parámetros `query` (obligatorio), `per_page` (default 15, máx 80), `page`, sin ningún parámetro de "safe search" — Pexels no tiene ese toggle porque es un banco curado sin contenido explícito por diseño. El ticket pide "Safe Search activo"; esto es una imprecisión del ticket (documentada, no corregida en el ticket): se interpreta como "pedir un conjunto chico de resultados", nada más.

### Decisión

**D1 — Alcance: TODA receta nueva, sin importar `origin` (corregido — ver nota de revisión).**

> **Nota de revisión (posterior a la primera versión de este documento):** la primera versión de D1 limitaba el disparo a `origin: 'AI'` únicamente, con el razonamiento de que el cuerpo del ticket habla de "cuando NutrIA genera una receta nueva". La usuaria, dueña del ticket, corrigió explícitamente esa lectura: el título del ticket ("encontrar una imagen confiable para **cada receta nueva**") es el alcance real, y aplica sin importar si la receta se creó por IA o a mano. Se deja la sección "Alternativas consideradas" original sin borrar (más abajo) para que quede trazado qué se descartó y por qué se revirtió, en vez de reescribir la historia.

La búsqueda de imagen se dispara para **toda receta nueva que se persiste por primera vez**, sin importar el valor de `origin` (`AI` o `MANUAL`) ni el camino de creación: generación inicial de plan por IA, edición/regeneración de plan (`PUT /meal-plans`), y creación manual individual (`POST /recipes`). La única distinción que sigue existiendo es "creación" vs. "lectura" (D2 no cambia: nunca se recalcula en un GET) — no "IA" vs. "manual".

Razonamiento de la corrección: una receta manual también se beneficia de una imagen real asociada de forma reproducible — el "resultado para la persona usuaria" (ver sección 0) no distingue por procedencia, y limitar el alcance a IA dejaba una inconsistencia visible (recetas manuales sin imagen, junto a recetas de IA con imagen, en el mismo catálogo) sin ninguna razón de producto que lo justifique, más allá de una lectura literal del cuerpo del ticket que la propia dueña del ticket corrigió.

**D2 — Regla dura de arquitectura: la llamada a Pexels nunca ocurre dentro de una transacción de base de datos.**

La resolución de imagen (query + llamada HTTP a Pexels + selección de candidato) para todas las recetas nuevas de una misma operación de generación debe completarse **por entero en la capa de servicio, antes de abrir o invocar la transacción de Prisma** que persiste el plan (días/comidas/recetas). La transacción sólo recibe, por receta, un valor `image` ya resuelto (un objeto `RecipeImage` o `null`) como dato plano para escribir — nunca hace I/O de red por su cuenta.

Razonamiento: una transacción de Prisma contra Neon mantiene una conexión (y potencialmente locks) abierta durante toda su duración. Meter ahí una llamada HTTP a un proveedor externo — cuya latencia está gobernada por un timeout ajeno a cualquier necesidad de la base de datos — extiende esa conexión abierta por un tiempo que no tiene relación con el trabajo de base de datos real, aumenta el riesgo de que la transacción se quede "idle in transaction" o choque contra límites de conexión del pool serverless, y multiplica el radio de impacto de cualquier fallo del proveedor externo (que hoy ya está diseñado para degradar, no para fallar — pero igual no debe tener la posibilidad de arrastrar un rollback de datos que no tienen nada que ver con él). Esta es una regla de arquitectura, no un detalle de implementación: ningún método que abra o reciba un `$transaction` puede invocar, directa o indirectamente, al adaptador de Pexels.

**D3 — Concurrencia acotada para resolver imágenes de un batch (ej. plan semanal con varias recetas).**

Cuando una sola operación de generación produce varias recetas nuevas a la vez (ej. un plan de 7 días con hasta ~21 comidas con receta), las búsquedas de imagen se resuelven con **concurrencia acotada a un máximo de 3 llamadas simultáneas a Pexels**, no secuencial y no en paralelo sin límite.

Razonamiento (rendimiento vs. simplicidad vs. rate limit): secuencial sumaría, en el peor caso, hasta 21 rondas del timeout acotado de Pexels al camino crítico de la generación de plan (que ya paga el presupuesto de tiempo de la llamada a IA) — una degradación de UX innecesaria cuando la mayoría de esas llamadas van a resolver en mucho menos que el timeout. Paralelo sin límite dispararía hasta 21 llamadas simultáneas a la misma key de Pexels en el mismo instante, por una sola acción de un solo usuario — esto es un patrón de ráfaga nuevo que el proyecto no tenía antes de este ticket, y aumenta innecesariamente la probabilidad de pisar el rate limit del proveedor (compartido por key, no por receta) sin una ganancia de velocidad proporcional, porque el cuello de botella de una búsqueda con `per_page` chico es la latencia de red/ida y vuelta, no el trabajo del servidor de Pexels — un pool chico ya captura casi toda la ganancia de paralelizar. Un límite de 3 es una elección deliberada de punto medio, no derivada de un requisito del ticket: se documenta acá como parámetro configurable en código (constante, no variable de entorno) para que el explorer/implementer lo ubique en un único lugar.

Optimización recomendada (no obligatoria para los criterios de aceptación de este ticket, pero coherente con "no saturar el rate limit"): memoizar por query normalizada dentro de una misma operación de generación, para que si dos comidas de la misma semana generan el mismo título de receta, no se dispare una segunda llamada idéntica a Pexels.

**D4 — Ausencia o mala configuración de `PEXELS_API_KEY`: nunca lanzar excepción.**

A diferencia del adaptador de IA existente (que sí falla al construirse si falta su API key, porque sin ese proveedor no hay generación posible), el adaptador de Pexels debe construirse exitosamente sin importar si la key está presente o no. Cada intento de resolución de imagen debe verificar la presencia de la key **antes** de intentar cualquier request HTTP; si falta, el resultado es `image: null` inmediato, sin red, con un único warning saneado (ver sección 7), y el flujo de creación/confirmación de receta o plan continúa sin alteración. Esto es una divergencia deliberada del patrón existente, justificada porque Pexels es explícitamente opcional según el ticket ("la receta sigue siendo válida aunque... el proveedor no esté disponible"), mientras que el proveedor de IA es una dependencia dura.

### Alternativas consideradas

- **Resolver la imagen de forma perezosa en la primera lectura (GET)**: rechazada — el ticket prohíbe explícitamente recomputar/reemplazar en cada lectura, y esto reintroduciría un patrón de escritura-en-lectura que rompe la reproducibilidad que el ticket pide.
- **Limitar la búsqueda de imagen sólo a `origin: 'AI'`**: era la decisión original de D1 en la primera versión de este documento; **revertida** por corrección explícita de la usuaria dueña del ticket (ver nota de revisión en D1) — el alcance real es toda receta nueva, sin importar procedencia.
- **Resolución secuencial estricta**: rechazada por el costo de latencia acumulada en el camino crítico de generación (D3).
- **Resolución en paralelo sin límite**: rechazada por riesgo de ráfaga contra el rate limit compartido sin beneficio de velocidad proporcional (D3).
- **Llamar a Pexels dentro de la transacción de persistencia** (más simple de programar, un solo lugar): rechazada de forma dura por D2 — el costo en confiabilidad/latencia de conexión de base de datos no es aceptable.
- **Reintentos automáticos ante 429/5xx/timeout**: rechazada — el ticket pide explícitamente "un intento acotado... sin loop de retries"; un reintento agregaría latencia y riesgo de saturar el rate limit exactamente en el escenario (429) donde reintentar es más contraproducente.

### Consecuencias

- Columna nueva, nullable, sin default que requiera backfill: compatible hacia atrás con el contrato existente de `Recipe` de NUT-61/NUT-75.
- La generación de un plan por IA puede tardar, en el peor caso (todas las llamadas a Pexels agotan su timeout), hasta `ceil(N_recetas / 3) × timeout_pexels` adicionales — acotado y aceptable porque nunca depende de reintentos ni de esperas sin límite.
- Se introduce una nueva variable de entorno (`PEXELS_API_KEY`) cuya ausencia es un modo de operación válido y ya contemplado (el feature completo se degrada a no-op), no un error de despliegue.
- Las recetas manuales reciben el mismo tratamiento que las de IA (corrección de D1) — no hay ninguna rama de código que distinga por `origin` para decidir si se intenta la resolución de imagen.
- Ningún dato de Pexels (respuesta cruda, headers salientes, la key) debe tocar nunca los snapshots de `GenerationRun` (`profileSnapshot`/`requestSnapshot`/`outputSnapshot`/`validationSnapshot`) definidos en NUT-75 — el único lugar donde vive el resultado de Pexels es el campo `image` de `Recipe`.

## 2. Algoritmo de normalización de la query (determinístico)

Entrada: el título de la receta tal como va a persistirse (ya validado/trimeado por las reglas de DTO existentes del contrato de receta, si las hubiera) — esta normalización es adicional y específica para construir la query externa; no reemplaza ni modifica el `title` que se persiste en `Recipe`.

Transformaciones, en este orden exacto:

1. **Normalización Unicode NFKD** (`String.prototype.normalize('NFKD')`). Se elige NFKD (descomposición de compatibilidad, no sólo canónica) y no NFC/NFD/NFKC porque descompone tanto los caracteres acentuados estándar (ej. `é` → `e` + acento combinante) como variantes de compatibilidad (ligaduras, formas de ancho completo, etc.) que pueden aparecer en texto generado por IA o pegado por una persona usuaria — NFD sólo cubre la descomposición canónica y se queda corto ante esos casos; NFC/NFKC van en la dirección de composición, no sirven para aislar los acentos como marcas separables.
2. **Eliminar las marcas diacríticas combinantes** con la expresión regular de rango Unicode `̀-ͯ`, dejando sólo las letras base en ASCII. Esto reproduce, a nivel de aplicación, el mismo criterio que ya usa este dominio a nivel de base de datos para tratar acentos como ruido en comparaciones/búsqueda de recetas (vía la extensión `unaccent` de Postgres) — coherencia de criterio dentro del mismo dominio, no una convención nueva inventada para este ticket.
3. **Trim** de espacios al inicio y al final.
4. **Colapsar** cualquier secuencia de espacios en blanco internos (incluyendo tabs/saltos de línea) a un único espacio ASCII — mismo criterio de colapso ya usado por la utilidad de normalización de texto libre existente en el proyecto para otro campo.
5. **Lowercase** (`.toLowerCase()`, sin locale especial — los títulos de receta se asumen en español/inglés con alfabeto latino; si en el futuro se soportan scripts no latinos esto necesitará revisión, fuera de alcance acá).
6. **Concatenar** con el sufijo fijo literal usando un único espacio: `` `${normalizado} food recipe` ``. El sufijo en sí ya está en minúsculas, ASCII y sin espacios repetidos, así que no necesita pasar por los pasos anteriores.

El string resultante del paso 6 es, a la vez: (a) el valor del parámetro `query` enviado a Pexels, (b) el valor persistido verbatim en el campo `query` del `RecipeImage`, y (c) la clave usada para la memoización opcional de D3.

Casos borde a cubrir explícitamente en los tests:
- Título con acentos, mayúsculas irregulares y espacios múltiples/tabs — ej. `"  Ñoquis   de\tPapá  "` debe normalizar a `"noquis de papa food recipe"`.
- Título ya "limpio" (sin acentos, un solo case, un solo espacio) — el resultado no debe cambiar más allá de aplicar lowercase y el sufijo.
- Título compuesto sólo de espacios tras el colapso (no debería ocurrir si el contrato de receta exige título no vacío, pero la función de normalización no debe romperse si ocurre): el resultado degradado es `"food recipe"` — sigue siendo una query válida para enviar, no un motivo para cancelar la búsqueda.
- Llamar la función dos veces con el mismo input debe dar exactamente el mismo output (determinismo puro, sin estado ni reloj de por medio).

## 3. Algoritmo de selección del candidato

**Request:** `GET https://api.pexels.com/v1/search` con header `Authorization: <PEXELS_API_KEY>` (sin `Bearer`), parámetros `query=<query normalizada>`, `per_page=5`, `page=1`. No se envían `orientation`, `size`, `color` ni `locale` — el ticket no los pide y agregarlos introduciría restricciones no especificadas que podrían sesgar o vaciar innecesariamente los resultados. `per_page=5` es la interpretación concreta de "conjunto acotado de resultados": alcanza para tener margen si el primer candidato tiene forma inválida, sin pedir de más. Reafirmando la nota de contexto: no existe parámetro de "safe search" en la API real; no se envía ninguno.

**Validación de la respuesta HTTP antes de mirar candidatos:**
- Si el `fetch` mismo lanza por timeout (ver sección 4) → tratar como fallo de proveedor, `image: null`.
- Si el status no es `200` → no hay candidato válido, `image: null` (sin excepción de dominio). Distinguir para el logging (sección 7) entre `404` (tratado igual que "sin resultados": no es un evento de warning, es un resultado vacío esperado) y `429`/`5xx` (sí son eventos de warning, porque son fallos reales del proveedor o del rate limit).
- Si el body no puede parsearse como JSON, o si `photos` no es un array → respuesta inválida del proveedor, `image: null`, evento de warning (es una anomalía de contrato, no un "sin resultados" legítimo).
- Si `photos` es un array vacío → `image: null`, sin warning (es el caso documentado "sin resultados", no un error).

**Predicado de validez de un candidato** (se aplica a cada elemento de `photos`, en el orden en que Pexels los devuelve — ese orden es la relevancia que ya calculó el proveedor, y este diseño nunca reordena por su cuenta salvo el desempate explícito más abajo):
- Tiene `id` (número finito, no nulo).
- Tiene `src.large` (string no vacío).
- Tiene `url` (string no vacío).
- Tiene `photographer` (string no vacío).
- Tiene `photographer_url` (string no vacío).
- Tiene **dimensiones válidas**: `width` y `height` presentes, numéricos, enteros, y ambos **> 0**. No se exige ningún mínimo de resolución además de mayor a cero: el ticket no pide un piso de calidad específico, y Pexels es un banco curado de fotografía real — inventar un mínimo arbitrario (ej. 640px) descartaría candidatos legítimos sin ningún criterio de aceptación que lo respalde.

**Selección y desempate:** se recorre `photos[]` en el orden de la respuesta y se elige el primer elemento que cumple el predicado completo — la posición en el array ya es un orden total estricto, así que ese único recorrido ya es determinístico por sí mismo. El ticket pide, además, "desempate por id ascendente si la respuesta contiene candidatos equivalentes"; como la API real de Pexels no expone ningún score de relevancia, "candidatos equivalentes" no puede interpretarse como un empate de score — se interpreta y se define de forma concreta y testeable como: **si la respuesta contiene más de un elemento con el mismo `id`** (una anomalía del proveedor, no algo prometido por su contrato pero tampoco prohibido), esos duplicados se tratan como un único candidato antes de aplicar la regla de "primero por posición que sea válido" — el desempate por id ascendente queda satisfecho trivialmente porque, al ser el mismo `id`, no hay nada que desempatar más allá de no procesar el mismo candidato dos veces. Esta interpretación se deja documentada como la lectura correcta del punto del ticket dado el contrato real disponible, y es la que debe testearse con una respuesta simulada que contenga un `id` duplicado.

## 4. Resiliencia y manejo de errores

Patrón: un único intento por llamada, con `AbortController` + `setTimeout` (igual mecanismo que el ya usado para el proveedor de IA existente, pero con su propio timeout, más corto: una búsqueda simple no debería necesitar el mismo presupuesto que una generación). Se documenta un timeout de 5000 ms por intento como parámetro de este diseño — lo bastante corto para no inflar el camino crítico de la generación de plan con varias recetas en paralelo acotado (D3), lo bastante largo para no generar timeouts espurios bajo latencia de red normal de una API HTTP real. Ningún caso reintenta automáticamente.

Tabla de resultados, todos con el mismo desenlace de persistencia (`image: null`, nunca una excepción que rompa la creación/confirmación de la receta o del plan) pero distinto nivel/contenido de log:

| Caso | `image` | ¿Excepción de dominio? | ¿Log? |
|---|---|---|---|
| `PEXELS_API_KEY` ausente/vacía | `null` | No | `warn` saneado, sin request HTTP |
| 200 con `photos: []` | `null` | No | Ninguno (o `debug`, resultado esperado) |
| 200 con `photos` pero ningún candidato válido según el predicado | `null` | No | `warn` saneado (indica anomalía de forma del proveedor) |
| 404 | `null` | No | Ninguno (o `debug`, tratado igual que "sin resultados") |
| 429 | `null` | No | `warn` saneado con el status `429` |
| 5xx | `null` | No | `warn` saneado con el status recibido |
| Timeout (abort) | `null` | No | `warn` saneado indicando timeout |
| JSON inválido / `photos` no es array | `null` | No | `warn` saneado indicando respuesta inválida |

En todos los casos, la función de resolución de imagen tiene el mismo tipo de retorno (`RecipeImage | null`) y nunca lanza — es responsabilidad de quien la llama (la capa de servicio, fuera de la transacción, D2) simplemente pasar ese valor a la persistencia como un dato más.

## 5. Flujos

**Flujo A — Generación de un plan de comidas con recetas nuevas (origen IA):**
1. La IA genera el candidato de plan y pasa la validación de estructura/dominio existente (sin cambios de este ticket).
2. Para cada receta nueva del batch cuyo destino de persistencia es `origin: 'AI'`, la capa de servicio construye la query normalizada (sección 2) y dispara la resolución de imagen contra Pexels con concurrencia acotada a 3 (D3), cada una con su propio intento único acotado por timeout (sección 4). Esto ocurre enteramente antes de invocar la persistencia transaccional del plan (D2).
3. Cuando todas las resoluciones terminan (cada una ya devuelve `RecipeImage | null`, nunca lanza), la capa de servicio invoca la transacción de persistencia existente, pasándole el valor de `image` ya resuelto para cada receta como un dato plano adicional junto al resto de los campos de la receta.
4. La transacción crea el plan, los días, las comidas y las recetas — incluyendo el campo `image` — sin hacer ninguna llamada de red.

**Flujo B — Fallo del proveedor en cualquiera de sus formas (key ausente, sin resultados, 404, timeout, 429, 5xx, JSON inválido):**
1. La resolución de imagen para esa receta puntual devuelve `null` (nunca lanza).
2. El resto del batch de recetas de esa misma generación sigue su curso normal, con cada una resolviendo su propio resultado de forma independiente.
3. La persistencia transaccional recibe `image: null` para esa receta puntual y continúa exactamente igual que si Pexels hubiera devuelto un candidato válido — no hay ninguna rama especial de manejo de errores a nivel de transacción ni de confirmación de plan por esta causa. La generación/confirmación del plan **nunca** falla por un problema de Pexels.

**Flujo C — Lectura de una receta (existente o nueva):**
1. Cualquier camino de lectura existente de `Recipe` (detalle de plan, receta individual, listado) devuelve el campo `image` tal como está persistido, sin ninguna lógica adicional.
2. Nunca se recalcula, se sobreescribe ni se dispara una llamada a Pexels durante una lectura, bajo ninguna condición — ni siquiera si `image` es `null`. El campo `image` sólo se escribe una vez, en el momento de creación de la receta dentro del Flujo A, y nunca más.

## 6. Historias y criterios de aceptación

Cada historia sigue el mapeo 1:1 con "Pruebas mínimas" del ticket, más las adicionales requeridas por las decisiones de diseño (D1-D4) para que el diseño sea testeable de punta a punta.

1. **Query normalizada y sufijo fijo**
   Given un título de receta con acentos, mayúsculas mixtas y espacios irregulares,
   When se construye la query de búsqueda,
   Then el resultado es exactamente el string determinístico descrito en la sección 2, en minúsculas, sin acentos, con espacios colapsados, terminado en `" food recipe"`, y llamarlo dos veces con el mismo input produce el mismo output byte a byte.

2. **Selección reproducible con candidatos válidos**
   Given una respuesta simulada de Pexels con varios candidatos válidos en un orden dado,
   When se ejecuta la selección dos veces sobre el mismo body de respuesta,
   Then ambas ejecuciones eligen exactamente el mismo candidato, y ese candidato es el primero en el orden de la respuesta que cumple el predicado de validez de la sección 3.

3. **Respuesta 200 con imagen**
   Given Pexels responde 200 con al menos un candidato válido,
   When se resuelve la imagen para una receta nueva de origen IA,
   Then se persiste un `RecipeImage` con `provider: 'PEXELS'`, `providerPhotoId` = `id` del candidato, `imageUrl` = `src.large`, `sourceUrl` = `url`, `photographer`, `photographerUrl`, `alt`, la `query` exacta usada, y `retrievedAt` con una marca de tiempo ISO 8601 del momento de la resolución.

4. **Sin resultados**
   Given Pexels responde 200 con `photos: []`,
   When se resuelve la imagen,
   Then `image` queda en `null`, no se lanza ninguna excepción de dominio, y la receta/plan se persiste con normalidad.

5. **API key ausente**
   Given `PEXELS_API_KEY` no está configurada (vacía o ausente) al momento de la llamada,
   When se intenta resolver la imagen de cualquier receta de origen IA,
   Then no se realiza ningún request HTTP, `image` queda en `null`, se emite un único warning saneado sin ningún valor secreto, y la creación/confirmación de la receta y del plan se completa exitosamente de punta a punta.

6. **Timeout**
   Given Pexels no responde dentro del timeout configurado,
   When se resuelve la imagen,
   Then se realiza exactamente un intento (sin reintentos), `image` queda en `null`, se emite un warning saneado indicando timeout, y la persistencia del resto del plan continúa sin interrupción.

7. **429 (rate limit)**
   Given Pexels responde `429`,
   When se resuelve la imagen,
   Then `image` queda en `null` sin reintento, se emite un warning saneado con el status `429`, y la persistencia continúa sin interrupción.

8. **5xx**
   Given Pexels responde un status `5xx`,
   When se resuelve la imagen,
   Then `image` queda en `null` sin reintento, se emite un warning saneado con el status recibido, y la persistencia continúa sin interrupción.

9. **JSON inválido / forma de respuesta inválida**
   Given Pexels responde `200` con un body que no es JSON válido, o cuyo `photos` no es un array, o cuyos candidatos no cumplen el predicado de validez,
   When se resuelve la imagen,
   Then el candidato (o la respuesta completa) se descarta, se sigue evaluando el siguiente candidato válido si existe, y si ninguno lo es, `image` queda en `null` con un warning saneado indicando respuesta inválida del proveedor.

10. **Persistencia y lectura de `image`**
    Given una receta persistida con un `image` no nulo,
    When se lee esa receta por cualquier camino de lectura existente,
    Then se devuelve exactamente el objeto `image` persistido, sin cambios, y no se dispara ninguna llamada a Pexels durante la lectura.

11. **Receta existente sin imagen sigue devolviendo `image: null`**
    Given una fila de `Recipe` que ya existía antes de esta migración (o cualquier receta creada fuera del camino de resolución de imagen, ej. manual),
    When se lee,
    Then `image` es `null` por el default de columna nullable, sin ningún job de backfill ni cómputo en tiempo de lectura que la rellene.

12. **La respuesta pública nunca contiene `PEXELS_API_KEY`**
    Given cualquier respuesta HTTP pública que incluya una receta (detalle, listado, plan),
    When se inspecciona el body completo,
    Then no aparece el valor de la key ni ningún dato derivado del request saliente a Pexels en ningún campo; y, igualmente, ninguna línea de log emitida durante la resolución de imagen contiene el valor crudo de la key (verificable con un espía sobre el logger en los tests).

13. **Toda receta nueva intenta resolución de imagen, sin importar `origin`** (corregido — ver nota de revisión en D1)
    Given una receta nueva creada vía `POST /recipes` manual, vía edición/regeneración de plan (`PUT /meal-plans`), o vía generación inicial de plan por IA,
    When se persiste,
    Then en los tres casos se intenta la resolución de imagen (con el mismo algoritmo de query/selección/resiliencia de las secciones 2-4), y el resultado (`RecipeImage` o `null`) se persiste de la misma forma sin importar el valor de `origin`.

14. **La resolución de imagen ocurre fuera de la transacción de persistencia**
    Given una generación de plan que crea N recetas nuevas de origen IA,
    When se ejecuta la transacción de persistencia,
    Then esa transacción no realiza ninguna llamada de red — sólo recibe valores de `image` ya resueltos como datos planos — verificable a nivel unitario constatando que la función/método que abre la transacción no referencia ni invoca al adaptador de Pexels.

15. **Concurrencia acotada**
    Given una generación de plan con más recetas de origen IA que el límite de concurrencia configurado,
    When se resuelven las imágenes del batch,
    Then en ningún instante hay más de 3 llamadas a Pexels en curso simultáneamente (verificable con un mock que cuenta llamadas concurrentes), y todas las recetas del batch terminan con un `image` resuelto (candidato o `null`) antes de invocarse la transacción de persistencia.

16. **La migración aditiva no rompe el contrato existente de `Recipe`**
    Given el nuevo campo `image` agregado a `Recipe`,
    When cualquier consulta o serialización existente que lea una receta se ejecuta sin cambios,
    Then todos los campos previamente existentes siguen presentes con el mismo tipo, y la respuesta es compatible hacia atrás para cualquier consumidor que todavía no conozca `image`.

## 7. Seguridad de la API key

Reglas explícitas, sin excepción:

- El valor de `PEXELS_API_KEY` **nunca** aparece en: logs de la aplicación (en ningún nivel, incluido `debug`), la respuesta HTTP de ningún endpoint público, ningún snapshot de `GenerationRun` (`profileSnapshot`, `requestSnapshot`, `outputSnapshot`, `validationSnapshot`), ni ningún mensaje de excepción/error.
- Nunca se loguean los **headers salientes** del request a Pexels (eso incluiría el header `Authorization` con la key en texto plano). Sí es seguro loguear, cuando sea útil para diagnóstico: el **código de estado HTTP recibido** (`404`, `429`, `500`, etc.), la categoría de fallo (`missing_api_key`, `timeout`, `rate_limited`, `provider_error`, `invalid_response`), y la query normalizada usada (no contiene ningún dato sensible, es texto derivado del título de una receta).
- El warning saneado que exige el ticket para "key ausente" o fallo del proveedor se construye exclusivamente con los campos seguros del punto anterior — nunca con el objeto de configuración completo, nunca con el body crudo de la respuesta de Pexels, nunca con el request completo.
- Nunca se persiste la respuesta completa del proveedor: sólo los campos explícitamente mapeados al DTO `RecipeImage` (sección de contrato del ticket) llegan a la base de datos. El resto del body de la respuesta de Pexels (ej. `avg_color`, `liked`, `photographer_id`, dimensiones de otros tamaños de imagen) se descarta después de la selección del candidato y no se guarda en ningún lado.
- No se descargan ni se guardan bytes de imagen en ningún momento — sólo se persisten URLs y metadatos de atribución, tal como pide el ticket.

## 8. Estrategia de Prisma / migración

**Cambio de esquema:** agregar un único campo nullable al modelo `Recipe` existente, en el archivo de modelo existente donde ya vive ese modelo (sin tocar ningún otro campo):

```prisma
model Recipe {
  // ...todos los campos existentes, sin cambios...
  image Json?
}
```

Esto es 100% aditivo: no cambia el tipo ni la nulabilidad de ningún campo existente, no agrega ningún `@default` que requiera backfill (el default implícito de un campo `Json?` es `NULL`), y no agrega ni quita ningún índice o relación sobre campos existentes. Todo consumidor actual del contrato de `Recipe` sigue funcionando sin cambios, porque simplemente no conoce el campo nuevo.

**SQL de la migración aditiva** (a escribir a mano para revisión, siguiendo el protocolo de dos commits del proyecto — no se genera con `prisma migrate` ni se ejecuta en esta sesión ni contra ninguna base real):

```sql
ALTER TABLE "recipes" ADD COLUMN "image" JSONB;
```

Sin `NOT NULL`, sin `DEFAULT`: una sola sentencia `ADD COLUMN` nullable sobre una tabla existente es una operación de metadato en Postgres moderno (no reescribe filas, no requiere backfill, no toma un lock prolongado). No hay necesidad de una migración expand/contract de varias fases porque no se está reemplazando ni eliminando nada.

**Impacto esperado y rollback:** impacto nulo sobre filas existentes (quedan con `image = NULL`, que es exactamente el comportamiento esperado por el criterio de aceptación 11). El rollback, si hiciera falta, es `ALTER TABLE "recipes" DROP COLUMN "image";` — igualmente sin pérdida de datos para ningún otro campo, porque es una columna nueva y aislada.

**Confirmación de compatibilidad con el contrato de NUT-61/NUT-75:** el contrato de `Recipe` de NUT-61 (catálogo instruccional: `title`, `description`, `prepMinutes`, `cookMinutes`, `ingredients`, `instructions`) y las adiciones de NUT-75 (`origin`, `generationRunId`) no se modifican en absoluto; `image` es puramente un campo adicional nullable, coherente con cómo NUT-75 ya agregó sus propios campos sin tocar el contrato previo.

**DTO tipado del valor persistido** (no es un modelo de Prisma, es la forma que debe tener el JSON guardado en la columna, tal como la define el ticket):

```ts
type RecipeImage = {
  provider: 'PEXELS';
  providerPhotoId: string;
  imageUrl: string;
  sourceUrl: string;
  photographer: string;
  photographerUrl: string;
  alt: string;
  query: string;
  retrievedAt: string;
};
```

`image` es `RecipeImage | null` a nivel de aplicación; a nivel de columna es simplemente `JSONB | NULL`.

## 9. Alcance de esta iteración

**Dentro de alcance:** resolución de imagen vía Pexels para **toda receta nueva**, sin importar `origin` (IA o manual) ni el camino de creación (generación inicial de plan, edición/regeneración de plan, creación manual individual); normalización determinística de query; selección determinística de candidato con desempate documentado; persistencia de un único resultado por receta; degradación silenciosa ante cualquier fallo del proveedor (key ausente, sin resultados, 404, timeout, 429, 5xx, respuesta inválida); migración aditiva del campo `image`.

**Fuera de alcance (reafirmando lo que ya marca el ticket):**
- Generar imágenes con IA.
- Scraping directo de Google Images.
- Backfill masivo de recetas existentes.
- Selector manual de imágenes.
- Moderación avanzada de contenido.
- Descargar o servir archivos propios de imagen.

**Ya NO está fuera de alcance (corrección posterior):** la primera versión de este documento excluía la creación manual de recetas (`POST /recipes`) y los flujos de edición/regeneración de plan. La usuaria dueña del ticket corrigió esa lectura — ver nota de revisión en D1. Esos caminos ahora están dentro de alcance, con el mismo comportamiento que el camino de generación por IA.
