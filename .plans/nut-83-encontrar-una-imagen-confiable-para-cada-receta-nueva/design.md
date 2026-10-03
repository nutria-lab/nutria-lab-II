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

## 10. Reconciliación con la checklist de release/evidencia del proyecto

Corrección posterior a una revisión externa de PR: esta sección responde explícitamente a la checklist de "antes de merge/release" del proyecto (verificar issue vinculado, criterios de aceptación, tests/CI, seguridad de migración, exposición de secretos, impacto de accesibilidad, ruta de rollout/rollback), que no se había reconciliado de forma explícita hasta ahora.

- **Issue de Linear vinculado:** NUT-83. No se pudo citar/enlazar por API en esta sesión (el MCP de Linear no está autorizado); queda como verificación manual de quien suba el PR.
- **Criterios de aceptación:** las 16 AC de la sección 6 de este documento, cada una mapeada 1:1 a un test (ver `plan.md`).
- **Tests/CI:** 318 tests en verde (`cd apps/api && npx jest`), suite completa del proyecto, sin regresiones.
- **Seguridad de la migración:** aditiva (`image Json?` nullable, sin `DEFAULT`/`NOT NULL`, sin backfill necesario — sección 8), **regenerada con `prisma migrate dev --create-only`** (corrección de revisión de PR: la primera versión de esta migración se había escrito a mano, violando el protocolo de generación/revisión documentado del proyecto; se regeneró con la herramienta real sobre la base de desarrollo local de la usuaria, con su consentimiento explícito para el reset que eso requirió), aplicada y verificada sólo contra esa base local — pendiente de aprobación de TL para cualquier ambiente compartido.
- **Exposición de secretos:** sección 7 (nunca la key, nunca headers salientes, nunca el body crudo del proveedor); verificado con tests que inspeccionan cada log emitido en todos los caminos de fallo.
- **Impacto de accesibilidad:** no aplica — este cambio es exclusivamente de backend (API + esquema), sin ningún componente de UI/frontend en su alcance.
- **Ruta de rollout:** aplicar la migración (aditiva, sin downtime) tras aprobación de TL; el código que la consume ya está detrás de la misma migración, no hace falta una secuencia de despliegue en fases.
- **Ruta de rollback:** `ALTER TABLE "recipes" DROP COLUMN "image";` — sin pérdida de datos de ningún otro campo (columna nueva y aislada, ver sección 8).

**Nota sobre `AGENTS.md`:** una revisión de PR señaló que el `AGENTS.md` de la raíz del repo no se había leído explícitamente en el flujo de esta sesión (los agentes leyeron `CLAUDE.md` en su lugar). Verificado con `diff`: ambos archivos son **byte a byte idénticos** — `CLAUDE.md` es la copia para agentes Claude, `AGENTS.md` la copia equivalente para agentes Codex (el propio archivo lo dice: "Codex does not provide per-agent writable-path allowlists"). No hay ninguna guía que se haya omitido en sustancia.

## 11. Revisión posterior — cambio de proveedor: Pexels → Unsplash, y disciplina de comentarios

Corrección decidida por la usuaria dueña del ticket después de la primera implementación completa (que ya había pasado 2 rondas de revisión de PR con Pexels como proveedor). Dos cambios, ambos retroactivos a todo lo ya construido en las secciones anteriores:

### 11.1 Disciplina de comentarios (aplica a todo el código de este ticket, no sólo al cambio de proveedor)

Hallazgo de la usuaria, verificado como real (ejemplo concreto: un bloque JSDoc de 26 líneas documentando un solo test de 14 líneas, y un patrón similar en varios otros archivos de esta sesión): **el código quedó sobre-comentado, con más líneas de comentario que de código en varios bloques.** Regla a partir de esta revisión, para todo el código tocado por el cambio de proveedor (y deseable para el resto, aunque no se reescribe retroactivamente lo que no se toca): un comentario explica **por qué** una decisión no es obvia desde el código mismo (una regla de negocio, una lección aprendida de un bug real, una limitación externa) — nunca repite en prosa lo que el código ya dice con sus propios nombres. Ningún bloque de comentario debería superar, como heurística aproximada, el tamaño del código que describe. Las referencias a secciones de `design.md`/números de AC se mantienen cuando agregan trazabilidad real, pero sin reexplicar en el comentario lo que la firma de la función y el propio código ya comunican.

### 11.2 Unsplash reemplaza a Pexels — contrato completo nuevo

**Decisión: reemplazo total, no un segundo proveedor configurable.** El módulo `pexels/` (incluyendo el nombre de la carpeta, la clase, los archivos, los tests) deja de existir; nace `unsplash/` en su lugar, mismo rol arquitectónico (mismo punto de integración en `plans.service.ts`/`recipe.service.ts`, misma regla D2 de nunca llamar en una transacción, misma concurrencia acotada D3, mismo contrato público `RecipeImage` con `provider: 'UNSPLASH'` en vez de `'PEXELS'`). **`Recipe.image Json?` no cambia** — sigue siendo el mismo campo, la migración de la sección 8 de este documento sigue siendo válida tal cual (nadie modifica el schema de `Recipe` por este cambio).

**Contrato real de Unsplash (verificado contra la documentación oficial, no asumido):**
- Endpoint: `GET https://api.unsplash.com/search/photos`.
- Header: `Authorization: Client-ID <UNSPLASH_ACCESS_KEY>` — nunca el Secret Key (no hace falta para búsqueda pública; no se usa en ningún lado del backend).
- Parámetros: `query` (la misma query normalizada de la sección 2, sin cambios en el algoritmo de normalización), `page=1`, `per_page=5` (igual que antes), `order_by=relevant`, `content_filter=high`.
- Selección de candidato: se conserva el mismo criterio de la sección 3 (primer resultado válido según el orden que ya devuelve el proveedor, sin reordenar) — sólo cambian los nombres de campo del candidato: `id`, `urls.regular` (reemplaza a `src.large`), `links.html` (reemplaza a `url`), `user.name` (reemplaza a `photographer`), `user.links.html` (reemplaza a `photographer_url`). `alt_description` reemplaza a `alt`; si viene vacío o ausente, se genera un texto de reemplazo determinístico: `` `Imagen ilustrativa de ${título}` `` (el título original de la receta, no la query normalizada).
- Mapeo al contrato público `RecipeImage` (sin cambios de forma, sólo de origen de los valores): `provider: 'UNSPLASH'`, `providerPhotoId: String(id)`, `imageUrl: urls.regular`, `sourceUrl: links.html`, `photographer: user.name`, `photographerUrl: user.links.html`, `alt`, `query`, `retrievedAt`.

