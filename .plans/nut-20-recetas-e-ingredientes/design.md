# NUT-20 — Diseño: pantalla de recetas e ingredientes

Estado: decision record, iterado varias veces tras correcciones directas del TL y del equipo de backend. Este documento es conceptual: no nombra archivos ni rutas del repositorio. Donde todavía queda algo marcado como "SUPUESTO"/"a definir en implementación" fuera de la sección 3, es una decisión de UX menor delegada al implementer, no una ambigüedad de contrato de datos. **Excepción a la convención original de este documento:** la sección 3 (contrato de tipos) ya no distingue CONFIRMADO/SUPUESTO — fue reemplazada íntegramente por el contrato cerrado del ticket NUT-61, que el frontend debe implementar tal cual aunque el backend real de NUT-13 todavía no lo exponga completo (ver el detalle de qué está ya desplegado hoy vs. qué falta, al inicio de la sección 3).

## 0. Alcance y encuadre

- Ticket: implementar e integrar una única pantalla mobile de recetas e ingredientes (listado, crear receta, crear ingrediente, detalle, editar, borrar), consumiendo el CRUD backend de NUT-13/NUT-61, en un mismo PR.
- Fuera de alcance: generación con IA, cualquier cambio de `schema.prisma` o migraciones (el CRUD y su contrato completo son responsabilidad de NUT-13/NUT-61, no de este ticket de frontend — ver sección 3). **Corrección de alcance de la usuaria:** tablet/desktop SÍ son parte de este mismo ticket NUT-20 — el criterio de aceptación 11 aplica de verdad. Ya no están fuera de alcance (ver sección 9, que reemplaza la afirmación anterior de este documento).
- Decisión de paleta e iconografía YA TOMADA con la usuaria (no se reabre en este documento, ver sección 10): se reconstruye la estructura/flujo/copy de los mockups de Stitch con la paleta y patrones de componentes ya existentes en el proyecto (verde/crema de marca, tipografía serif para títulos, iconos SVG inline propios, mismo lenguaje visual de tarjetas/botones ya usado en la integración de plan de comidas).
- Mobile first: la versión mobile se implementa y valida primero dentro de este mismo ticket (ya cumplido — ver sección 9). La adaptación tablet/desktop es la segunda etapa del mismo ticket, no un ticket futuro, y se construye por composición sobre los mismos servicios/hooks/componentes de formulario ya construidos para mobile, sin lógica nueva de validación ni de integración (ver sección 9).

## 1. Decision record — arquitectura de servicios y hooks

### 1.1 Un servicio y un hook por dominio, no combinados

Decisión: **dos servicios independientes** (uno para recetas, uno para ingredientes) y **hooks correspondientes por dominio**, no un servicio/hook combinado "recetas+ingredientes".

Justificación:
- Los dos recursos tienen ciclo de vida propio e independiente: un ingrediente se crea standalone (botón pill del listado) sin pasar nunca por una receta, y el catálogo de ingredientes es consumido como dato de soporte por el formulario de receta, no al revés.
- Es el mismo criterio ya aplicado en la integración de plan de comidas: un servicio por recurso de backend, con tipos y manejo de error propios de ese recurso.
- Combinar ambos en un servicio único forzaría a que cualquier cambio en el contrato de ingredientes obligue a retocar el módulo de recetas y viceversa, y complicaría el mockeo en tests (hoy los tests de hooks mockean el servicio completo con `vi.mock`; un servicio combinado ensuciaría los mocks de casos que no le conciernen a la aserción).
- La composición entre ambos dominios se limita a una dependencia de **lectura**: el formulario de receta consume el hook de catálogo de ingredientes (sólo lectura, vía `GET /ingredients`) para poblar el selector de cada fila de "Ingredientes y Porciones". **Corrección de alcance, instrucción directa del TL (ver nota de trazabilidad en sección 2.2):** la creación de ingredientes NO se combina con el flujo de receta; vive únicamente en su propio flujo standalone.

Dentro del dominio "receta" se distinguen dos necesidades de datos con ciclo de vida distinto:
- Un hook de **listado** (colección completa, con estados de carga/vacío/error/éxito, búsqueda y filtro por categoría, y una acción de "Actualizar" manual).
- Un hook de **detalle** (un recurso por id, con sus propios estados de carga/error — incluyendo "no encontrado" — independientes del estado del listado).

Ambos hooks pueden apoyarse en el mismo servicio de recetas (que expone operaciones `list`, `getById`, `create`, `update`, `remove`), igual que el servicio de plan de comidas expone dos operaciones sobre el mismo recurso sin que eso implique dos servicios. Lo que sí exige separación es el hook, porque el estado de "estoy viendo el detalle de la receta X" y el estado de "estoy viendo el listado completo" no deben compartir el mismo `status`/`error` interno: una falla al cargar un detalle no debe poder pisar o vaciar el listado ya cargado, ni viceversa.

### 1.2 Estrategia de refetch tras mutaciones: refetch completo, no actualización optimista

Decisión: **refetch completo** de la colección/recurso afectado tras crear, editar o eliminar. No se implementa actualización optimista de la lista.

Justificación:
1. Es el criterio ya validado en la integración de plan de comidas: ante una mutación (generar plan), la app prioriza consistencia con el servidor por sobre la percepción de velocidad, e incluso reconcilia contra el estado real del servidor cuando el resultado de la mutación es incierto.
2. Las mutaciones de este ticket ocurren detrás de un formulario explícito (crear/editar/borrar), no de una interacción de alta frecuencia (como un toggle); el costo de UX de esperar una respuesta y luego refrescar es bajo y aceptable.
3. Una actualización optimista de una entidad con relaciones (receta con N ingredientes, cantidades, categoría, valores nutricionales) introduce una superficie de reconciliación grande si el backend transforma, normaliza o rechaza parcialmente algo que el cliente ya "dio por hecho" — exactamente la clase de problema que la reconciliación de plan de comidas tuvo que resolver a posteriori. Evitarlo desde el diseño es más simple que reproducir esa lógica para un caso de uso de menor frecuencia de interacción.
4. El ticket pide explícitamente "mostrar el listado actualizado" y "actualizar la lista después de una eliminación exitosa" como criterio de corrección, no de velocidad percibida.

