# NUT-74 — Diseño: validar de forma determinística cada receta generada

## 1. Contexto y alcance

**Objetivo.** Que ninguna receta generada por IA que sea incompatible, esté incompleta o mal formada llegue al catálogo o a un plan. El servidor valida; el modelo nunca es la autoridad final y nunca se le pide que juzgue su propio output.

**Contexto verificado en el código (rama que sale de NUT-77).**
- Las reglas estaban repartidas: restricciones por palabra clave en un util del plan, `validate(MealDto)` de class-validator, filtrado de categorías y normalización de properties dentro del reemplazo de una comida, y un `JSON.parse` dentro del adaptador de Gemini que devolvía `null` o un 500 genérico.
- `GenerationRun` (NUT-75) ya tiene `validationSnapshot`, `errorCode` y los estados `READY_FOR_REVIEW`, `SUCCEEDED` y `REJECTED`. **No hace falta migración.**
- NUT-72 ya calcula una huella de receta (título normalizado + nombres de ingredientes normalizados, ordenados y sin repetir).
- NUT-73 (generar recetas para el catálogo con preview y confirmación) **no existe** todavía. Este ticket deja el validador listo para que lo use, sin el enganche.
- **Forma real de los macros.** La comida generada por Gemini trae `{ Protein, Fiber, Calories, Description }`, sin carbohidratos ni grasas. Las recetas del catálogo traen `{ calories, protein, carbs, fat }`. Ver D4.
- **Cantidades.** El schema de Gemini declara `quantity` como STRING, así que puede devolver "200", "1/2" o "al gusto". Ver D5.

**Dentro de alcance:** el validador puro, su configuración, el servicio que lo orquesta y registra el resultado en `GenerationRun`, y su uso desde el plan semanal (generación con IA) y desde el reemplazo de una comida.

**Fuera de alcance:** el enganche de preview y confirmación de NUT-73; consejo médico; moderación general de texto; evaluación subjetiva de sabor; juez LLM; cambios de prompt o schema (ver §8).

## 2. Decisiones

Todos los valores numéricos y las tablas están en un solo archivo de configuración del validador. Su estado:

| Decisión | Valor | Estado |
|---|---|---|
| D4 Calorías | `4·P + 4·C + 9·G`; ≤15 % OK, 15–35 % warning, >35 % (o macros en 0 con kcal > 0) `INVALID_RANGE` | **Aprobada por el TL** |
| D4b Calorías sin C/G | No se aplica la regla; warning `CALORIE_CHECK_SKIPPED` | **PENDIENTE DE CONFIRMAR CON EL TL** (propuesta de la dev, 2026-10-06) |
| D6 Lotes | Una receta inválida se rechaza sola; `EMPTY_OUTPUT`/`INVALID_JSON`/`COUNT_MISMATCH` rechazan el lote | **Aprobada por el TL** |
| D7 Duplicado exacto | Se reutiliza la receta existente (`DUPLICATE_RECIPE` con `existingRecipeId`) | **Aprobada por el TL** |
| D7 Duplicado potencial | Warning `POTENTIAL_DUPLICATE` | **Aprobada por el TL** |
| D8 Preferencia contradictoria | Tabla fija categoría → grupos de ingredientes | **PENDIENTE DE CONFIRMAR CON EL TL** |
| D5 Cantidades sin número | Lista fija ("al gusto", "a gusto", "c/n", "cantidad necesaria") → sin cantidad + warning | **PENDIENTE DE CONFIRMAR CON EL TL** (propuesta de la dev, 2026-10-06) |
| D9b Negaciones | "sin X" / "libre de X" anulan esa mención, incluido "X sin gluten" (que también anula la palabra anterior) | **PENDIENTE DE CONFIRMAR CON EL TL** |
| D2 JSON con texto extra | Sólo se aceptan fences ```` ```json ```` (sin importar mayúsculas); cualquier otro texto → `INVALID_JSON` | Aprobada (dev) |
| D5b Cantidad "1.000" / "1,000" | Punto o coma seguido de exactamente 3 dígitos (con parte entera ≠ 0) es ambiguo → `INVALID_RANGE` | Aprobada (dev, revisión) |
| D12 PENDING colgado en el plan semanal | Mismo TTL que NUT-77 (`MEAL_REPLACEMENT_PENDING_TTL_MINUTES`) → `EXPIRED` | Aprobada (dev, revisión) |
| D3 Campos de más | Se descartan sin rechazar | Aprobada (dev) |
| D9 Plan semanal con comida inválida | Se rechaza el plan entero (comportamiento actual) | Aprobada (decisión de la dev, 2026-10-06) |

**D1 — Dos funciones puras.**
- `parseGeneratedOutput(raw, expectedCount)` → recetas parseadas, o `EMPTY_OUTPUT` / `INVALID_JSON` / `COUNT_MISMATCH`. Acepta un array de recetas o `{ "recipes": [...] }`. Debajo usa `parseJsonOutput(raw)`, que también usan el plan semanal y el reemplazo (su JSON no es una lista de recetas).
- `validateRecipe(draft, ctx)` → exactamente el `ValidationResult` del ticket. El plan semanal y el reemplazo, que ya tienen el objeto, la llaman directo (a través del servicio).
- `validateRecipes(drafts, ctx)` aplica `validateRecipe` a cada una y detecta duplicados dentro del mismo lote.

No hay base de datos ni Nest en estas funciones: no pueden escribir nada. Los duplicados se resuelven porque el que llama pasa en `ctx` las recetas del catálogo con el mismo título normalizado.

```ts
type ValidationResult =
  | { valid: true; normalizedRecipe: RecipeDraft; warnings: ValidationWarning[] }
  | { valid: false; errors: Array<{ code: string; field?: string; message: string;
      existingRecipeId?: string; duplicateOfIndex?: number }> };