**Requisito nuevo, sin equivalente en Pexels: registrar el "uso" de la foto (`download_location`).** Unsplash exige, como condición de uso de su API, notificar cuando una foto se usa realmente (no sólo se busca) — vía un `GET` al `download_location` que la propia respuesta de búsqueda incluye por candidato (`links.download_location`). Reglas de este diseño:
- Se dispara **una sola vez**, en el momento en que un candidato queda elegido para una receta (dentro del mismo flujo de resolución, fuera de la transacción de Prisma — D2 no cambia) — nunca en una lectura/GET posterior de la receta (mismo principio ya establecido: `image` no se recalcula ni se re-dispara nada en lecturas).
- Es una llamada de **fire-and-forget respecto al resultado de la receta**: si falla (timeout, 401/403, 429, 5xx), la receta se crea/persiste igual con la imagen ya elegida — un fallo de tracking nunca bloquea ni revierte la asociación de la imagen en sí.
- "Debe quedar identificado para recuperación" (texto del ticket) **sin agregar ninguna columna nueva** (decisión explícita del ticket: "sin introducir otra columna sólo por cambiar de proveedor"): se resuelve con un log de nivel `error` (no `warn`, a diferencia de los fallos "normales" de búsqueda) que incluye el `providerPhotoId` y la URL de `download_location` que falló — suficiente para que una herramienta de alertas/logs externa identifique y, si hace falta, reintente manualmente. `download_location` en sí y el resultado del tracking **nunca** llegan al contrato público `RecipeImage` ni a ningún snapshot de `GenerationRun` — son enteramente internos a la llamada.
- No se reintenta automáticamente (mismo criterio ya establecido para la búsqueda en sí: un intento acotado, sin loop de reintentos) — reintentar tracking es responsabilidad de quien atienda el log de error, no del request original.

**Resiliencia:** mismo patrón y misma tabla que la sección 4 de este documento (timeout de punta a punta cubriendo la lectura completa del cuerpo — corrección ya aplicada tras el bug real de la revisión de PR anterior, sigue vigente sin cambios en el mecanismo), adaptada a los códigos reales de Unsplash: 401/403 (key inválida o sin permisos — mismo tratamiento que un fallo de proveedor, `image: null`, warning con el status, nunca la key), 429, timeout, 5xx, resultados vacíos, respuesta inválida. La ausencia de `UNSPLASH_API_KEY`... (nombre real de la variable: `UNSPLASH_ACCESS_KEY`) sigue sin lanzar nunca, igual que D4 ya establecía para el proveedor anterior — el nombre del proveedor cambia, la regla no.

**Seguridad de la key:** mismas reglas de la sección 7, sin cambios de principio — nunca en logs, nunca en la respuesta pública, nunca en snapshots. El header cambia de forma (`Client-ID <key>` en vez del header crudo que usaba Pexels) pero la regla de "nunca loguear el header de autorización completo" sigue aplicando igual.

**Pruebas adicionales específicas de este cambio:** mapeo completo de la respuesta de Unsplash al contrato `RecipeImage`; parámetros exactos de la búsqueda (`order_by`, `content_filter` incluidos, no sólo `query`/`per_page`); el tracking se dispara exactamente una vez por asociación (no en relecturas); una confirmación repetida (mismo `Idempotency`/recreación) no duplica el evento de tracking; ausencia de la key y del valor de `download_location` en cualquier log o respuesta pública, en todos los escenarios de fallo.

## 12. Revisión mayor — tracking post-persistencia, validación de URLs, cuota y recuperación

Esta sección responde a una revisión real de PR/TL sobre la implementación que ya existe (no es diseño previo a construir). Antes de escribir esta sección se verificó contra el código real del módulo Unsplash y sus consumidores — no se asumió nada de lo que sigue. Los hallazgos de esa verificación se citan explícitamente en 12.1 porque cambian el tono de varias decisiones: esto no es "falta pulir", son bugs reales que hoy hacen que la feature no funcione con datos reales, y un hueco de seguridad real (header `Authorization` enviado sin validar el host de destino).

### 12.1 Qué cambia de las secciones 1-11, qué se mantiene, y qué se verificó como bug real

**Se mantiene sin cambios:**
- D1 (toda receta nueva, sin importar `origin`) — sigue vigente, el código ya lo implementa así en ambos caminos de creación.
- D2 (nunca red dentro de una transacción Prisma) — sigue vigente como regla dura, pero su alcance se **reinterpreta** en 12.5: "nunca dentro de un `$transaction`" no es lo mismo que "nunca después de persistir, dentro del mismo método de servicio". El tracking pasa a vivir en esa segunda franja.
- D3 (concurrencia acotada a 3) — se mantiene el valor y el mecanismo (`resolveWithBoundedConcurrency`, constante de código), y se extiende su uso al nuevo paso de tracking post-persistencia (12.5) y a la recuperación (12.6), con el mismo razonamiento: la cuota de la API es por key, no por tipo de llamada.
- D4 (ausencia de key nunca lanza excepción) — sigue vigente sin cambios.
- Algoritmo de normalización de query (sección 2) — sin cambios.
- Forma general del algoritmo de selección "primer candidato válido por posición, duplicados por `id` colapsados" (sección 3) — se mantiene el mecanismo; cambia el tipo de `id` y se agregan dos requisitos nuevos al predicado de validez (12.2) y una etapa nueva de validación de URL/dominio (12.3).
- El contrato público `RecipeImage` de 9 campos (sección 8 / 11.2) — **no cambia su forma**. Lo que cambia es que ahora coexiste, sólo a nivel de persistencia, con metadata privada adicional (12.5) que nunca debe llegar a este contrato.
- `Recipe.image Json?` como columna — no se toca el schema ni se agrega ninguna migración nueva. La metadata de tracking vive dentro del mismo JSON ya aprobado.