Aplicación concreta:
- Crear receta (desde el listado) → al resolver con éxito, se cierra el formulario, se dispara refetch del listado y se vuelve al listado ya actualizado.
- Editar receta (desde el detalle) → al resolver con éxito, se refresca el propio detalle (para reflejar lo que el backend realmente persistió) y se vuelve a la vista de detalle actualizada; el listado se marca para refetch la próxima vez que se muestre (o se refetchea al volver a montarse), de modo que no quede desincronizado si el usuario vuelve atrás.
- Eliminar receta (desde el detalle, tras confirmación) → al resolver con éxito, se navega de vuelta al listado y se dispara refetch del listado.
- Crear ingrediente **standalone** (botón pill del listado) → refetch del catálogo de ingredientes al cerrar el modal con éxito.
- **[DESCARTADO]** Este documento proponía originalmente una creación de ingrediente "inline" desde el formulario de receta, con actualización local del catálogo en memoria. Esa pieza se elimina por instrucción directa del TL (ver nota de trazabilidad en sección 2.2): la creación de ingredientes no forma parte del flujo de receta bajo ninguna forma. El formulario de receta sólo **lee** el catálogo (`GET /ingredients`) al montarse; no dispara ninguna mutación de ingrediente, por lo que no hay nada que reconciliar en memoria por ese lado.

### 1.3 Manejo de errores: clase de error propia por dominio, con "kind"

Decisión: cada servicio (recetas, ingredientes) define su propia clase de error con un campo `kind` discriminado, siguiendo el patrón ya usado para registro de usuario, y **no** el passthrough genérico al que terminó reducido el manejo de error de plan de comidas tras su limpieza de auth.

Justificación de por qué se diverge del caso de plan de comidas: ese dominio sólo tiene dos operaciones y un único mensaje de error genérico alcanza para ambas ("no pudimos cargar/generar tu plan"). Recetas e ingredientes son un CRUD completo con necesidades de UI realmente distintas según la causa del error:
- Recurso no encontrado (404) al abrir un detalle → pantalla de "no encontrada" con acción de volver al listado, no un banner de error genérico.
- Error de validación (400/422) al guardar un formulario → resaltar campos concretos si el backend detalla cuáles, o al menos un mensaje distinto de "no se pudo guardar" enfocado en revisar el formulario.
- Posible conflicto (409, p. ej. nombre de ingrediente duplicado) → mensaje específico de conflicto, no un error genérico de red.
- Error de red/timeout → mensaje de "sin conexión, reintentá", con acción de reintento.
- Error inesperado → mensaje genérico de último recurso.

Forma conceptual: una clase de error por servicio, con un `kind` de un conjunto cerrado ("no encontrado" / "validación" / "conflicto" / "timeout" / "red" / "inesperado"). **Confirmado** (ver `ApiError` en sección 3 y `plan.md` del explorer): el error 400 del backend no trae un detalle estructurado por campo, sólo `message: string | string[]` con mensajes genéricos de `class-validator`. El formulario cae siempre a un mensaje de validación genérico ("revisá los campos marcados") en vez de intentar mapear ese arreglo de mensajes a campos puntuales — no es una rama pendiente de confirmar, es la única rama posible con este contrato.

### 1.4 Manejo de 401/403 — CONFIRMADO: no se reimplementa localmente

Se confirma explícitamente, como pide el ticket, que **no** se reimplementa manejo de sesión expirada/no autorizada en los servicios ni hooks de este dominio. Las llamadas de recetas e ingredientes usan el cliente HTTP común sin desactivar el manejo de error de autenticación (a diferencia del alta de usuario, que sí lo desactiva porque ocurre antes de que exista una sesión). El interceptor global ya existente intercepta cualquier 401/403 de estas llamadas antes de que lleguen al `catch` de los hooks de este dominio, y dispara el manejador de falla de autenticación ya registrado por el proveedor de sesión de la aplicación (logout/redirección), exactamente como ya ocurre hoy con plan de comidas. Ninguna clase de error de receta/ingrediente debe incluir un `kind` de tipo "no autorizado": ese caso nunca debería llegar a resolverse como error de dominio porque el interceptor lo captura antes.

## 2. Reutilización de formulario crear/editar y selector de ingredientes del catálogo

### 2.1 Un único componente de formulario de receta para crear y editar

Se diseña **un solo componente de formulario de receta**, parametrizado conceptualmente por:
- `modo`: `crear` | `editar`.
- `valoresIniciales`: vacíos en modo crear, precargados con los datos de la receta existente en modo editar.
- `catálogo de ingredientes` disponible para el selector (ver 2.2).
- una función de envío que el formulario invoca con los valores ya validados (el propio componente de formulario no sabe si eso dispara un alta o una modificación; esa decisión vive en quien lo usa).
- una etiqueta de botón de envío ("Guardar Receta" en modo crear; "Guardar Cambios" en modo editar — este segundo texto es un supuesto razonable a partir de la convención habitual de la app, no algo confirmado por la captura del mock).
- el título/ícono de cabecera cambia según el modo (cubiertos + "Nueva Receta" vs. lápiz + "Modificar Receta").

Toda la lógica de validación, el manejo de filas repetibles de ingrediente + cantidad + unidad, la serialización de pasos de preparación (texto libre línea por línea ↔ arreglo de strings) y el envío son **idénticos** entre ambos modos: cero bifurcación de lógica de negocio entre crear y editar, sólo bifurcación de presentación (textos, valores iniciales, callback). Esto responde directamente a la tarea explícita del ticket de "reutilizar componentes entre creación y edición".

### 2.2 [DESCARTADO Y REEMPLAZADO] Selector de ingredientes: sólo lectura del catálogo, sin creación anidada

> **Nota de trazabilidad.** Esta sección reemplaza una versión anterior de este documento que proponía un modal de creación de ingrediente anidado dentro del formulario de receta (con preselección automática del ingrediente recién creado en la fila que lo disparó). Se descarta por instrucción directa del TL del proyecto, dada en una conversación previa al ticket, respondiendo a la pregunta "¿dentro de la creación de la receta tengo la opción de crear el ingrediente?":
>
> *"Por ahora olvidate de la ia. que lo haga el usuario. y lo del ingrediente no te la compliques y hacelo desde afuera de la receta y despues usa el get de ingredientes para listarlos"*
>
> Esta decisión no se reabre en etapas posteriores.

Decisión corregida: la creación de ingredientes **no** vive dentro del formulario de receta bajo ninguna forma (ni modal anidado, ni navegación con retorno que preserve estado). Vive únicamente en su flujo standalone ya descrito en 1.2/4.1 (botón pill "+ Ingrediente" del listado). El formulario de receta se limita a **consumir** el catálogo ya existente mediante `GET /ingredients`:

- Al montarse el formulario de receta (en modo crear o editar), se pide el catálogo completo de ingredientes una única vez — o se reutiliza el catálogo ya cargado si la usuaria llega desde el listado de recetas, que también lo necesita para sus propios filtros, evitando una petición redundante si el dato ya está en memoria del contenedor padre.
- Cada fila de "Ingredientes y Porciones" ofrece un autocompletar/desplegable que filtra en cliente sobre los nombres de ese catálogo ya cargado, sin pedir nada al backend por cada tecla.
- Si la usuaria no encuentra el ingrediente que busca, el formulario lo indica con un mensaje claro en la propia fila (por ejemplo, "No encontramos ese ingrediente. Podés crearlo desde la pantalla de Ingredientes.") **sin ninguna acción de navegación ni modal** asociada a ese mensaje — salir del formulario de receta en ese punto perdería el progreso ya cargado, y evitar esa complicación es exactamente lo que pidió el TL. El texto exacto de ese mensaje, y si además debe permitir seguir escribiendo el nombre a mano mientras tanto, queda como decisión de UX menor para el implementer; dado que el dato real que persiste el backend es un nombre de texto libre (ver sección 3), permitir tipearlo a mano como alternativa es una salida razonable y coherente con el contrato real.
- El selector cumple entonces una función de **conveniencia**, no de relación estructural: ayuda a la usuaria a elegir un nombre ya existente en el catálogo y autocompleta el campo de texto con ese nombre exacto (evitando duplicados por tipeo), pero el campo subyacente que se envía y persiste sigue siendo texto libre. Si la carga del catálogo falla (error de red) o devuelve una colección vacía, el selector de cada fila debe degradar a un campo de texto libre editable a mano en vez de bloquear el formulario: como el dato real no depende de un id de catálogo para persistirse, no depender del catálogo para poder completar y enviar el formulario es una degradación razonable, no una pérdida de funcionalidad crítica.

El componente de formulario de ingrediente ya no tiene un modo "anidado": existe en un único contexto de uso, invocado de forma standalone desde el botón pill "+ Ingrediente" del listado.

### 2.3 Imagen de receta: skeleton estático, no campo de datos

El TL confirmó, sobre el hallazgo de imagen que este documento dejaba pendiente: *"La imagen no existe, por ahora pone un skeleton."* Consecuencia de diseño: en **todos** los lugares donde el mock de Stitch muestra una imagen de receta (la tarjeta del listado, y el detalle de receta), la implementación renderiza un skeleton/placeholder visual estático en su lugar — no una imagen real, no un campo editable en el formulario, no un desplegable de presets. El formulario de Crear/Modificar Receta **no** incluye ningún campo de imagen (ver sección 3 y sección 5).

Es importante no confundir este placeholder con un estado de carga transitorio: no es "la imagen está cargando" ni "todavía no llegó del backend" — es el estado final y permanente de esa zona de la interfaz hasta que el backend soporte imágenes de receta, que hoy no existe como campo. El mismo placeholder estático se muestra siempre, en éxito, no sólo mientras el resto de los datos de la tarjeta/detalle está cargando.

## 3. Contrato de tipos — CONFIRMADO (fuente: ticket NUT-61)

Esta sección reemplaza por completo la versión anterior de este documento, que marcaba la mayoría de los campos como SUPUESTO/NO CONFIRMADO/BRECHA. El backend entregó, vía el ticket de Linear **NUT-61** ("Completar contrato backend de recetas e ingredientes para NUT-20"), el contrato objetivo completo y cerrado que se documenta a continuación. Por instrucción explícita de la usuaria, el frontend se programa contra esta forma **como si la API ya respondiera así**. Ya no queda ninguna ambigüedad de contrato de datos que escalar: se resolvió.

**Aclaración de estado real vs. contrato objetivo (importante para tester/implementer).** El explorer ya había verificado el backend real de NUT-13 en una iteración anterior de este mismo ticket (documentado en `plan.md`, en esta misma carpeta). Cruzando eso contra el contrato de NUT-61:

- **Ya existen hoy, sin cambios, en el backend real** (bajo riesgo, integrable contra el backend corriendo tal cual): `Recipe.id/title/description/prepMinutes/cookMinutes/instructions`, `Recipe.ingredients` como `{name, quantity, unit}` (sin `ingredientId`), `Ingredient.id/name`, `Ingredient.nutritionalValues.{calories,protein,carbs,fat,fiber}`, y el enum `IngredientType` de `Ingredient.type` — los 7 valores de `IngredientType` en el contrato de NUT-61 coinciden exactamente con los que el explorer ya había encontrado en el modelo Prisma real.
- **Son campos nuevos que NUT-61 todavía tiene que construir** (no existen hoy en ningún endpoint real, según lo último verificado por el explorer): `Recipe.categories`, `Recipe.nutritionalValues`, `Recipe.properties`, `Ingredient.description`, `Ingredient.defaultUnit`, `Ingredient.properties`, y el campo `sodium` opcional dentro de `Ingredient.nutritionalValues`.
- Ningún flujo de este ticket depende de `image`, `servings` ni de una relación `ingredientId` — los tres quedan confirmados como inexistentes tanto en el backend real como en el contrato objetivo de NUT-61 (consistente con la decisión de imagen=skeleton ya registrada en sección 2.3).

Consecuencia práctica: si NUT-61 todavía no está desplegado cuando el tester/implementer necesiten integrar de verdad, el patrón ya usado en todo el proyecto (mockear el cliente HTTP/el servicio en los tests, en vez de depender de un backend real corriendo) permite avanzar igual programando contra esta forma. Contra el backend real de hoy, sólo los campos del primer grupo van a responder correctamente; los del segundo grupo requieren que NUT-61 esté al menos parcialmente desplegado (o mockeado) para probarse de punta a punta.

### Enums

- `RecipeCategory`: `'VEGAN' | 'VEGETARIAN' | 'HIGH_PROTEIN' | 'GLUTEN_FREE' | 'DAIRY_FREE' | 'LOW_CARB' | 'OTHER'` — campo nuevo de NUT-61.
- `IngredientType`: `'MEAT' | 'VEGETABLE' | 'FRUIT' | 'DAIRY' | 'GRAIN' | 'SPICE' | 'OTHER'` — ya existe hoy en el backend real.

### Recipe (lectura)