```

**Única extensión al tipo del ticket:** los errores `DUPLICATE_RECIPE` llevan `existingRecipeId` y el `normalizedRecipe` (duplicado del catálogo, D7) o `duplicateOfIndex` (duplicado dentro del lote). Sin eso, el que llama no puede reutilizar la receta ni validar el envoltorio con la receta normalizada (una receta cruda con "al gusto" sin unidad no pasa el DTO).

**D2 — Pipeline.** Etapas en orden: `parse` → `schema` → `normalize` → `ranges` → `profile` → `duplicates`. La primera etapa con errores corta el pipeline de esa receta, pero dentro de cada etapa se juntan todos sus errores. La etapa de un error se deriva de su código (tabla fija), así que el resultado no necesita un campo `stage`.

| Etapa | Qué revisa | Códigos |
|---|---|---|
| parse | vacío, JSON (sólo fences ```` ```json ````), cantidad | `EMPTY_OUTPUT`, `INVALID_JSON`, `COUNT_MISMATCH` |
| schema | presencia y tipo básico: título, descripción, minutos, ingredientes (≥1, con nombre y unidad), pasos (≥1, no vacíos), macros `calories` y `protein` | `MISSING_FIELD` |
| normalize | texto (trim, espacios), categorías (trim + mayúsculas, sin repetir), properties (`normalizeProperties`), unidades (minúsculas + alias), cantidades | `UNSUPPORTED_CATEGORY` |
| ranges | minutos enteros 0..1440; `quantity > 0` finito; macros finitos ≥ 0; calorías vs macros | `INVALID_RANGE` |
| profile | ingredientes excluidos; categoría declarada que contradicen los ingredientes | `EXCLUDED_INGREDIENT`, `CONTRADICTORY_PREFERENCE` |
| duplicates | huella contra el catálogo y contra el lote; mismo título con otros ingredientes | `DUPLICATE_RECIPE` |

Los números que llegan como string numérico ("15") se convierten en `normalize`. `NaN`, `Infinity` y los negativos dan `INVALID_RANGE`.

**D3 — Campos de más.** Se descartan sin rechazar: el `normalizedRecipe` se arma por lista blanca. Los mensajes de error nunca incluyen el prompt, el texto generado completo ni un stack trace.

**D4 — Calorías (aprobada por el TL).** Si están `protein`, `carbs` y `fat`: `esperado = 4·P + 4·C + 9·G` y `desvío = |kcal − esperado| / esperado`. Hasta 15 % está OK; entre 15 % y 35 % da el warning `CALORIE_MACRO_MISMATCH`; más de 35 % da `INVALID_RANGE`. Si `esperado = 0` y `kcal > 0`, también `INVALID_RANGE`.
**D4b — Sin carbohidratos o grasas (PENDIENTE DE CONFIRMAR CON EL TL)** (hoy, todas las comidas de Gemini): la regla no se aplica y queda el warning `CALORIE_CHECK_SKIPPED` en el snapshot. El validador acepta los macros con las dos formas reales (`Protein`/`protein`…).