**Cambia (bugs confirmados contra el código real, no hipótesis):**
1. **Tipo de `id`.** El código hoy declara `UnsplashCandidate.id: number` y `isValidCandidate` exige `typeof record.id !== 'number'` para rechazar. La documentación oficial de Unsplash confirma que `id` es un string (ej. `"LBI7cgq3pbM"`). Con una respuesta real de la API, **ningún candidato pasa nunca esta validación** — el resultado es `image: null` siempre, para toda receta, incondicionalmente. Esto no es un caso borde: es la ruta feliz completa rota. Se corrige en 12.2.
2. **`links.download_location` no se valida como requisito de forma.** El tipo ya lo declara (`links: { html: string; download_location: string }`) pero `isValidCandidate` sólo verifica `links.html`; un candidato con `download_location` ausente o vacío pasa igual la validación de forma y recién explota más tarde, al intentar el tracking. Se corrige en 12.2.
3. **No existe ninguna validación de HTTPS/dominio.** Ningún campo de URL del candidato (`urls.regular`, `links.html`, `user.links.html`, `links.download_location`) se valida contra un dominio esperado antes de usarse. El header `Authorization: Client-ID <key>` se envía hoy, sin condición, al host que venga en `candidate.links.download_location` — si ese valor viniera corrompido, mal formado, o (en un escenario de proveedor comprometido/respuesta manipulada) apuntando a un host arbitrario, la key saldría igual hacia ese host. Se corrige en 12.3.
4. **No se agrega UTM a `sourceUrl`/`photographerUrl`.** El código asigna `links.html` y `user.links.html` verbatim. Se corrige en 12.4.
5. **El tracking ocurre en el momento equivocado.** Hoy `resolveCandidate` llama a `trackDownload` **antes de que la receta exista en la base de datos** (la búsqueda completa, incluido el tracking, se resuelve en `RecipeService.create`/`PlansService` antes de invocar la persistencia). Esto viola el ticket actualizado de dos formas: (a) se trackea un "uso" que todavía podría no llegar a persistirse nunca (si la escritura subsiguiente falla, Unsplash ya registró un uso de una foto que la aplicación nunca terminó de asociar), y (b) no existe ningún estado `PENDING`/`SUCCEEDED`/`FAILED` persistido — el resultado del tracking no se guarda en ningún lado, sólo se loguea. Se corrige en 12.5.
6. **No hay manejo de cuota.** El código no lee `X-Ratelimit-Remaining` en ningún lugar; cada llamada se intenta sin importar cuántas quedan disponibles. Se corrige en 12.7.
7. **401/403 no tienen tratamiento distinto de cualquier otro status no-200.** Hoy producen el mismo warning genérico ("Unsplash responded with unexpected status X") que un 500 o un 429. Se corrige en 12.7.
8. **No existe filtrado de DTO para `image`.** `RecipeRepository.findAll` (vía `$queryRaw`), `RecipeRepository.findById` (vía `prisma.recipe.findUnique`) y `RecipeService.create` (que devuelve directamente lo que `repository.create` resuelve) exponen la columna `image` completa, sin ningún mapeo intermedio. Hoy esto no filtra nada "privado" porque hoy no existe metadata privada — pero en cuanto 12.5 agregue el objeto `tracking` dentro del JSON, estos tres caminos filtrarían metadata interna a clientes públicos si no se corrige. Se corrige en 12.5.4.

### 12.2 `UnsplashCandidate` y `isValidCandidate` corregidos

```ts
export type UnsplashCandidate = {
  id: string; // antes: number — Unsplash lo devuelve como string (ej. "LBI7cgq3pbM")
  urls: { regular: string };
  links: { html: string; download_location: string };
  user: { name: string; links: { html: string } };
  alt_description?: string | null;
  width: number;
  height: number;
  [key: string]: unknown;
};
```

Predicado de validez, en este orden (cada paso que falla descarta el candidato completo — mismo criterio "se descarta y se sigue probando el siguiente" ya establecido en la sección 3, sin excepción nueva):