| Campo | Tipo | Nota |
|---|---|---|
| `id` | `string` | Ya existe. |
| `title` | `string` | Ya existe. |
| `description` | `string` | Ya existe, obligatorio (no nullable — corrige la versión anterior de este documento, que lo suponía opcional). |
| `categories` | `RecipeCategory[]` | **Array, no un valor único.** Corrige la descripción anterior del campo del mock como dropdown de selección única: el formulario debe ser **multi-select (chips)**. Campo nuevo de NUT-61. |
| `prepMinutes` | `number` | Ya existe, obligatorio. Confirma definitivamente que sigue separado de `cookMinutes` — no se unifican a nivel de datos; una eventual unificación visual en un único input de "Tiempo" en el formulario sería sólo mapeo de UI, no un cambio de contrato. |
| `cookMinutes` | `number` | Ya existe, obligatorio. |
| `ingredients` | `RecipeIngredientItem[]` = `{name: string, quantity: number, unit: string}` | Ya existe, sin `ingredientId`. Confirma la resolución ya tomada en sección 2.2: el selector del formulario es sólo un autocompletar de conveniencia sobre `GET /ingredients`, nunca una relación por id. |
| `instructions` | `string[]` | Ya existe. |
| `nutritionalValues` | `RecipeNutritionalValues \| null` = `{calories, protein, carbs, fat}` (o `null`) | Campo nuevo de NUT-61. **Nullable en lectura** (datos históricos, p. ej. recetas creadas antes de que NUT-61 exista) — el listado y el detalle deben tolerar `null` sin romperse (mostrar algo como "No especificado"). |
| `properties` | `string[]` | Campo nuevo de NUT-61. Texto libre serializado a array. |
| `createdAt` / `updatedAt` | `string` | No afectan al formulario. |

**Confirmado que NO existen**, ni en el backend real ni en el contrato objetivo: `image`, `servings`, `ingredientId` dentro de cada ítem de `ingredients`.

### CreateRecipeRequest (alta y edición)

`{title, description, categories, prepMinutes, cookMinutes, ingredients, instructions, nutritionalValues, properties}` — mismos campos que `Recipe`, sin `id`/`createdAt`/`updatedAt`. Diferencia importante: **`nutritionalValues` es obligatorio y completo al crear** (los 4 campos `calories/protein/carbs/fat`), a diferencia de la lectura, donde puede ser `null`. Esto corrige la suposición anterior de este documento, que trataba a los valores nutricionales como un grupo opcional a nivel de UI — ya no lo es: el formulario debe exigir los 4 campos tanto al crear como al editar.

`PATCH /recipes/:id` usa el mismo shape para los campos que se incluyan. **Confirmado por backend: `categories`, `properties` y `nutritionalValues` se REEMPLAZAN por completo si se incluyen en el `PATCH`, no se mergean parcialmente.** El formulario de edición debe mandar siempre el array/objeto completo que la usuaria dejó armado en pantalla, nunca un delta respecto de lo que había antes.

### Ingredient (lectura)

| Campo | Tipo | Nota |
|---|---|---|
| `id` | `string` | Ya existe. |
| `name` | `string` | Ya existe. |
| `description` | `string \| null` | Campo nuevo de NUT-61. Nullable en lectura. |
| `type` | `IngredientType` | Ya existe hoy en el backend real (mismo enum de 7 valores ya encontrado por el explorer). Sigue siendo el único campo de clasificación, distinto de `properties`: ya no hay ambigüedad de nombres entre "tipo para shopping-list" y "propiedades/restricciones" — son dos campos reales y separados. |
| `defaultUnit` | `string \| null` | Campo nuevo de NUT-61. Texto libre (no un enum cerrado), nullable en lectura (datos históricos). |
| `nutritionalValues` | `IngredientNutritionalValues` = `{calories, protein, carbs, fat, fiber?, sodium?}` | `calories/protein/carbs/fat/fiber` ya existen hoy; **`sodium` es nuevo de NUT-61** (el backend real hoy no lo tiene, confirmado por el explorer). |
| `properties` | `string[]` | Campo nuevo de NUT-61. |
| `createdAt` / `updatedAt` | `string` | No afectan al formulario. |

### CreateIngredientRequest (alta y edición)

`{name, description?, type, defaultUnit, nutritionalValues, properties}` — a diferencia de la lectura, `defaultUnit` es **obligatorio al crear** (sólo es nullable en lectura de datos históricos, igual que `Recipe.nutritionalValues`). `description` es opcional tanto al crear como en lectura. `type` es obligatorio y se selecciona del enum cerrado `IngredientType`.

### Endpoints

Todos requieren sesión autenticada (cookie de sesión vía `apiClient`, `withCredentials: true`, igual que el resto de la app). Documentados **sin** el prefijo `/api` por ahora, consistente con cómo ya funciona el resto de los servicios del frontend hoy — puede ajustarse si el backend confirma más adelante que agregan un prefijo global, en cuyo caso sólo cambia la base URL del servicio, no su forma.

| Operación | Método + ruta | Respuesta |
|---|---|---|
| Listar recetas | `GET /recipes` | `Recipe[]` |
| Ver receta | `GET /recipes/:id` | `Recipe` |
| Crear receta | `POST /recipes` | `Recipe` |
| Editar receta | `PATCH /recipes/:id` | `Recipe` |
| Borrar receta | `DELETE /recipes/:id` | `Recipe` |
| Listar ingredientes | `GET /ingredients` | `Ingredient[]` |
| Ver ingrediente | `GET /ingredients/:id` | `Ingredient` |
| Crear ingrediente | `POST /ingredients` | `Ingredient` |
| Editar ingrediente | `PATCH /ingredients/:id` | `Ingredient` |
| Borrar ingrediente | `DELETE /ingredients/:id` | `Ingredient` |

Confirmado (ver `plan.md` del explorer): `findAll` de ambos recursos no soporta filtro/búsqueda/paginación en backend. El buscador y los chips de filtro del listado siguen implementándose en cliente, sobre la colección completa.

### Errores

```
type ApiError = { statusCode: number; message: string | string[]; error: string }
```
- `400` → validación (mapea al `kind` de validación de la clase de error propia, sección 1.3).
- `401` → sesión vencida; lo resuelve el interceptor global ya existente, **no se reimplementa localmente** (confirma la decisión ya tomada en sección 1.4).
- `404` → recurso no encontrado.
- `409` → ingrediente duplicado, o ingrediente en uso al intentar renombrarlo/borrarlo (consistente con lo ya documentado por el explorer sobre `isIngredientInUse`).