**D5 — Cantidades.** (La lista de expresiones sin cantidad está PENDIENTE DE CONFIRMAR CON EL TL.) Se aceptan números, strings numéricos ("200", "0,5") y fracciones ("1/2", "1 1/2"). Una lista fija y explícita de expresiones sin cantidad ("al gusto", "a gusto", "c/n", "cantidad necesaria") se guarda con `quantity: null` y el warning `NON_NUMERIC_QUANTITY`. Si en ese caso la unidad viene vacía, la expresión pasa a ser la unidad (por ejemplo `{ name: "Sal", quantity: null, unit: "al gusto" }`). Cualquier otro texto, 0 o un negativo da `INVALID_RANGE`. "1.000", "2.500", "1,000" o "2,500" (punto o coma seguido de exactamente 3 dígitos, con parte entera distinta de 0) son ambiguos (¿mil o uno?) y también dan `INVALID_RANGE`; "0.125", "0,125" y "1,5" no son ambiguos y se aceptan. Las cantidades se redondean a 2 decimales ("1/3" → 0.33). Unidades: minúsculas y alias `gr`, `grs` → `g`; `cc` → `ml`.

**D6 — Lotes (aprobada por el TL).** El validador devuelve un resultado por receta y el que llama decide qué hacer con las faltantes. Los errores de lote completo cortan todo porque no hay recetas individuales para evaluar.

**D7 — Duplicados (aprobada por el TL).**
- *Exacto:* misma huella de NUT-72 (título + nombres de ingredientes normalizados). Contra el catálogo → `DUPLICATE_RECIPE` con `existingRecipeId` y **el que llama reutiliza esa receta** en vez de crear otra o responder 422. Dentro del lote → `DUPLICATE_RECIPE` con `duplicateOfIndex`.
- *Potencial:* mismo título normalizado con otros ingredientes → warning `POTENTIAL_DUPLICATE` con los ids.
- *Búsqueda acotada:* no se cargan las huellas de todo el catálogo. Sólo se buscan las recetas cuyo título normalizado (minúsculas, sin acentos ni signos, espacios colapsados) coincide con el de algún draft. Una sola consulta por validación.
- *Seguridad:* antes de ofrecer una receta del catálogo para reutilizar, el servicio descarta las que violan las restricciones del perfil (su descripción podría mencionar un alérgeno que la huella no ve).
- La función de huella se extrae de NUT-72 a un util compartido, sin cambiar su comportamiento.

**D8 — Preferencia contradictoria (PENDIENTE DE CONFIRMAR CON EL TL).** Una receta declara una categoría que sus propios ingredientes contradicen. La tabla es chica y fija, y reutiliza el diccionario de ingredientes:

| Categoría declarada | Grupos que la contradicen |
|---|---|
| `VEGETARIAN` | carne, pescado, mariscos |
| `VEGAN` | carne, pescado, mariscos, lácteos, huevo, miel |
| `GLUTEN_FREE` | gluten |
| `DAIRY_FREE` | lácteos |

Hoy sólo aplica al reemplazo de una comida, porque el plan semanal no pide categorías a Gemini.

**D9 — Diccionario de ingredientes.** Las palabras clave y excepciones de las restricciones (nuts, dairy, gluten, shellfish, soy) se mueven al validador sin cambios. Se agregan los grupos carne, pescado, huevo y miel, que sólo usa D8. Palabras agregadas en la revisión final: lácteos "lacteo" y "lactosa"; frutos secos "pinon" ("piñones"); gluten "bulgur", "espelta", "malta" y "salvado"; soja "shoyu". Ninguna da falso positivo dentro de otra palabra ("salvadoreño", "maltada"), y "Yogur sin lactosa" sigue siendo lácteo por "yogur". Se busca por palabra completa, sin acentos ni mayúsculas, con plural opcional. Así "panceta" no es "pan", "repollo" no es "pollo" y "nutmeg" no es "nut". El util viejo se borra.
- **Qué textos se revisan:** se decide en un solo lugar (`restrictionTexts`): título de la comida y de la receta, descripciones, nombres de ingredientes y **pasos**. Lo usan el validador, el plan manual y editado, y los filtros del catálogo (reemplazo y duplicados).
- **Negaciones explícitas (PENDIENTE DE CONFIRMAR CON EL TL):** antes de buscar se borran "sin X" y "libre de X" para cada palabra del grupo ("Servir sin maní"), además de las excepciones fijas ("nuez moscada", "leche de almendras"…). Sólo se borra esa mención: "sin queso, con crema" sigue siendo lácteo, y un ingrediente "Maní" se detecta aunque un paso diga "sin maní extra". Antes sólo existían algunas negaciones fijas ("sin gluten", "sin frutos secos", "sin soja"…); "sin maní" o "sin nueces" son nuevas. Caso especial que también queda a confirmar: "X sin gluten" ("Pan sin gluten") anula además la palabra anterior, así que "pan" no cuenta como gluten en esa frase.