1. `id`: `typeof === 'string'` y `length > 0` (reemplaza la validación numérica).
2. `urls.regular`: string no vacío.
3. `links.html`: string no vacío.
4. `links.download_location`: string no vacío — **requisito nuevo** (fix #2 de la lista de la revisora). Sin esto, un candidato puede quedar seleccionado y persistido, y recién fallar cuando el flujo de tracking post-persistencia (12.5) intenta usarlo — mejor descartarlo en el momento de selección, igual que cualquier otro campo requerido, que descubrir el hueco varios pasos después.
5. `user.name`: string no vacío.
6. `user.links.html`: string no vacío.
7. `width`, `height`: enteros positivos (sin cambios).
8. **Validación de URL/dominio de los cuatro campos de URL** (`urls.regular`, `links.html`, `user.links.html`, `links.download_location`) — ver 12.3. Se ejecuta como el último paso del mismo predicado, no como una etapa separada: un candidato que falla esta validación es, para todos los efectos de `selectUnsplashCandidate`, un candidato inválido como cualquier otro, y el recorrido continúa con el siguiente elemento del array.

Deduplicación por `id` repetido dentro de la misma respuesta (`Set<string>` en vez de `Set<number>`) — mismo mecanismo y mismo razonamiento de la sección 3, sólo cambia el tipo del `Set`.

**Fixtures de test:** todo fixture de respuesta de Unsplash usado en los tests de este módulo debe reconstruirse con la forma real de la API — `id` como string real (ej. `"LBI7cgq3pbM"`, `"eOLpJytrbsQ"`), `urls.regular` con parámetros de query reales incluyendo `ixid` (ej. `https://images.unsplash.com/photo-...?ixid=...&...`), `links.download_location` apuntando a `https://api.unsplash.com/photos/<id>/download?ixid=...`. Ningún fixture existente con `id` numérico es válido después de este cambio; se reemplazan, no se mantienen en paralelo.

### 12.3 Validación de URL/dominio (nueva etapa)

Función única, reutilizada en los dos lugares donde el código envía el header `Authorization` o persiste una URL del proveedor (selección de candidato y, más adelante, cualquier llamada de tracking/recuperación) — una sola fuente de verdad para "¿este host es de confianza?", para que ambos puntos de chequeo no puedan divergir con el tiempo:

```ts
function isValidUnsplashUrl(value: unknown, expectedHost: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && parsed.hostname === expectedHost;
}
```

- **"HTTPS"** significa exactamente `parsed.protocol === 'https:'` después de parsear con el `URL` nativo de Node/WebPlatform — no una comprobación de substring sobre el string crudo. Usar el parser real evita trucos de userinfo (`https://api.unsplash.com@evil.com/...`, donde `new URL(...).hostname` resuelve correctamente a `evil.com`, no a `api.unsplash.com`) y cualquier otra ambigüedad de parseo manual.
- **Dominios exactos por campo** (comparación de igualdad estricta sobre `hostname`, sin wildcard de subdominio, sin normalizar `www.`):
  - `urls.regular` → `images.unsplash.com`
  - `links.html` → `unsplash.com`
  - `user.links.html` → `unsplash.com`
  - `links.download_location` → `api.unsplash.com`
- **Qué pasa si falla:** el candidato completo se descarta (paso 8 del predicado de 12.2) y `selectUnsplashCandidate` continúa con el siguiente elemento del array — exactamente el mismo criterio ya usado para cualquier otro campo de forma inválida (sección 3), sin una rama de manejo de error distinta.
- **Regla dura sin excepción:** el header `Authorization: Client-ID <key>` **nunca** se adjunta a un `fetch` cuyo host de destino no haya pasado `isValidUnsplashUrl` con el `expectedHost` correspondiente a ese campo, inmediatamente antes de ese `fetch` — no sólo en el momento de selección del candidato. Esto importa especialmente para el tracking post-persistencia (12.5) y la recuperación (12.6): ambos leen `trackingUrl` de vuelta desde la base de datos (no desde la respuesta fresca de Unsplash), así que revalidan el host en ese momento también, en vez de confiar en que el valor persistido sigue siendo seguro sólo porque lo era cuando se escribió. Defensa en profundidad, no una optimización: un valor persistido es un dato más, no una fuente de confianza transitiva.

### 12.4 Agregado de UTM a `sourceUrl`/`photographerUrl` (`imageUrl` no se toca)

```ts
function withAttributionUtm(url: string): string {
  const parsed = new URL(url); // ya pasó isValidUnsplashUrl antes de llegar acá
  parsed.searchParams.set('utm_source', 'nutria');
  parsed.searchParams.set('utm_medium', 'referral');
  return parsed.toString();
}
```

- Se aplica a `sourceUrl` (origen: `links.html`) y a `photographerUrl` (origen: `user.links.html`) en el momento de construir el `RecipeImage` público, después de que esas URLs ya pasaron la validación de 12.3.
- Se usa `URLSearchParams.set`, no `append`: si por cualquier motivo la URL ya trajera un `utm_source`/`utm_medium` propio, `set` lo reemplaza en vez de producir dos valores conflictivos para la misma clave. Cualquier otro parámetro existente (no `utm_source`/`utm_medium`) se conserva intacto porque `URLSearchParams` sólo toca las claves que se le pide tocar.
- `imageUrl` (origen: `urls.regular`) **no pasa por esta función** — se persiste exactamente como lo entrega Unsplash, conservando `ixid` y cualquier otro parámetro, tal como exige el ticket ("URLs de imagen originales, conservando parámetros e ixid; no descargar bytes ni servir copias propias").

### 12.5 Arquitectura del tracking post-persistencia

#### 12.5.1 Forma exacta del JSON ampliado de `Recipe.image`

```ts
// Contrato público — sin cambios de forma, sigue siendo exactamente esto en cualquier DTO:
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

// Metadata privada — sólo existe dentro de la columna persistida, nunca en un DTO:
type UnsplashTrackingMetadata = {
  trackingUrl: string;              // el download_location exacto usado/a usar
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  lastAttemptAt: string | null;     // ISO 8601 UTC; null hasta el primer intento
};

// Forma real de la columna Recipe.image (JSONB | NULL):
type PersistedRecipeImage = RecipeImage & { tracking: UnsplashTrackingMetadata };
```

**Decisión de forma — namespace anidado (`tracking: {...}`), no campos sueltos al mismo nivel que el contrato público.** Razonamiento: el proyecto no tiene un precedente idéntico (columna JSON con metadata pública + privada en el mismo objeto), pero sí tiene un precedente de criterio directamente aplicable — `buildProfileSnapshot`/`buildRequestSnapshot` (NUT-75) ya construyen sus snapshots por **lista blanca explícita**, nunca por *spread* del objeto fuente, precisamente para que sea imposible filtrar un campo no contemplado por accidente. Anidar la metadata privada bajo una única clave (`tracking`) refuerza ese mismo criterio desde la forma del dato: hace visualmente obvio, en cualquier lugar del código que toque este JSON, que hay una sección que no es parte del contrato — mucho más difícil de omitir sin querer que si `trackingUrl`/`status`/`lastAttemptAt` estuvieran al mismo nivel que `provider`/`imageUrl`/etc., donde un `...image` descuidado los arrastraría igual.

**Función única de mapeo público, reutilizada en todo camino de lectura/escritura que responda al cliente:**

```ts
function toPublicRecipeImage(persisted: PersistedRecipeImage | null): RecipeImage | null {
  if (!persisted) return null;
  const { tracking, ...publicFields } = persisted;
  return publicFields;
  // o, más explícito y a prueba de que alguien agregue un campo privado nuevo sin tocar
  // esta función: construir el objeto de salida con las 9 claves nombradas una por una,
  // igual que buildProfileSnapshot/buildRequestSnapshot. Cualquiera de las dos formas
  // cumple el contrato; la segunda es más robusta a futuro y es la preferida si el costo
  // de escribir 9 líneas no se considera excesivo — decisión de implementación, no de diseño.
}
```

Este mapeo debe aplicarse, sin excepción, en: la respuesta de `POST /recipes` (hoy `RecipeService.create` devuelve el resultado crudo de `repository.create` — hay que envolverlo), `GET /recipes` (lista, hoy vía `$queryRaw` sin mapeo), `GET /recipes/:id` (hoy vía `findUnique` sin mapeo), y cualquier respuesta de plan que incluya una receta embebida con su `image`. Ningún snapshot de `GenerationRun` (`profileSnapshot`/`requestSnapshot`/`outputSnapshot`/`validationSnapshot`) toca hoy el campo `image` de `Recipe` — se confirmó revisando esos constructores — así que no hay una ruta de fuga ahí, pero se deja documentado como invariante a vigilar si alguna vez un snapshot futuro decidiera incluir datos de receta.

**Decisión sobre `RecipeRepository.findAll` (`$queryRaw`):** se mantiene trayendo la columna `image` completa (incluyendo `tracking`) en el resultado del `$queryRaw`, y se filtra en la capa de servicio con `toPublicRecipeImage` antes de serializar la respuesta — no se intenta que el propio SQL proyecte sólo los campos públicos del JSON. Razonamiento: proyectar sólo los 9 campos públicos directamente en SQL (vía `jsonb_build_object(...)` o similar) obligaría a duplicar, en SQL, la lista exacta de claves del contrato `RecipeImage` — una segunda fuente de verdad que hay que mantener manualmente en sincronía con el tipo TypeScript cada vez que el contrato cambie, sin ningún chequeo de tipos que avise si se desincroniza. El `$queryRaw` ya trae la fila completa por otras razones (paginación, el resto de las columnas), así que no hay ninguna ganancia de performance en no traer `image` completo tampoco — el costo adicional es cero. Filtrar en TypeScript, con una única función reutilizada y testeada una vez, es estrictamente más simple y más seguro.

#### 12.5.2 Cuándo se dispara exactamente la actualización de tracking

Se divide la resolución de imagen en dos funciones con responsabilidades distintas, donde hoy existe una sola (`resolveCandidate`, que hace búsqueda + selección + tracking junto):

1. **Búsqueda + selección** (sin tracking): construye la query, llama a `GET /search/photos`, selecciona el candidato válido (12.2-12.3), y arma el `PersistedRecipeImage` completo **con `tracking.status = 'PENDING'`, `tracking.lastAttemptAt = null`, `tracking.trackingUrl = candidate.links.download_location`**. Esto sigue ocurriendo, como hoy, **antes** de la transacción/escritura que crea la receta (D2 sin cambios: esto es la misma llamada de red "búsqueda" que ya vivía fuera de la transacción).
2. **Persistencia:** la receta (o el batch de recetas de un plan) se crea con ese `image` ya armado — incluyendo el `tracking` en estado `PENDING` — dentro de la misma operación de escritura que ya existe hoy (un `prisma.recipe.create` suelto para creación manual; la transacción existente de persistencia de plan para el batch). Esta escritura **no hace red** — sigue siendo sólo datos planos, D2 se cumple exactamente igual que antes, porque agregar un sub-objeto `tracking` al JSON no es una llamada de red, es más JSON.
3. **Tracking:** inmediatamente después de que esa escritura de persistencia resuelve (el `await` de `repository.create(...)` o de la transacción de plan termina), **en el mismo método de servicio, todavía dentro del mismo ciclo de vida de la request HTTP, pero fuera de cualquier `$transaction`**, se invoca el `download_location` para cada receta que quedó con un `image` no nulo. Por cada una: fetch con `AbortController`/timeout (mismo mecanismo de sección 4), revalidación de host (12.3) antes de adjuntar el header, y según el resultado, una **segunda escritura** — `prisma.recipe.update({ where: { id }, data: { image: {...mismo objeto, tracking: {...,status:'SUCCEEDED'|'FAILED', lastAttemptAt: new Date().toISOString()} } } })` — por receta, suelta, **no** envuelta en un `$transaction` nuevo (ni individual ni batcheada): cada receta se actualiza de forma independiente para que el timeout o el fallo de tracking de una no bloquee ni condicione la actualización de las demás del mismo batch.

**Por qué se espera (`await`) el tracking antes de responder al cliente HTTP, en vez de dispararlo y no esperarlo ("fire and forget" respecto de la request):** el backend se despliega en Vercel (`.ai/architecture.md`), donde una función serverless puede cortar su ejecución una vez que la respuesta HTTP ya se envió — un `fetch` no esperado lanzado después de `return` corre el riesgo real de quedar cancelado a mitad de camino, lo cual volvería **inevitable** (no sólo posible ante una caída real) que casi todo tracking terminara en `PENDING` y dependiera siempre del mecanismo de recuperación (12.6) para completarse. Esperar el tracking dentro del mismo método de servicio, antes de responder, es compatible con D2 (D2 prohíbe red *dentro de un `$transaction` de Prisma*, no prohíbe red *después* de que la escritura de persistencia ya resolvió, dentro del mismo método) y es lo que permite además que la evidencia de demo del ticket (punto 8, fuera de diseño pero mencionado en alcance) pueda mostrar `SUCCEEDED` inmediatamente después de un `POST /recipes` real, sin depender de correr la recuperación manualmente.

**Qué pasa si el proceso muere entre persistir la receta y completar el tracking:** la fila ya quedó escrita con `tracking.status = 'PENDING'` en el mismo paso 2 (la persistencia), **antes** de que el tracking se intente siquiera — así que un crash en cualquier punto entre el fin del paso 2 y el fin del paso 3 deja la fila exactamente en el estado que el mecanismo de recuperación (12.6) sabe interpretar como "falta intentar", sin necesidad de ninguna escritura adicional de "marcar como pendiente" porque esa marca ya se escribió como parte natural de crear la receta. Esto es intencional: el estado inicial `PENDING` nunca depende de una segunda escritura exitosa para existir.

**Batch de plan — bounded concurrency reutilizada:** cuando una generación/regeneración de plan crea N recetas nuevas, el paso 3 (tracking) se ejecuta con el mismo `resolveWithBoundedConcurrency`/límite de 3 ya usado para la búsqueda (D3) — mismo razonamiento: la cuota es compartida por key, no por tipo de llamada, así que no tiene sentido acotar las búsquedas a 3 concurrentes y después lanzar hasta 21 tracking calls en paralelo sin límite.

**Recetas reutilizadas (`origin` existente, sin receta nueva):** cuando un plan referencia una receta ya existente en el catálogo (no se crea una fila `Recipe` nueva), ni la búsqueda ni el tracking se disparan — esto ya es así hoy porque la resolución de imagen sólo está conectada a los caminos de creación de receta nueva, nunca al camino de "asociar receta existente a una comida". Se deja como invariante explícito a testear (no a implementar de nuevo): una receta reutilizada no genera ninguna llamada a Unsplash, de búsqueda ni de tracking.

**Dos recetas distintas que comparten el mismo candidato (misma query normalizada, dentro del mismo batch):** la búsqueda se sigue deduplicando por query normalizada (D3, sin cambios) — las dos recetas comparten el mismo candidato resuelto. El **tracking no se deduplica entre recetas distintas**: cada receta dispara su propio `download_location`, aunque dos recetas terminen apuntando al mismo `providerPhotoId`. Razonamiento: el ticket define el evento de tracking como "asociar una foto a **una receta**" — son dos asociaciones reales y distintas (dos filas de `Recipe` distintas usando la misma foto), no la misma asociación leída dos veces; la única deduplicación que el ticket pide explícitamente es la de "confirmar el mismo borrador ya asociado" (la misma receta, dos veces), que es un caso distinto (12.5.3). No hay evidencia en el ticket de que haya que tratar "misma foto, dos recetas" como un evento único, y tratarlo como dos eventos es la lectura más simple y más alineada con los términos de uso reales de Unsplash (cada lugar donde la foto se muestra de forma nueva es un uso nuevo).

#### 12.5.3 Receta/borrador ya asociado — no reenviar el evento

Si una receta ya persistida tiene `image.tracking.status === 'SUCCEEDED'`, ningún camino del sistema debe volver a invocar `download_location` para ella — ni una relectura (ya es así: las lecturas nunca tocan Unsplash, sección 5), ni una futura confirmación de borrador de NUT-73 (fuera de alcance de implementación en este ticket, pero el principio se deja documentado para cuando exista: el momento de "confirmar un borrador" no es un momento de "nueva asociación" si el borrador ya tenía `image` con `tracking.status` distinto de ausente — confirmar reutiliza el `image` tal cual está, no dispara nada nuevo). La recuperación (12.6) refuerza esto estructuralmente: su query sólo trae filas `PENDING`/`FAILED`, así que una fila `SUCCEEDED` es estructuralmente invisible para el mecanismo de reintento, no por una condición `if` que alguien podría olvidar sino porque la consulta misma no la selecciona.

#### 12.5.4 Qué pasa si el tracking falla

Sin cambios de principio respecto de lo ya implementado para el caso de fallo: la receta y la imagen elegida se conservan tal cual (nunca se revierte la asociación de imagen por un fallo de tracking), se escribe `tracking.status = 'FAILED'` y `tracking.lastAttemptAt` con la escritura suelta del paso 3, y se emite un warning saneado (nunca la key, nunca el body crudo de la respuesta de Unsplash) indicando la categoría de fallo (timeout, status recibido, error de red). La diferencia respecto de hoy es que este resultado ahora **se persiste** (antes sólo se logueaba) — es lo que hace posible que 12.6 pueda encontrar y reintentar estos casos sin depender de revisar logs.

### 12.6 Mecanismo de recuperación

**Forma elegida: un método de servicio invocado desde un script standalone (`npx tsx`), no un endpoint HTTP de administración.**

Razonamiento: el proyecto no tiene ningún precedente de endpoint admin (se verificó: no existe ningún controlador ni ruta con ese rol en el código actual) — crear uno implicaría diseñar además autenticación/autorización específica para administración, rate limiting propio, y decidir quién puede invocarlo en producción: alcance real no pedido por el ticket para lo que es, en sus propias palabras, un mecanismo operativo para una demo. El proyecto sí tiene un precedente exacto de la forma que hace falta acá: `prisma/seed.ts`, invocado con `npx tsx` y expuesto como script de `package.json` (`prisma:seed`), ejecutado manualmente por una persona con acceso a las variables de entorno correctas. Seguir ese mismo patrón para la recuperación — un script nuevo, análogo, con su propio script de `package.json` (ej. `unsplash:recover-tracking`) — mantiene el mecanismo dentro de la postura operacional ya revisada del proyecto (igual que una migración: alguien con acceso corre algo a mano, mira el resultado, decide el siguiente paso) en vez de introducir una superficie HTTP nueva que el ticket, además, excluye de forma expresa al poner "nueva infraestructura de colas/workers" fuera de alcance — un endpoint admin en producción es, en los hechos, ese tipo de infraestructura nueva (necesita monitoreo, autorización, protección contra abuso) aunque no use colas.

**Qué hace exactamente, paso a paso:**

1. **Query de candidatos:** trae recetas cuyo `image.tracking.status` sea `PENDING` o `FAILED`, usando el filtrado nativo de JSON de Prisma sobre Postgres (no `$queryRaw`, por la misma razón de 12.5.1: una única fuente de verdad tipada, sin duplicar la forma del JSON en SQL a mano) —

   ```ts
   prisma.recipe.findMany({
     where: {
       OR: [
         { image: { path: ['tracking', 'status'], equals: 'PENDING' } },
         { image: { path: ['tracking', 'status'], equals: 'FAILED' } },
       ],
     },
     take: limit, // default razonable, ej. 50 — evita una corrida contra todo el catálogo en un solo lote sin control
     orderBy: { createdAt: 'asc' },
   })
   ```

   Una receta con `image = NULL` (nunca tuvo candidato) no tiene `tracking` y por lo tanto no matchea ningún `path`/`equals` de esta query — queda excluida sin necesidad de una condición `IS NOT NULL` aparte.

2. **Por cada receta encontrada**, con la misma concurrencia acotada (3) que el resto del módulo: revalidar `trackingUrl` contra `isValidUnsplashUrl(..., 'api.unsplash.com')` (12.3) antes de adjuntar el header — un valor persistido no es una fuente de confianza transitiva, se revalida igual que en 12.5.2; intentar `GET trackingUrl` con `Authorization: Client-ID <UNSPLASH_ACCESS_KEY>`, un único intento acotado por timeout (mismo mecanismo, sin reintento interno — si este intento también falla, la fila queda `FAILED` y espera a la **próxima corrida** del script, no a un retry automático dentro de la misma corrida).
3. **Actualización de estado:** éxito → `prisma.recipe.update` suelto (fuera de transacción, igual que 12.5.2) con `tracking.status = 'SUCCEEDED'`, `lastAttemptAt` = ahora; fallo → `tracking.status = 'FAILED'`, `lastAttemptAt` = ahora (se mantiene `FAILED`, elegible para la próxima corrida).
4. **Por qué nunca reprocesa `SUCCEEDED`:** estructuralmente, no por una condición explícita que alguien podría quitar sin querer — la query del paso 1 sólo trae `PENDING`/`FAILED`; una fila `SUCCEEDED` nunca entra al conjunto de trabajo del script, en ninguna corrida.
5. **Nunca se ejecuta en un `GET`, no tiene loop automático, no corre en un cron ni en un hook de arranque** — se invoca a mano, una vez por corrida, por una persona.

**Documentación operativa para la demo:**
1. Con `UNSPLASH_ACCESS_KEY` y `DATABASE_URL` configuradas en el entorno, ejecutar el script (ej. `npx tsx apps/api/prisma/recover-unsplash-tracking.ts` o el script de `package.json` equivalente, con un flag opcional de límite).
2. El script imprime un resumen: cuántas filas encontró, cuántas quedaron `SUCCEEDED` en esta corrida, cuántas siguen `FAILED` (con su `providerPhotoId`, para seguimiento manual si corresponde).
3. Es seguro correrlo más de una vez: las filas ya `SUCCEEDED` quedan excluidas de la query del paso 1 en cualquier corrida posterior, así que repetir la ejecución no reenvía ningún evento ya confirmado.
4. No reemplaza ni automatiza nada del flujo de creación — es exclusivamente para cerrar el hueco de filas que quedaron `PENDING`/`FAILED` por una caída, timeout o reinicio del proceso entre la persistencia y el tracking.

### 12.7 401/403 y cuota (`X-Ratelimit-Remaining`)

**401/403:** se trata como una categoría de fallo distinta de cualquier otro status no-200 — mensaje de warning específico indicando que la configuración de Unsplash es inválida (sin incluir la key en ningún punto del mensaje), `image: null`, sin reintento (igual que cualquier otro fallo de proveedor). No se agrega, más allá de esto, ningún corte de llamadas restantes del mismo batch ante un 401/403 — a diferencia de la cuota (abajo), el ticket no pide ese comportamiento para credenciales inválidas, y agregarlo sería alcance no pedido: si la key es inválida, cada llamada individual ya degrada a `null` de forma segura y acotada por su propio timeout/intento único, sin necesidad de un mecanismo de corte adicional.

**Cuota (`X-Ratelimit-Remaining`):** estado en memoria del proceso (`quotaRemaining: number | null`, `null` = "todavía no se observó", tratado como "asumir disponible" porque es el estado inicial legítimo de un proceso recién arrancado). Algoritmo exacto:

1. **Antes de cada intento de búsqueda:** si `quotaRemaining === 0`, no se hace ningún `fetch` — se devuelve `image: null` de inmediato, con un warning saneado ("unsplash quota exhausted, skipping search"), mismo tratamiento que la ausencia de API key (D4): se sabe de antemano que la llamada fallaría, así que no se hace.
2. **Después de cada respuesta de búsqueda** (sin importar el status — Unsplash incluye este header tanto en respuestas 200 como en varias respuestas de error), si el header `X-Ratelimit-Remaining` está presente y parsea a un entero no negativo válido, se sobreescribe `quotaRemaining` con ese valor — la observación más reciente siempre gana, no se acumula ni se decrementa manualmente en el cliente.
3. El resultado de la llamada que sí se hizo (si `quotaRemaining` todavía no era 0 al momento de iniciarla) se usa normalmente, aunque su propia respuesta traiga `X-Ratelimit-Remaining: 0` — el corte aplica a la **próxima** llamada, no revierte la que ya se pagó/contó.
4. **Límite conocido:** este estado es en memoria, por proceso — se reinicia en cada despliegue/reinicio y no se comparte entre instancias si el servicio corriera con más de una réplica. Se documenta como limitación aceptada para el despliegue actual (instancia única para la demo), no como un defecto a resolver: persistirlo o compartirlo entre instancias requeriría infraestructura nueva (un store compartido), que el ticket excluye expresamente.
5. **Test de agotamiento:** simular una respuesta (200 o un status de error, cualquiera que incluya el header) con `X-Ratelimit-Remaining: 0`; verificar que esa respuesta igual se usa con normalidad, y que la llamada subsiguiente (misma corrida de proceso) no dispara ningún `fetch` y devuelve `image: null` de inmediato.

**Lo que ya estaba bien y se mantiene sin cambios:** un solo intento por llamada (sin retries automáticos), timeout acotado de punta a punta (incluyendo la lectura del body, corrección ya aplicada en una revisión anterior), máximo 3 llamadas concurrentes, reutilización de búsqueda por query normalizada dentro de una misma operación de generación, búsquedas fuera de cualquier transacción de Prisma, degradación a `image: null` sin romper la creación/confirmación de recetas o planes bajo ningún escenario de fallo del proveedor.

### 12.8 Historias y criterios de aceptación (revisión mayor)

Cada historia referencia el ítem de "Pruebas mínimas" del ticket actualizado y/o el punto de la lista de 8 fixes de la revisora que cubre, para trazabilidad. Estas historias **extienden** las 16 de la sección 6 (que siguen vigentes donde no las contradicen); donde una historia de la sección 6 queda desactualizada por el cambio de tipo de `id` o por el nuevo orden del tracking, esta sección es la versión vigente.

1. **[Fix #1] `id` como string — ruta feliz real.**
   Given una respuesta real de Unsplash con candidatos cuyo `id` es un string (ej. `"LBI7cgq3pbM"`),
   When se ejecuta la selección de candidato,
   Then el primer candidato válido por posición se selecciona normalmente (no se descarta por el tipo de `id`), y `providerPhotoId` en el `RecipeImage` resultante es exactamente ese string.

2. **[Fix #2] `download_location` ausente invalida el candidato.**
   Given un candidato que cumple todo el resto del predicado de validez pero tiene `links.download_location` vacío o ausente,
   When se evalúa su validez,
   Then el candidato se descarta y se evalúa el siguiente elemento del array, sin excepción lanzada.

3. **[Fix #3] Candidato con URL de dominio inválido se descarta.**
   Given un candidato cuyo `urls.regular` (o `links.html`, `user.links.html`, `links.download_location`) no es HTTPS, o cuyo host no coincide exactamente con el dominio esperado para ese campo,
   When se evalúa su validez,
   Then el candidato se descarta (no se selecciona, no se persiste, no se intenta tracking sobre él), y se continúa evaluando el siguiente candidato de la respuesta.

4. **[Fix #3] Nunca se envía `Authorization` a un host no validado.**
   Given un `trackingUrl` persistido (desde una receta existente o desde el flujo de recuperación) cuyo host ya no coincide con `api.unsplash.com` (dato corrupto o manipulado),
   When el flujo de tracking o de recuperación intenta usarlo,
   Then no se realiza ningún `fetch` con el header `Authorization`, la fila queda/permanece en `FAILED`, y se emite un warning saneado — verificable con un espía sobre `fetch` que confirma que nunca se lo invoca con ese host.

5. **[Fix #4] UTM en `sourceUrl`/`photographerUrl`, `imageUrl` intacta.**
   Given un candidato válido con `links.html` y `user.links.html` conteniendo parámetros de query propios de Unsplash,
   When se construye el `RecipeImage`,
   Then `sourceUrl` y `photographerUrl` incluyen `utm_source=nutria&utm_medium=referral` además de cualquier parámetro original preexistente, y `imageUrl` es exactamente igual a `urls.regular` sin ningún parámetro agregado ni quitado, `ixid` incluido.

6. **[Fix #5 / Pruebas mínimas #4] Creación manual — secuencia completa.**
   Given `POST /recipes` con una key válida configurada y un candidato válido disponible,
   When se crea la receta,
   Then la receta queda persistida con `image.tracking.status = 'PENDING'` en el instante en que la escritura de persistencia resuelve (verificable interceptando esa escritura antes del paso de tracking), y al finalizar el método de servicio completo (antes de responder al cliente HTTP) `image.tracking.status` es `SUCCEEDED` si el tracking tuvo éxito.

7. **[Fix #5 / Pruebas mínimas #4] Generación/regeneración de plan — secuencia completa.**
   Given una generación o regeneración de plan que crea N recetas nuevas, todas con candidato válido,
   When se completa la persistencia,
   Then el tracking de las N recetas se dispara después de que la transacción de persistencia del plan ya commiteó (nunca antes, nunca dentro de ella), con concurrencia acotada a 3, y todas terminan con `tracking.status` en `SUCCEEDED` o `FAILED` (nunca quedan en `PENDING` si el proceso no se interrumpió).

8. **[Fix #5 / Pruebas mínimas #8] Ninguna llamada externa dentro de una transacción Prisma — extendido al tracking.**
   Given el mismo flujo de generación de plan del punto anterior,
   When se inspecciona qué corre dentro del callback de `$transaction` de la persistencia del plan,
   Then ese callback no referencia ni invoca ni al adaptador de búsqueda ni al de tracking de Unsplash — ambos ya resolvieron (búsqueda) o resuelven después (tracking) de ese callback.

9. **[Fix #5] Tracking fallido conserva receta e imagen.**
   Given un candidato válido ya persistido, y que la llamada de tracking falla (timeout, 4xx, 5xx, o error de red),
   When se completa el intento,
   Then la receta sigue existiendo con exactamente el mismo `RecipeImage` público que tenía antes del intento (ningún campo de los 9 públicos cambia), `tracking.status` queda en `FAILED`, `tracking.lastAttemptAt` se actualiza, y se emite un warning saneado — nunca una excepción que revierta la creación de la receta.

10. **[Fix #5] Recuperación procesa sólo `PENDING`/`FAILED`.**
    Given un conjunto de recetas con `tracking.status` en los tres valores posibles (`PENDING`, `SUCCEEDED`, `FAILED`),
    When se ejecuta el mecanismo de recuperación,
    Then sólo las filas `PENDING`/`FAILED` reciben un intento nuevo; ninguna llamada de red se dispara para las filas `SUCCEEDED` (verificable con un espía sobre `fetch` contando invocaciones exactas = cantidad de filas `PENDING`+`FAILED` elegibles, nunca más).

11. **[Fix #5] Recuperación es segura de correr más de una vez.**
    Given una corrida de recuperación que dejó una fila en `SUCCEEDED`,
    When se corre el mecanismo de recuperación una segunda vez sin cambios en la base,
    Then esa fila no genera ninguna llamada nueva (queda excluida de la query del paso 1), y el resumen de la segunda corrida no la cuenta entre las procesadas.

12. **[Fix #5 / Pruebas mínimas #9] Metadata privada nunca sale en un DTO público.**
    Given una receta persistida con `image.tracking` en cualquier estado,
    When se la lee vía `GET /recipes`, `GET /recipes/:id`, la respuesta de `POST /recipes`, o embebida en la respuesta de un plan,
    Then el campo `image` de la respuesta contiene exactamente los 9 campos del contrato público `RecipeImage` y ninguna clave `tracking`, `trackingUrl`, `status` ni `lastAttemptAt` en ningún nivel del body — verificable con una aserción que compara las claves presentes contra la lista blanca exacta, no sólo "no contiene la palabra tracking".

13. **[Fix #5 / Pruebas mínimas #9] Metadata privada nunca sale en logs ni snapshots.**
    Given cualquier camino de fallo o éxito de búsqueda, tracking o recuperación,
    When se inspecciona cada línea de log emitida (espía sobre el logger) y cada snapshot de `GenerationRun` generado en el mismo flujo,
    Then ningún log ni snapshot contiene el valor crudo de `UNSPLASH_ACCESS_KEY`, el header `Authorization` completo, ni el body crudo de ninguna respuesta de Unsplash.

14. **[Fix #6 / Pruebas mínimas #5] 401/403 — mensaje específico.**
    Given Unsplash responde `401` o `403`,
    When se resuelve la imagen,
    Then `image` queda `null`, se emite un warning indicando específicamente "configuración de Unsplash inválida" (sin la key), y la creación/confirmación de receta o plan se completa con normalidad.

15. **[Fix #6] Cuota agotada no dispara más búsquedas.**
    Given una respuesta previa que trajo `X-Ratelimit-Remaining: 0`,
    When se intenta resolver la imagen de otra receta en el mismo proceso,
    Then no se realiza ningún `fetch` de búsqueda, `image` queda `null`, y se emite el warning de cuota agotada — sin tocar el estado de ninguna receta ya persistida.

16. **[Pruebas mínimas #1] Parámetros y normalización — sin cambios de fondo, revalidado con ids string.**
    Given un título de receta con acentos/mayúsculas/espacios irregulares, y una respuesta simulada con `id` string,
    When se resuelve la imagen,
    Then la query enviada sigue el algoritmo de la sección 2 sin cambios, la request incluye `order_by=relevant` y `content_filter=high` además de `query`/`page`/`per_page`, y el candidato seleccionado es el primero válido por posición.

17. **[Pruebas mínimas #2] Mapeo completo de DTO y alt fallback — revalidado.**
    Given un candidato válido con `alt_description` ausente,
    When se construye el `RecipeImage`,
    Then `alt` es exactamente `` `Imagen ilustrativa de ${título original de la receta}` `` (no la query normalizada), y el resto del mapeo (`providerPhotoId`, `imageUrl`, `sourceUrl` con UTM, `photographer`, `photographerUrl` con UTM) es completo y correcto.

18. **[Pruebas mínimas #3] Imagen persistida estable en lecturas, a nivel del contrato público.**
    Given una receta con `image` no nulo persistido (incluyendo su `tracking` interno en cualquier estado),
    When se lee esa receta por cualquier camino existente, dos veces,
    Then ambas lecturas devuelven exactamente el mismo `RecipeImage` público (los 9 campos, sin `tracking`), y ninguna lectura dispara una llamada a Unsplash.

19. **[Pruebas mínimas #6] Receta reutilizada no re-busca ni re-trackea.**
    Given un plan que referencia una receta ya existente en el catálogo (sin crear una fila `Recipe` nueva),
    When se genera/persiste ese plan,
    Then no se dispara ninguna búsqueda ni ningún tracking para esa receta — verificable con un espía sobre `fetch` contando cero invocaciones atribuibles a esa receta.

20. **[Pruebas mínimas #7 — ya cubierta en 9/10/11, referenciada acá para trazabilidad 1:1 con el ticket] Tracking fallido es recuperable y la recuperación no reprocesa `SUCCEEDED`.** Ver historias 9, 10 y 11.

**Nota sobre "Prueba real con la aplicación Unsplash configurada" (último ítem de "Pruebas mínimas" del ticket, y punto 8 de la lista de fixes de la revisora):** esto es un paso de evidencia de demo en vivo (API levantada, `UNSPLASH_ACCESS_KEY` real, `POST /recipes` real, inspección de la base para confirmar `tracking.status = 'SUCCEEDED'`, y registro del `X-Ratelimit-Limit` real recibido) — se menciona acá como parte del alcance total del ticket, pero **no se diseña en este documento**: es un paso operativo posterior a la implementación, no una decisión de arquitectura.

### 12.9 Reconciliación con `.ai/release-and-evidence.md`

Mismo formato ya usado en las secciones 8 y 10 de este documento.

- **Issue de Linear vinculado:** NUT-83. Sigue sin poder citarse/enlazarse por API en esta sesión (MCP de Linear no autorizado) — verificación manual de quien suba el PR, sin cambios respecto de la sección 10.
- **Criterios de aceptación:** las 16 AC de la sección 6 más las 20 de la sección 12.8 de este documento — las de 12.8 son las vigentes donde contradicen a las de la sección 6 (tipo de `id`, momento del tracking).
- **Tests/CI:** pendiente de ejecución después de que el explorer/tester/implementer apliquen esta revisión — no se afirma un resultado de corrida acá porque esta sesión es exclusivamente de diseño, sin tocar código ni ejecutar tests.
- **Seguridad de la migración:** sin cambios respecto de la sección 8/10 — esta revisión no toca el schema de `Recipe` ni agrega ninguna migración nueva; `image Json?` ya aprobado sigue siendo la única columna involucrada.
- **Exposición de secretos:** reforzada respecto de la sección 7/11.2 — además de la key y los headers salientes, ahora también se exige explícitamente que la metadata privada de tracking (`tracking.trackingUrl`/`status`/`lastAttemptAt`) nunca llegue a un DTO público, log, o snapshot (12.5.1, 12.8 historias 12-13). Esto es un requisito nuevo de esta revisión, no una repetición de lo ya cubierto.
- **Impacto de accesibilidad:** no aplica — cambio exclusivamente de backend, sin componente de UI/frontend.
- **Ruta de rollout:** sin cambios de infraestructura o despliegue — el código de esta revisión se despliega igual que cualquier cambio de backend normal (sin fases, sin migración nueva que aprobar). El nuevo script de recuperación es una herramienta operativa adicional, no parte del camino crítico de despliegue.
- **Ruta de rollback:** sin cambios respecto de la sección 8/10 (`ALTER TABLE "recipes" DROP COLUMN "image";`, sin pérdida de datos de otros campos). Adicionalmente: si esta revisión necesitara revertirse a nivel de código (no de schema), las recetas que ya hubieran completado tracking (`SUCCEEDED`) no quedan en ningún estado inconsistente al revertir — la metadata de tracking es aditiva dentro de un campo `JSONB` ya existente, no una estructura nueva de la que dependa otro código.