## 4. Flujos y árbol de estados

### 4.1 Mapa de navegación

- Listado → botón circular "+" → Crear Receta (formulario en modo crear, con el selector de ingredientes poblado por lectura del catálogo vía `GET /ingredients` — sin creación inline, ver sección 2.2) → Guardar Receta → éxito → cierra el formulario → vuelve al Listado ya actualizado (refetch).
- Listado → botón pill "+ Ingrediente" → modal de Crear Ingrediente standalone → Guardar → éxito → cierra el modal → catálogo de ingredientes actualizado (refetch), vuelve al Listado.
- Listado → tocar una tarjeta de receta → Detalle de Receta (carga por id).
- Detalle → ícono lápiz → Modificar Receta (mismo formulario que Crear, en modo editar, mismo selector de ingredientes de sólo lectura sobre el catálogo) → Guardar Cambios → éxito → vuelve al Detalle ya actualizado (refetch del detalle); el Listado queda marcado para refrescarse cuando se vuelva a mostrar.
- Detalle → ícono tacho → Confirmación de borrado → "Eliminar" → éxito → vuelve al Listado ya actualizado (refetch); "Cancelar" → vuelve al Detalle sin cambios.
- Detalle → botón "Cerrar Detalle" o ícono ✕ → vuelve al Listado (sin forzar refetch si no hubo mutación).

### 4.2 Árbol de estados por pantalla

**Listado**
- Cargando: skeleton de tarjetas (mismo lenguaje visual que el skeleton ya usado en plan de comidas: bloques con animación de pulso sobre el color de superficie de marca).
- Vacío: sin recetas cargadas todavía → mensaje claro + call to action para crear la primera receta (reutilizando el mismo botón de creación del header/FAB).
- Vacío por filtro/búsqueda sin resultados: distinto del vacío real — mensaje de "no encontramos recetas que coincidan" con acción de limpiar filtros, no de "crear tu primera receta".
- Error de carga: mensaje claro + botón de reintento (mismo patrón que plan de comidas), sin perder de vista si había datos previos cargados (no se borra un listado ya válido ante un error de un refresh manual posterior; se conserva y se muestra el error junto con los datos existentes, igual que ya se decide para plan de comidas).
- Éxito: listado con buscador, chips de filtro dinámicos por categoría (incluyendo "Todas (N)"), contador de recetas disponibles, botón de actualizar manual.

**Crear/Modificar Receta**
- Formulario en blanco (crear) o precargado (editar).
- Validando: mientras se envía, deshabilitar el botón de envío y mostrarlo en estado de carga, para evitar doble envío.
- Error de envío: banner de error dentro del propio formulario (no se cierra el formulario, el usuario no pierde lo cargado) — mensaje distinto según el tipo de error (validación vs. red vs. inesperado, ver 1.3).
- Éxito: cierra el formulario y navega según el flujo de 4.1.

**Crear Ingrediente**
- Mismos estados que el formulario de receta, a escala menor (formulario más corto).

**Detalle de Receta**
- Cargando: skeleton del detalle (imagen + stats + secciones en placeholder).
- No encontrada (404): pantalla distinta del error genérico — mensaje de "esta receta ya no está disponible" con acción de volver al listado (puede haber sido borrada por otra sesión, o el id ya no existe).
- Error de red/inesperado: mensaje claro + reintento, igual que el listado.
- Éxito: skeleton/placeholder estático de imagen (ver sección 2.3, no es una imagen real ni un estado transitorio) con badge de categoría superpuesto, stats, descripción, ingredientes con cantidad/unidad, pasos numerados, propiedades/restricciones, acciones de editar/borrar.

**Confirmación de borrado**
- Estado por defecto (advertencia + dos botones).
- Borrando: botón "Eliminar" deshabilitado/en carga mientras se resuelve la petición.
- Error al borrar: el modal de confirmación no se cierra solo; se muestra el motivo (por ejemplo, si el recurso ya no existe, mostrarlo como tal en vez de un error genérico) y se deja reintentar o cancelar.

## 5. Validaciones

- Nombre de la receta (`title`): obligatorio, no vacío tras recortar espacios.
- Categorías (`categories: RecipeCategory[]`): **multi-select tipo chips** sobre el enum cerrado `RecipeCategory` (corrige la versión anterior de este documento, que lo describía como un dropdown de selección única). Obligatorio al menos **una** categoría seleccionada — el mock siempre muestra un badge de categoría, así que no se permite guardar sin ninguna.
- Tiempo (`prepMinutes`/`cookMinutes`): ambos obligatorios, numéricos, enteros positivos (no se aceptan negativos ni cero). Siguen siendo dos campos de datos separados aunque el formulario decida mostrarlos como un único input visual de "Tiempo" (ver sección 3) — si se opta por esa unificación visual, la validación igual debe garantizar que ambos valores numéricos terminen completos antes de enviar.
- Descripción breve (`description`): obligatoria, no vacía.
- Valores nutricionales (`nutritionalValues`): **obligatorios y completos al crear y al editar** — los 4 campos (`calories`, `protein`, `carbs`, `fat`), todos numéricos y no negativos. Corrige la versión anterior de este documento, que los trataba como un grupo opcional a nivel de UI: el contrato de NUT-61 exige el objeto completo en `CreateRecipeRequest`, sin campos parciales.
- Ingredientes y porciones: obligatorio al menos un ingrediente; cada fila requiere nombre de ingrediente no vacío, cantidad numérica mayor a cero, y unidad no vacía. No se permite guardar la receta con cero filas de ingrediente, ni con una fila incompleta — el submit se bloquea con el error señalado en la fila específica, no como un error genérico de formulario.
- Pasos de preparación (`instructions`): obligatorio, no vacío; se interpreta cada línea no vacía como un paso, se descartan líneas en blanco al serializar a arreglo.
- Propiedades y restricciones de la receta (`properties: string[]`): **opcional**, puede quedar vacío (`[]`) — el mock no lo marca con asterisco. Texto libre o chips serializado a array de strings antes de enviar.
- Imagen: **no se construye este campo**. El mock de Stitch lo mostraba como "Imagen (URL o Selección) *", pero el TL confirmó que no existe soporte de backend y que la decisión de producto es no implementarlo — en su lugar se muestra un skeleton/placeholder estático (ver sección 2.3). Confirmado además por el contrato de NUT-61: `Recipe` no tiene ningún campo de imagen. No hay, por lo tanto, ninguna validación de campo de imagen que aplicar al formulario.
- Ingrediente — nombre (`name`): obligatorio. Tipo (`type: IngredientType`): obligatorio, selección de un valor del enum cerrado (no confundir con "propiedades y restricciones", que es un campo de texto libre aparte). Unidad habitual (`defaultUnit`): obligatoria al crear/editar (texto libre, no un enum cerrado — puede ofrecerse como desplegable de sugerencias curadas en la UI sin que eso implique una validación estricta contra una lista cerrada de backend). Descripción (`description`): opcional. Calorías/proteínas/carbohidratos/grasas (`calories`/`protein`/`carbs`/`fat`): obligatorios y numéricos no negativos. Fibra/sodio (`fiber`/`sodium`): opcionales, si se cargan deben ser numéricos no negativos. Propiedades y restricciones (`properties: string[]`): opcional, puede quedar vacío, texto libre separado por comas o chips, se recorta cada valor al serializar a array.