**D10 — Servicio de validación (Nest).** Vive en el módulo de planes, junto al adaptador de IA y al repositorio de `GenerationRun`. NUT-73 también vivirá ahí.
- `validateDrafts(drafts, profile)`: busca en el catálogo las recetas con los mismos títulos, filtra las inseguras para el perfil y valida cada draft por separado. Sólo lee. (Los duplicados dentro de un lote quedan en la función pura `validateRecipes`, lista para NUT-73.)
- `reject(run, summary)`: pasa el run de `PENDING` a `REJECTED` con `errorCode` (el primer código) y `validationSnapshot`, y escribe un log estructurado por cada código.
- `rejectWithCode(run, code)`: lo mismo para los rechazos que no vienen del validador: el envoltorio (`AI_INVALID_SCHEMA`, etapa `schema`) y los criterios del body del reemplazo (`CRITERIA_NOT_MET`, etapa `criteria`). Así **todo** rechazo deja snapshot y log.
- Si no logra marcar el run (error de base o 0 filas), lo loguea como `recipe_validation_reject_persist_failed` (sin el mensaje del error) y devuelve igual el 422; el run lo libera después el TTL (D12).
- El resumen de un resultado aceptado no lo escribe este servicio: viaja en la transacción que confirma el run (`SUCCEEDED`).
- `validationSnapshot = { stage, codes, warnings }`. `stage` es la primera etapa que falló, o `passed`. `codes` son los códigos de error únicos y `warnings` los códigos de warning únicos.
- Log: `{ event: 'recipe_validation_rejected', code, provider, model, generationRunId }`, uno por código, que sirve como métrica por código, proveedor y modelo. Nunca se loguean el prompt, el perfil ni el texto generado.

**D11 — HTTP.** Contenido inválido → **422**. Proveedor caído o timeout → **503** (`AiProviderUnavailableError`). El adaptador de Gemini devuelve el texto crudo, no parsea, y nunca tira un 500 genérico por fallas del proveedor. El timeout de 15 s se pasa como `signal` en el primer nivel de las opciones, que es donde lo lee el SDK (antes iba anidado y nunca se aplicaba). `AI_TIMEOUT` se decide mirando la señal abortada, porque el SDK lanza `GoogleGenerativeAIAbortError`, no `AbortError`.

**D13 — Modelo de Gemini (2026-10-06).** `gemini-1.5-flash` ya no existe para la API key del proyecto (la API responde 404 NOT_FOUND), así que toda generación real fallaba (500 antes, 503 `AI_PROVIDER_ERROR` con NUT-74). Se cambia a `gemini-3.5-flash` (verificado disponible, con `generateContent`). Pendiente: medir con una generación real si el timeout de 15 s alcanza y evaluar las salidas con el validador (`ai-generation-safety`). El SDK queda fijado en `@google/generative-ai` 0.24.1 (package.json y lockfile).

**D12 — Runs PENDING colgados en el plan semanal.** Se reutiliza el mecanismo de NUT-77 (helper compartido, misma variable `MEAL_REPLACEMENT_PENDING_TTL_MINUTES`, 10 min por defecto): un `PENDING` más viejo que el TTL pasa a `EXPIRED` (`PENDING_TIMEOUT`) y la generación arranca de cero. Además, todo error inesperado después de crear el run lo deja `FAILED` (`UNEXPECTED_ERROR`), y las transiciones de error nunca tapan el error original (un 503 no se vuelve 500 si falla la base).

## 3. Integración