## 6. Historias de usuario y criterios de aceptación

1. Como usuaria, veo el listado de mis recetas actuales al entrar a la pantalla → AC1.
2. Como usuaria, completo un formulario para crear una receta nueva con sus datos, ingredientes y pasos → AC2.
3. Como usuaria, completo un formulario para crear un ingrediente nuevo, sea desde el listado o desde el formulario de receta → AC3.
4. Como usuaria, toco una receta del listado y veo su detalle completo → AC4.
5. Como usuaria, en el detalle veo ingredientes con cantidad/unidad, propiedades y valores nutricionales → AC5.
6. Como usuaria, edito una receta existente y sus ingredientes relacionados desde su detalle → AC6.
7. Como usuaria, borro una receta sólo después de confirmar explícitamente que quiero hacerlo → AC7.
8. Como usuaria, veo el listado reflejar de inmediato cualquier alta, edición o borrado → AC8.
9. Como usuaria, entiendo claramente cuándo algo está cargando o falló, y puedo reintentar → AC9.
10. Como usuaria, si me equivoco al cargar un campo obligatorio, un número o una relación de ingrediente, el formulario me lo señala antes de guardar → AC10.
11. Como usuaria, puedo usar toda esta pantalla desde mi teléfono, tablet y escritorio sin comportamientos rotos → AC11. **Corrección de alcance:** tablet/desktop son parte de este mismo ticket, no quedan para después (ver sección 9).
12. Como usuaria, en ningún momento la pantalla genera contenido automáticamente ni llama a un servicio de IA → AC12.
13. Como parte del equipo, cuento con pruebas que cubren listado, formularios, detalle, edición, borrado y estados de error → AC13.

## 7. Pruebas requeridas

**Hook/servicio de listado de recetas**
- Éxito con datos → estado de éxito con la colección esperada.
- Éxito con colección vacía → estado vacío (distinto de error).
- Error de red/backend → estado de error con mensaje, sin perder datos previos si ya había un listado cargado.
- Filtro por categoría → sólo se muestran las recetas de la categoría elegida, "Todas" muestra el total.
- Búsqueda por nombre/ingrediente → filtra correctamente, sin resultados muestra el vacío-por-filtro (no el vacío real).
- Acción "Actualizar" manual → vuelve a pedir los datos y refleja cambios.

**Hook/servicio de ingredientes**
- Éxito/error al listar el catálogo (usado por el selector del formulario de receta y por el listado standalone de ingredientes).
- Alta exitosa (flujo standalone, único flujo existente) → dispara refetch del catálogo completo; el nuevo ingrediente aparece en la siguiente lectura del catálogo.
- Alta con error de validación/conflicto/red → cada `kind` se refleja en un mensaje distinto.

**Formulario de receta (crear y editar, mismo componente)**
- Validación de campos obligatorios: no deja enviar con nombre vacío, ninguna categoría seleccionada, tiempo vacío o no numérico, descripción vacía, cualquiera de los 4 valores nutricionales vacío/no numérico, cero filas de ingrediente, fila de ingrediente incompleta, o pasos de preparación vacíos.
- Multi-select de categorías: permite seleccionar más de una categoría a la vez (chips), refleja el estado seleccionado correctamente, y bloquea el envío si se deseleccionan todas.
- Serialización de "Propiedades y Restricciones" de texto/chips a `string[]` antes de enviar, y deserialización correcta al precargar un valor existente en modo editar.
- Envío exitoso en modo crear → dispara la operación de alta con el payload esperado (incluyendo `categories` como array y `nutritionalValues` completo) y sigue el flujo de éxito de 4.1.
- Envío exitoso en modo editar → precarga de valores iniciales verificada (incluyendo `categories`/`properties`/`nutritionalValues` ya cargados), dispara la operación de edición con el id correcto **mandando el array/objeto completo** de `categories`/`properties`/`nutritionalValues` (no un delta), consistente con la semántica de reemplazo total del `PATCH` confirmada en sección 3.
- Envío con error del backend (validación/conflicto/red) → el formulario muestra el error correspondiente y no pierde los datos cargados.
- El catálogo de ingredientes se pide una sola vez al montar el formulario (`GET /ingredients`) y se reutiliza en todas las filas, sin volver a pedirlo al agregar una nueva fila.
- Cada fila de ingrediente filtra/sugiere correctamente sobre el catálogo ya cargado a medida que la usuaria escribe.
- Si la carga del catálogo falla (error de red) o devuelve una colección vacía, cada fila degrada a un campo de texto libre editable a mano, sin bloquear poder completar y enviar el formulario.
- Al precargar en modo editar una receta cuyo `nutritionalValues` viene `null` desde el backend (dato histórico), el formulario no rompe: muestra los campos vacíos/en blanco listos para completar, no lanza un error de tipo.
- No existe ningún caso de prueba de creación de ingrediente disparada desde el formulario de receta: esa pieza fue descartada por instrucción directa del TL (ver sección 2.2) y no debe implementarse.

**Formulario de ingrediente (uso único, standalone)**
- Validación de campos obligatorios y numéricos (incluye que fibra/sodio sean opcionales pero numéricos si se cargan).
- Envío exitoso → cierra el modal y refresca el catálogo.
- Envío con error → banner de error dentro del modal, sin cerrarlo.

**Detalle de receta**
- Carga exitosa → muestra ingredientes con cantidad/unidad, categorías, valores nutricionales, propiedades, pasos numerados.
- Carga con `nutritionalValues: null` (dato histórico) → el detalle no rompe, muestra un fallback claro (p. ej. "No especificado") en vez de un valor numérico o un error.
- Carga con id inexistente (404) → estado "no encontrada" con acción de volver, distinto del error genérico.
- Carga con error de red → estado de error con reintento.
- Editar desde el detalle → abre el formulario en modo editar con los valores correctos precargados; al guardar, el detalle se refresca con los datos nuevos.
- Borrado con confirmación → el ícono tacho abre el modal de confirmación; "Cancelar" no borra nada y vuelve al detalle intacto; "Eliminar" dispara el borrado y, en éxito, navega al listado ya actualizado; en error, el modal permanece abierto mostrando el motivo.

**Listado de ingredientes / selector del formulario de receta**
- Un ingrediente con `description: null` o `defaultUnit: null` (dato histórico) se muestra/usa sin romper: fallback claro en vez de un valor vacío o un error de render.

**Adaptación tablet/desktop (layout de dos columnas, ver sección 9)**
- En viewport ancho (por encima del breakpoint de 9.2), al entrar a la pantalla con al menos una receta cargada, el panel derecho selecciona y muestra automáticamente el detalle de la **primera** receta de la lista, sin necesidad de ningún click.
- En viewport ancho con el listado vacío (vacío real, no vacío-por-filtro), el panel derecho muestra el estado vacío de escritorio (mensaje + CTA), no intenta seleccionar ninguna receta.
- La columna izquierda (listado) permanece visible y montada mientras el panel derecho muestra el detalle, el formulario de creación o el formulario de edición — ninguno de los tres estados del panel derecho oculta ni desmonta el listado.
- Clickear "Nueva Receta" reemplaza el contenido del panel derecho por `RecipeForm` en modo crear, renderizado **inline, sin `Modal`** (se verifica que no queda envuelto en un contenedor con `role="dialog"`); clickear "Modificar Receta" desde el detalle hace lo mismo en modo editar, con los valores de la receta actualmente mostrada precargados.
- Clickear "+ Crear Ingrediente" desde el header abre `IngredientForm` en un `Modal` centrado (con `role="dialog"`), igual que en mobile, sin importar qué esté mostrando el panel derecho en ese momento (detalle, formulario de creación o de edición de receta) — y ese contenido de fondo permanece montado e intacto mientras el modal está abierto y también si se cancela.
- Guardar una receta exitosamente desde el `RecipeForm` inline de escritorio dispara el mismo refetch ya decidido en la sección 1.2 y actualiza tanto la columna izquierda como el panel derecho, sin duplicar la petición entre ambas columnas.
- No existe ningún caso de prueba de creación de ingrediente disparada desde dentro de `RecipeForm` en la variante de escritorio: sigue descartado en todas las variantes (ver sección 2.2).

## 8. Estrategia de datos y migraciones

Este ticket, en sí mismo, **no modifica el esquema de Prisma ni agrega migraciones**: es un trabajo de integración de frontend. Las migraciones/cambios de schema que hagan falta para que el backend real termine de exponer el contrato completo de la sección 3 (`categories`, `nutritionalValues` y `properties` en `Recipe`; `description`, `defaultUnit`, `properties` y `sodium` en `Ingredient`) son responsabilidad de **NUT-61**, que se construye en paralelo — no de este ticket ni de esta etapa de diseño de frontend. El frontend se programa contra el contrato ya cerrado de NUT-61 (sección 3) independientemente de en qué momento exacto el backend termine de desplegarlo, mockeando el servicio HTTP en los tests donde haga falta (mismo patrón ya usado en todo el proyecto).

## 9. Mobile-first y adaptación tablet/desktop (ambas etapas de este mismo ticket)

> **Corrección de alcance de la usuaria**, que reemplaza la versión anterior de esta sección (que trataba tablet/desktop como trabajo futuro fuera de este PR): el criterio de aceptación 11 aplica de verdad dentro de este mismo ticket NUT-20. La versión mobile ya fue implementada y validada por completo (listado, formularios, detalle, borrado, integración real contra el contrato de NUT-61 de la sección 3). Lo que sigue es la adaptación de escritorio/tablet, construida por **composición** sobre exactamente los mismos servicios/hooks/componentes de formulario ya construidos y ya testeados para mobile — cero lógica nueva de validación ni de integración, sólo layout nuevo condicionado por ancho de pantalla.

### 9.1 Orden de validación (ya cumplido)

Mobile se implementó y validó primero dentro de este PR, tal como establecía la versión anterior de esta sección. Esa secuencia ya se cumplió. La adaptación de escritorio/tablet es la capa siguiente sobre la misma base de componentes/hooks/servicios, no un ticket ni un PR distinto.

### 9.2 Layout de escritorio/tablet: dos columnas

Confirmado por la usuaria a partir de mockups de escritorio: por debajo del panel de navegación lateral ya existente de la aplicación autenticada y de un header con buscador + botón "+ Crear Ingrediente" + botón "Nueva Receta" (ambos visibles siempre en el header en esta variante, no sólo en el listado), el contenido se organiza en **dos columnas**:

- **Columna izquierda**: el listado de recetas — mismos chips de filtro, mismas tarjetas (badge de categoría, título, descripción, tiempo, calorías, macro destacado), mismo hook de listado (`useRecipes`) ya construido para mobile, sin ningún cambio de lógica. Permanece **siempre visible**, incluso mientras el panel derecho muestra un detalle, un formulario de creación o uno de edición — a diferencia de mobile, donde el detalle y los formularios reemplazan la pantalla completa.
- **Columna derecha**: un panel de contenido dinámico único, que alterna entre tres estados de UI (nunca dos a la vez): detalle de la receta seleccionada, formulario de creación de receta, o formulario de edición de receta. Es el mismo `RecipeForm`/detalle ya construidos para mobile; lo único que cambia es cómo se los envuelve (ver 9.3).

Breakpoint sugerido: el propio de `lg:` de Tailwind (contenido de escritorio/tablet ancho), consistente con el criterio ya usado en el resto del proyecto para distinguir mobile de layouts más anchos — a confirmar contra el breakpoint concreto que ya esté estandarizado en la aplicación, si difiere. Por debajo de ese breakpoint se sigue usando exactamente el layout mobile ya construido (una sola columna, formularios en `Modal`/bottom-sheet, sin panel derecho persistente); no hay un tercer layout intermedio a diseñar en esta etapa.

### 9.3 Decisión de composición: `RecipeForm` inline en desktop, en `Modal` en mobile