**Plan semanal (generación con IA, `MEAL_PLAN_INITIAL`).**
1. Gemini devuelve texto crudo. Si falla el proveedor → run `FAILED` (`AI_TIMEOUT` o `AI_PROVIDER_ERROR`) y 503.
2. `parseJsonOutput`. Si falla → run `REJECTED` y 422. Si `days` no es una lista → `MISSING_FIELD`; si es una lista con una cantidad distinta de 7 → `COUNT_MISMATCH` (rechaza el lote entero, con snapshot y log como los demás rechazos).
3. Cada comida se valida con `validateRecipe` (sin duplicados de lote: repetir una comida en la semana es normal). **Si alguna es inválida, se rechaza el plan entero** → run `REJECTED` y 422. Hoy no hay mecanismo para cubrir el hueco (D9 de la tabla); el validador ya devuelve un resultado por receta para cuando exista.
4. Un duplicado exacto del catálogo no es un rechazo: la comida queda apuntando a la receta existente (no se crea otra ni se busca imagen).
5. Envoltorio del plan (7 días, fechas, `mealType`, macros de la comida) con los DTOs existentes y las recetas ya normalizadas. Si falla → run `REJECTED` (`AI_INVALID_SCHEMA`) y 422.
6. Se persiste como hasta ahora. El resumen viaja dentro de la misma transacción que pasa el run a `SUCCEEDED` (antes ahí se guardaba `{ restrictionsChecked: true }`). Cuando se rechaza, el `errorCode` sale de las comidas rechazadas; un duplicado reutilizable nunca es el código del rechazo.
7. Si la validación falla por otra cosa (por ejemplo, la consulta de duplicados), el run queda `FAILED` (`UNEXPECTED_ERROR`) y no `PENDING`.

**Plan manual (`POST /meal-plans`) y edición (`PUT /meal-plans`).** Su contenido no es generado: sólo se revisan las restricciones del perfil (400 con el mismo mensaje), con el mismo diccionario y los mismos textos que el validador (`restrictionTexts`, pasos incluidos). Antes no se miraban el título y la descripción de la receta ni los pasos, así que ahora es más estricto. `IngredientDto.quantity` acepta `null` para que un `PUT` pueda reenviar recetas guardadas "al gusto".

**Reemplazo de una comida (NUT-77).** Gemini devuelve texto crudo → `parseJsonOutput` → `validateRecipe` → envoltorio `MealDto` → criterios del body (`CRITERIA_NOT_MET`, regla propia del reemplazo, se mantiene). Un duplicado exacto del catálogo reutiliza esa receta, siempre que cumpla los criterios del body. El filtrado de categorías y la normalización de properties propios del servicio se eliminan.

**NUT-73 (no se implementa).** Antes del preview: `parseGeneratedOutput` → `validateRecipes` (con duplicados dentro del lote; habrá que exponerlo en el servicio). Las recetas válidas van a `READY_FOR_REVIEW`; un duplicado exacto reutiliza la receta existente. Al confirmar se vuelve a validar, porque el catálogo pudo cambiar.

## 4. Historias y criterios de aceptación