**Decisión de arquitectura:** en escritorio/tablet, `RecipeForm` (el mismo componente compartido de crear/editar ya descrito en la sección 2.1, sin bifurcación de lógica entre ambos modos) se renderiza **directamente dentro de la columna derecha, sin ningún `Modal` envolviéndolo** — ni al crear ni al editar. En mobile, ese mismo `RecipeForm` sigue apareciendo envuelto en `Modal` (bottom-sheet), exactamente como ya se construyó y testeó.

Esto es una diferencia real de **composición** para el mismo componente, no una bifurcación del componente en sí: `RecipeForm` no sabe ni le importa si quien lo renderiza es un `Modal` (mobile) o el panel derecho de un layout de dos columnas (desktop/tablet) — sigue recibiendo las mismas props (`modo`, `valoresIniciales`, catálogo de ingredientes, callback de envío, label de botón) y ejecutando la misma validación e integración ya construidas. Quien decide si envolverlo en `Modal` o no es el componente contenedor de la pantalla, condicionado por el mismo breakpoint de 9.2.

`IngredientForm`, en cambio, **sigue envuelto en `Modal` en las dos variantes**, mobile y desktop/tablet, sin cambios: en escritorio se dispara desde el botón "+ Crear Ingrediente" del header (visible siempre, no sólo en el listado) y se superpone como modal centrado a lo que sea que esté en ese momento en el panel derecho — incluido un `RecipeForm` a medio completar, que permanece montado e intacto debajo mientras el modal de ingrediente está abierto. Esto es consistente con la decisión ya tomada (y reconfirmada por la usuaria en esta misma corrección) de que la creación de ingredientes **nunca** se dispara desde dentro del formulario de receta, en ninguna variante — ver sección 2.2, que no cambia.

La confirmación de borrado (`ConfirmDialog`/`Modal`) tampoco cambia entre variantes: sigue siendo un modal centrado idéntico al ya construido para mobile.

### 9.4 Selección automática de la primera receta (comportamiento exclusivo de escritorio/tablet)

Confirmado por la usuaria: al entrar a la pantalla de recetas en escritorio/tablet, si el listado tiene al menos una receta cargada, el panel derecho muestra automáticamente el **detalle de la primera receta de la lista**, sin esperar ningún click — nunca se ve un panel derecho vacío mientras haya recetas. Si el listado está vacío (estado vacío real, no vacío-por-filtro), el panel derecho muestra el equivalente de escritorio del estado vacío ya descrito en la sección 4.2 (mensaje + CTA de crear la primera receta), en vez de intentar seleccionar algo que no existe.

Este comportamiento **no aplica a mobile**: ahí no hay panel de detalle persistente, el detalle sigue siendo una pantalla separada a la que se llega tocando una tarjeta, tal como ya está construido y validado.

### 9.5 Navegación: se reutilizan las mismas rutas, sin duplicar fetch

Estrategia propuesta, sin crear rutas nuevas ni duplicar la obtención de datos entre el "modo lista" y el "modo con detalle":

- Se siguen usando exactamente las mismas rutas ya existentes, `/recipes` y `/recipes/:id`. Ninguna variante de ancho de pantalla agrega un segmento de ruta nuevo.
- `/recipes/:id` en escritorio/tablet renderiza el layout de dos columnas completo: columna izquierda con el listado (`useRecipes`, el mismo hook, la misma petición que ya hace hoy en mobile para poblar la lista) y columna derecha con el detalle de esa receta (`useRecipeDetail(id)`, el mismo hook ya construido). En mobile, esa misma ruta sigue renderizando únicamente el detalle a pantalla completa, sin columna izquierda — mismo dato, mismos hooks, distinta composición visual según el breakpoint de 9.2.
- `/recipes` (sin id) en escritorio/tablet: si el listado ya cargado (por `useRecipes`) tiene al menos una receta, se normaliza a `/recipes/:id` de la primera receta de la lista (ver 9.4) — sin volver a pedir el listado ni el detalle por separado, ya que el id de la primera receta sale del mismo listado que la columna izquierda ya tiene en memoria. Si el listado está vacío, `/recipes` se queda tal cual, mostrando el layout de dos columnas con el estado vacío de 9.4 en el panel derecho.
- Los estados de "Nueva Receta"/"Modificar Receta" (`RecipeForm` inline, sección 9.3) **no son una ruta nueva**: son un estado de UI local del componente contenedor de la pantalla (algo como "modo del panel derecho: detalle | crear | editar"), superpuesto sobre lo que sea que la URL diga en ese momento. Clickear "Nueva Receta" o "Modificar Receta" cambia ese estado local, no navega a una URL distinta — la URL sigue apuntando a la última receta seleccionada (o a `/recipes` si no había ninguna), consistente con que ya en mobile estos formularios se tratan como una superposición (`Modal`) y no como una ruta propia. Al guardar con éxito, el estado local vuelve a "detalle" y, si corresponde (creación nueva, o edición que cambió cuál receta se muestra), se ajusta el id de la URL sin recargar el listado completo salvo el refetch ya decidido en la sección 1.2.

### 9.6 Confirmación: cero lógica de negocio nueva

Toda la adaptación de escritorio/tablet descrita en esta sección es composición y layout puro sobre componentes, hooks y servicios ya construidos, testeados e integrados contra el contrato real de la sección 3 en la etapa mobile: `RecipeForm`, `IngredientForm`, `Modal`, `ConfirmDialog`, `useRecipes`, `useRecipeDetail`, `useIngredients`. No se agrega ninguna validación nueva, ningún caso de error nuevo, ningún campo nuevo, ni ninguna llamada de red que no existiera ya para mobile. La única superficie nueva de código es la composición del layout de dos columnas y el estado local de "modo del panel derecho" descrito en 9.5.

## 10. Nota sobre paleta e iconografía

Queda registrado, para que ningún agente posterior lo reabra: el diseño visual de esta pantalla usa la paleta y los patrones de componentes ya existentes en el proyecto (verde y crema de marca, tipografía serif ya usada para títulos, superficies con esquinas redondeadas y sombra suave, botones de altura táctil mínima ya usados en el resto de la app) y los íconos se implementan como componentes SVG inline propios, siguiendo el mismo patrón ya usado en el proyecto — no se adopta la paleta ni la tipografía ni la librería de íconos que traían los mockups de Stitch originales, ni se instala ninguna librería de íconos nueva. Esta decisión ya fue tomada con la usuaria y no es parte de lo que este ticket debe decidir.