- **AC1** Un output vacío, que no es JSON o que tiene texto fuera de un fence ```` ```json ```` se rechaza sin escribir dominio (`EMPTY_OUTPUT` / `INVALID_JSON`).
- **AC2** Un lote con una cantidad distinta de la pedida se rechaza entero (`COUNT_MISMATCH`).
- **AC3** Título o descripción vacíos, minutos fuera de 0..1440 o no enteros, ingredientes vacíos o con cantidad ≤ 0 o inválida, pasos vacíos, macros negativos o no finitos y categorías fuera del enum se rechazan con su código y su `field`.
- **AC4** Las properties y las unidades se normalizan; los campos de más se descartan.
- **AC5** Calorías incoherentes según D4 → warning o rechazo; sin C/G → `CALORIE_CHECK_SKIPPED`.
- **AC6** Un ingrediente excluido, directo o derivado, con acentos o mayúsculas, se rechaza (`EXCLUDED_INGREDIENT`). Una palabra parcial (panceta, pancita, nutmeg, repollo) no da falso positivo.
- **AC7** Una categoría contradicha por los ingredientes se rechaza (`CONTRADICTORY_PREFERENCE`).
- **AC8** Un duplicado exacto del catálogo devuelve `DUPLICATE_RECIPE` con el id existente y se reutiliza. Un duplicado dentro del lote se marca, y un duplicado potencial es un warning.
- **AC9** En un lote con una receta inválida, las demás siguen siendo válidas.
- **AC10** Una receta válida con warnings devuelve `valid: true` con sus warnings.
- **AC11** Con un resultado inválido no hay ninguna escritura de dominio (receta, plan, comida). Sólo cambia el `GenerationRun`.
- **AC12** El `GenerationRun` guarda `validationSnapshot { stage, codes, warnings }` y `errorCode`, y se escribe un log por código sin prompt, perfil ni texto generado.
- **AC13** Contenido inválido → 422; proveedor caído → 503.

## 5. Pruebas requeridas

- Validador puro: un fixture determinístico por código, más los casos de restricción directa y derivada, acentos y mayúsculas, palabra parcial, JSON con texto extra, campos de más, `NaN`/`Infinity`/negativos, macros inconsistentes, duplicado contra el catálogo y dentro del lote, preferencia contradictoria, lote mixto y resultado válido con warnings.
- Huella compartida: mismo resultado que la versión de NUT-72.
- Adaptador de Gemini: devuelve el texto crudo; ante fallas, `AiProviderUnavailableError`.
- Servicio: la búsqueda acotada por título, el filtrado de recetas inseguras, el snapshot, el `errorCode` y el log sin datos sensibles.
- Plan semanal y reemplazo: cero escrituras de dominio cuando el resultado es inválido; reuso del duplicado; 422 y 503.

## 6. Base de datos

Sin cambios de schema ni migración. Una consulta nueva de sólo lectura sobre `recipes` por título normalizado (`unaccent`, ya usada por NUT-72), sin índice. El catálogo es chico; si crece, se puede agregar un índice de expresión en otro ticket.

## 7. Riesgos conocidos

- **Reuso de recetas sin dueño (M7 de la revisión, sólo ticket).** `Recipe` no tiene dueño y `PATCH`/`DELETE /recipes/:id` sólo exigen estar logueado. Con el reuso de duplicados, el plan semanal puede apuntar a una receta creada por otro usuario, que después puede editarla (por ejemplo, agregarle nueces) y nada vuelve a revisar el plan guardado.
- **Borrado de recetas reutilizadas (previo, sólo se reporta).** Al borrar un plan se eliminan las recetas que ya no usa ninguna comida, sin mirar su origen. Si un plan reutilizó una receta del catálogo (NUT-77, y ahora también el duplicado exacto de NUT-74), borrar ese plan borra la receta del catálogo. Queda para otro ticket.
- Frontend: el detalle de receta (mobile y desktop) muestra sólo la unidad cuando `quantity` es `null`, y el tipo pasa a `number | null` (corregido en este PR). El formulario de edición muestra el campo vacío, pero `UpdateRecipeDto` sigue exigiendo un número: editar desde el catálogo una receta generada con "al gusto" no se puede guardar sin ponerle cantidad (ya pasaba antes con los strings de Gemini).
- El texto se busca por palabra clave: ante la duda se prefiere un falso positivo (rechazar) a dejar pasar un alérgeno.

## 8. Tickets aparte (anotados, no se hacen acá)

- **Permisos sobre recetas (M7):** dueño o permisos en `PATCH`/`DELETE /recipes/:id`, y decidir de qué recetas se permite reutilizar duplicados.
- **Edición de recetas sin cantidad:** formulario de edición y `UpdateRecipeDto`/`CreateRecipeDto` con `quantity` `null` (o string) para las recetas generadas.
- **Borrado de recetas reutilizadas:** `deletePlanTransaction` no debería borrar recetas del catálogo que un plan sólo reutilizaba.
- **Variable del TTL:** si se quiere separar el TTL del plan semanal del de NUT-77, renombrar `MEAL_REPLACEMENT_PENDING_TTL_MINUTES` a una variable genérica.
- **Saturación del proveedor y modelo configurable:** ante el 503 por saturación de Gemini ("This model is currently experiencing high demand", visto en las pruebas reales del 2026-10-06), reintentar con espera (backoff acotado, dentro del timeout total de la request) o pasar a un modelo de respaldo; y leer el nombre del modelo desde una variable de entorno (por ejemplo `GEMINI_MODEL`) en vez de la constante `GEMINI_MODEL_NAME`. Contexto: `gemini-1.5-flash` y `gemini-2.5-flash` ya no están disponibles para la key del proyecto (404), aunque 2.5 siga apareciendo en la lista de modelos.
- **Schema de Gemini:** pasar `quantity` a NUMBER y agregar `Carbs` y `Fat` a los macros de la comida, con su versión de prompt, su evaluación y su rollback (`ai-generation-safety`). Con eso la regla de calorías D4 empieza a aplicar a las comidas generadas.
- Cubrir una comida descartada del plan semanal con el catálogo (NUT-72), para poder rechazar sólo esa comida en vez del plan entero.
- Validar también la dieta del perfil (por ejemplo, perfil `VEGAN` que recibe carne), además de la categoría declarada.
