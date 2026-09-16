# NUT-20 — Plan: pantalla de recetas e ingredientes

Generado: 2026-09-15T23:19:39Z
Autor: `nutria_frontend_explorer`
Fuente: `.plans/nut-20-recetas-e-ingredientes/design.md` (decision record) + código real de NUT-13 en `apps/api/`.

Convención: todo lo marcado **CONFIRMADO** fue leído directamente en el archivo citado. Todo lo marcado **BRECHA** es una discrepancia real entre lo que design.md/el mock necesitan y lo que el backend expone hoy — no se propone solución de alcance, se documenta para escalar.

---

## Prioridad #1 — hallazgo de mayor riesgo (verificado primero)

**BRECHA CRÍTICA CONFIRMADA: `Recipe.ingredients` sigue siendo JSON de texto embebido, sin relación por id a un catálogo de `Ingredient`.**

Evidencia:

1. `Ingredient` SÍ es una entidad de catálogo propia con `id`, listable/creable de forma independiente:
   - Modelo: `apps/api/prisma/models/ingredient.prisma` líneas 11-21 — `model Ingredient { id String @id @default(uuid()), name String @unique, type IngredientType, nutritionalValues Json, createdAt, updatedAt }`.
   - Endpoints reales en `apps/api/src/modules/ingredient/ingredient.controller.ts`:
     - `POST /ingredients` (línea 12-15, `IngredientController.create`)
     - `GET /ingredients` (línea 17-20, `findAll`)
     - `GET /ingredients/:id` (línea 22-25, `findOne`)
     - `PATCH /ingredients/:id` (línea 27-30, `update`)
     - `DELETE /ingredients/:id` (línea 32-35, `remove`)
     - Todos protegidos por `@UseGuards(JwtAuthGuard)` a nivel de controller (línea 7).

2. **NO existe** una tabla intermedia tipo `RecipeIngredient` con `ingredientId` + `quantity` + `unit`. La relación real es:
   - Modelo `Recipe` (`apps/api/prisma/models/recipe.prisma` líneas 1-16): el campo `ingredients` es `Json` (línea 7), sin ninguna relación Prisma (`@relation`) hacia `Ingredient`. No hay FK.
   - DTO real `apps/api/src/modules/recipe/dto/create-recipe.dto.ts` líneas 4-13: `RecipeIngredientItemDto { name: string; quantity: number; unit: string }` — **por nombre de texto libre, no por `ingredientId`**. Mismo shape en `update-recipe.dto.ts` líneas 1-34 (reutiliza `RecipeIngredientItemDto`).
   - Persistencia: `apps/api/src/modules/recipe/recipe.repository.ts` línea 14 y 40 — el array de ingredientes se graba tal cual como `Json` (`ingredients: data.ingredients as any`), no se resuelve/valida contra la tabla `Ingredient`.
   - Prueba adicional de que la relación es por nombre y no por id: `apps/api/src/modules/ingredient/ingredient.repository.ts` líneas 51-59, método `isIngredientInUse(name)` — para saber si un ingrediente está "en uso" en alguna receta, el backend hace una **raw query JSONB** que busca por `name` dentro del campo `Recipe.ingredients` (`SELECT id FROM "recipes" WHERE "ingredients" @> '[{"name": "..."}]'::jsonb`). Si existiera una FK por `ingredientId`, esta búsqueda sería un `WHERE ingredientId = ...` normal en la tabla intermedia, no una query JSONB por nombre. Esto confirma que el vínculo Recipe↔Ingredient es puramente por coincidencia de texto (`name`), no por id.

3. **Conclusión — brecha explícita y crítica a escalar, no a resolver desde este ticket:**
   El mock exige un selector con autocomplete que elija un `Ingredient` **existente del catálogo por id**, con cantidad+unidad por fila, y que ese vínculo sea reutilizable/consistente entre recetas. El backend real de NUT-13 no modela esa relación: `Recipe.ingredients` acepta cualquier `{name, quantity, unit}` de texto libre, desconectado del `id` del catálogo. Como consecuencia:
   - El frontend puede implementar el selector para que el usuario *elija visualmente* un ingrediente del catálogo (`GET /ingredients`) y autocompletar el campo `name` a partir de esa elección — pero el backend **no persiste ni valida** que ese `name` siga correspondiendo a un `Ingredient.id` real después de guardado. Si alguien renombra o borra un ingrediente del catálogo (bloqueado sólo si "está en uso" según la búsqueda por nombre, ver punto 2), una receta ya guardada con ese `name` como texto queda desincronizada del catálogo sin que el backend lo sepa, salvo por la coincidencia exacta de string.
   - No hay forma de, dado un `Recipe.ingredients[i]`, recuperar el `Ingredient.id`/`type`/`nutritionalValues` reales de catálogo sin volver a buscar por `name` en el listado completo de ingredientes ya cargado en memoria (matching por string, sensible a mayúsculas/tildes/espacios).
   - Esta es exactamente la brecha que design.md sección 3 y sección 8 anticipan como "hallazgo de mayor riesgo" y piden escalar como decisión de alcance, no resolver con una migración desde esta etapa de frontend. **Se documenta aquí tal cual, sin proponer solución**, para que el equipo decida antes de que el tester/implementer avancen: (a) implementar el selector igual, aceptando que el vínculo es por nombre y no por id (con el riesgo de desincronización ya descripto), o (b) pausar esta pieza del ticket hasta que NUT-13 (o un ticket de backend nuevo) agregue la relación `RecipeIngredient` real.

---

## Resto de campos del contrato (sección 3 de design.md)

### Recipe — confirmado contra `apps/api/prisma/models/recipe.prisma` y los DTOs reales

| Campo | Estado real confirmado |
|---|---|
| `id` | `String @id @default(uuid())` — `recipe.prisma` línea 2. |
| `title` | `String` obligatorio — `recipe.prisma` línea 3; DTO `create-recipe.dto.ts` línea 16-17 (`@IsString() title!`). |
| `description` | `String` **obligatorio** (no opcional) — `recipe.prisma` línea 4; DTO línea 19-20 (`@IsString() description!`, sin `@IsOptional`). Esto corrige design.md sección 3, que lo marcaba "CONFIRMADO (opcional)": en el `Recipe` real de NUT-13 es obligatorio tanto en creación como en el modelo. |
| Tiempo de preparación | **Siguen separados `prepMinutes` y `cookMinutes`**, ambos `Int` obligatorios en el modelo (`recipe.prisma` líneas 5-6) y en `CreateRecipeDto` (líneas 22-26, ambos `@IsNumber()` sin `@IsOptional`). NUT-13 **no** unificó esto en un solo campo. El mock de este ticket muestra un único "Tiempo (minutos)": el formulario deberá mapear ese campo único a ambos `prepMinutes`/`cookMinutes` (p. ej. duplicando el valor, o decidiendo cuál de los dos representa "tiempo total") **o** exponer dos campos en el formulario apartándose del mock. Esto es una decisión de UX a escalar, no una brecha de backend — el dato existe, sólo no calza 1:1 con el mock. |
| `instructions` | `String[]` — `recipe.prisma` línea 8; confirmado como arreglo de strings, `@ArrayMinSize(1)` obligatorio en create (línea 34-37) y editable opcionalmente en update (línea 29-33). Coincide con design.md. |
| ingredientes de receta | Ver Prioridad #1 — BRECHA CRÍTICA. Forma real: `Json`, validado en DTO como `RecipeIngredientItemDto[]` = `{name: string, quantity: number, unit: string}` (ambos `create-recipe.dto.ts` líneas 4-13 y `update-recipe.dto.ts` reutilizando el mismo tipo), `@ArrayMinSize(1)` obligatorio. |
| categoría dietaria | **NO EXISTE** en el modelo `Recipe` real (`recipe.prisma` líneas 1-16 no tiene ningún campo de categoría/tipo de dieta/etiquetas) ni en los DTOs. **BRECHA**: el mock pide chips de categoría y un desplegable de categoría dietaria en el formulario; el backend de NUT-13 no tiene ningún campo para esto. No hay dónde persistirlo ni de dónde leerlo. A escalar. |
| valores nutricionales a nivel receta | **NO EXISTEN** como campos de `Recipe` (`recipe.prisma` no tiene `calories`/`protein`/`carbs`/`fat`, ni el DTO los valida). Confirmado que siguen viviendo únicamente en `PlannedMeal.nutritionalValues` (ver `apps/web/src/services/mealPlanService.ts` líneas 26-31, tipo `NutritionalValues`), consistente con la regla general del dominio ("la receta es puramente un catálogo instruccional"). **BRECHA**: el mock pide cargar valores nutricionales a nivel receta; el backend no lo soporta. A escalar. |
| propiedades/restricciones | **NO EXISTE** ningún campo de este tipo en `Recipe` real. **BRECHA**, exclusiva del mock. |
| imagen | **NO EXISTE** ningún campo de imagen/URL en el modelo `Recipe` real ni en los DTOs (`recipe.prisma` líneas 1-16, `create-recipe.dto.ts` líneas 15-38). **BRECHA total, no sólo de obligatoriedad**: no es que sea opcional en vez de obligatoria como sugería el mock — directamente no existe el campo en el backend. El criterio por defecto de design.md ("tratarla como opcional en el tipo de frontend, no exigirla en el formulario salvo que el backend la requiera") se ajusta: como el backend no tiene el campo, **no se puede enviar ni persistir una imagen real**; si se muestra algo en la UI tendrá que ser un placeholder visual fijo/local, no un dato de backend, hasta que se escale. |

### Ingredient — confirmado contra `apps/api/prisma/models/ingredient.prisma` y los DTOs reales

| Campo | Estado real confirmado |
|---|---|
| `id` | `String @id @default(uuid())` — `ingredient.prisma` línea 12. |
| `name` | `String @unique` — `ingredient.prisma` línea 13; DTO `create-ingredient.dto.ts` línea 24-25 (`@IsString() name!`). Confirma el supuesto de design.md; además ahora se sabe que el nombre es único a nivel de base (constraint `@unique`), lo cual es consistente con el `ConflictException` de `ingredient.service.ts` línea 11-14 al crear con nombre repetido. |
| `description` | **NO EXISTE** ningún campo `description` en `Ingredient` real (`ingredient.prisma` líneas 11-21) ni en los DTOs. **BRECHA**: el mock lo pide como campo opcional; el backend no lo tiene. |
| unidad de medida habitual | **NO EXISTE** ningún campo de "unidad de medida habitual" en `Ingredient` (a diferencia de `RecipeIngredientItemDto.unit`, que es la unidad **por receta**, texto libre `@IsString()`, ver `create-recipe.dto.ts` línea 11-12). El catálogo de `Ingredient` en sí no tiene unidad propia. Ya no aplica la pregunta de "¿enum cerrado o texto libre?" para `Ingredient.unit`, porque ese campo no existe a nivel de catálogo; sólo existe `unit` como texto libre por fila de receta. Si el mock necesita una "unidad habitual" del ingrediente (para preseleccionar la unidad al elegirlo en el selector de receta), esto es una **BRECHA** a escalar: no hay de dónde leerla, habría que inferirla en frontend o pedir el campo a backend. |
| valores nutricionales | Campo real es `nutritionalValues: Json`, validado por `IngredientNutritionalValuesDto` (`create-ingredient.dto.ts` líneas 5-21): `calories: number` (obligatorio), `protein: number` (obligatorio), `carbs: number` (obligatorio), `fat: number` (obligatorio), `fiber?: number` (opcional). **No existe `sodium`** — design.md lo listaba como posible campo, no está en el DTO real. Nombres exactos de campo son en inglés y singular/plural tal como están arriba (no "proteínas"/"carbohidratos"). |
| propiedades/restricciones | **NO EXISTE** en `Ingredient` real. **BRECHA**, exclusiva del mock (análogo al caso de `Recipe`). |
| "tipo de ingrediente para shopping-list" | **CONFIRMADO que es un campo real y distinto**: `type: IngredientType` (`ingredient.prisma` líneas 1-9 y 14), enum **cerrado** con valores `MEAT | VEGETABLE | FRUIT | DAIRY | GRAIN | SPICE | OTHER`. Obligatorio en `CreateIngredientDto` (línea 27-28, `@IsEnum(IngredientType)`), importado del cliente Prisma generado: `import { IngredientType } from '@/generated/prisma/client'` (línea 3 de `create-ingredient.dto.ts` y `update-ingredient.dto.ts`). Este `type` es el único campo de clasificación/agregación que existe hoy en `Ingredient` — **no hay un campo separado de "propiedades/restricciones"** en el backend real; si el mock muestra ambos conceptos como cosas distintas, sólo `type` (este enum de 7 valores) tiene equivalente real en NUT-13. El frontend no debe inventar un segundo campo de "propiedades" para `Ingredient": no existe dónde persistirlo (ver fila anterior). |

### Relación receta-ingrediente (cantidad + unidad)

Confirmado exactamente en el DTO: `RecipeIngredientItemDto { name: string; quantity: number; unit: string }` (`apps/api/src/modules/recipe/dto/create-recipe.dto.ts` líneas 4-13), reutilizado por `update-recipe.dto.ts` (línea 3). `unit` es texto libre (`@IsString()`), no un enum. No hay `ingredientId`. Ver Prioridad #1 para el análisis de riesgo completo.

### Endpoints REST completos (list/get/create/update/delete) — ambos recursos

Todos protegidos por `@UseGuards(JwtAuthGuard)` a nivel de controller (confirmado: `recipe.controller.ts` línea 7 y `ingredient.controller.ts` línea 7).

**Recipes** (`apps/api/src/modules/recipe/recipe.controller.ts`):
- `POST /recipes` → `create` (línea 12-15)
- `GET /recipes` → `findAll` (línea 17-20)
- `GET /recipes/:id` → `findOne` (línea 22-25) — lanza `NotFoundException` si no existe (`recipe.service.ts` líneas 18-24), es decir 404 real para el caso "no encontrada".
- `PATCH /recipes/:id` → `update` (línea 27-30)
- `DELETE /recipes/:id` → `remove` (línea 32-35)

**Ingredients** (`apps/api/src/modules/ingredient/ingredient.controller.ts`):
- `POST /ingredients` → `create` (línea 12-15) — 409 (`ConflictException`) si el nombre ya existe (`ingredient.service.ts` líneas 10-14).
- `GET /ingredients` → `findAll` (línea 17-20)
- `GET /ingredients/:id` → `findOne` (línea 22-25) — 404 si no existe (`ingredient.service.ts` líneas 22-27).
- `PATCH /ingredients/:id` → `update` (línea 27-30) — 409 si se intenta renombrar un ingrediente en uso en alguna receta, o si el nuevo nombre ya existe (`ingredient.service.ts` líneas 30-46).
- `DELETE /ingredients/:id` → `remove` (línea 32-35) — 409 si el ingrediente está en uso en alguna receta (`ingredient.service.ts` líneas 49-57).

### Paginación/filtro/búsqueda en el listado

**BRECHA confirmada**: `findAll()` no acepta ningún parámetro en ninguno de los dos recursos.
- `RecipeController.findAll()` (`recipe.controller.ts` línea 17-20) no lee query params; `RecipeRepository.findAll()` (`recipe.repository.ts` línea 19-21) es `this.prisma.recipe.findMany()` sin `where`/`skip`/`take`.
- Mismo patrón en `IngredientController.findAll()` / `IngredientRepository.findAll()` (`ingredient.repository.ts` línea 19-21).
- No hay paginación, filtro por categoría (que además no existe como campo, ver arriba) ni búsqueda soportada por el backend. **El buscador y los chips de filtro del mock deben implementarse en el cliente, filtrando en memoria sobre la colección completa ya traída por `GET /recipes`.** Esto es aceptable para el volumen esperado de este MVP, pero se documenta como brecha de backend a considerar si el catálogo crece.

### Validación de errores — detalle de campo en 400/422

`apps/api/src/main.ts` líneas 12-18: `ValidationPipe` global con `{ whitelist: true, forbidNonWhitelisted: true, transform: true }`, **sin `exceptionFactory` personalizado**. Esto significa que Nest usa el formato default de `class-validator`/`BadRequestException`: un cuerpo `{ statusCode: 400, message: string[], error: "Bad Request" }`, donde `message` es un arreglo de mensajes de constraint en inglés/genéricos (p. ej. `"title must be a string"`), **no** una estructura `{campo, error}` por campo. Confirma la rama pesimista que design.md sección 1.3 ya anticipaba: el formulario debe caer a un mensaje de validación genérico por fila/campo basado en su propia validación de cliente, no puede confiar en mapear el array de mensajes del backend a campos específicos de forma confiable.

---

## 1. Cliente HTTP común

Confirmado sin cambios: `apps/web/src/services/apiClient.ts`. Mismo mecanismo de sesión que NUT-10:
- `apiClient` es una instancia de `axios` con `withCredentials: true` (línea 28-31).
- Interceptor de respuesta global (líneas 73-100) captura 401/403 (excepto `/auth/login` y `/auth/logout`, línea 15-18) y dispara `authFailureHandler` registrado vía `setAuthFailureHandler` (línea 33-39). Los servicios de recetas/ingredientes deben usar `apiClient` tal cual, **sin** `skipAuthErrorHandling`, igual que `mealPlanService.ts` (que no lo usa) y a diferencia de `registerService.ts` (que sí lo usa porque ocurre pre-sesión, línea 87 de `registerService.ts`).

## 2. Patrón de servicio/hook ya establecido (referencia obligatoria para tester/implementer)

- **Servicio de referencia**: `apps/web/src/services/mealPlanService.ts` — funciones async con `timeout` propio por operación (líneas 65-70, dos timeouts distintos según el costo esperado de la operación) y `signal: AbortSignal` con default `new AbortController().signal` (líneas 73-76, 107-110); normalización de la respuesta del backend antes de devolverla al hook (líneas 91-98, 119-126); manejo de 404 devolviendo `null` en vez de lanzar (líneas 99-102).
- **Servicio con clase de error por `kind`, patrón alternativo también válido de citar**: `apps/web/src/services/registerService.ts` — `RegisterErrorKind` como unión cerrada de strings (línea 19), clase `RegisterRequestError extends Error` con campo público `kind` (líneas 23-28), función pura `registrationErrorKind(error)` que mapea status/code de axios a un `kind` (líneas 44-68). **Este es el patrón que design.md sección 1.3 pide replicar** para `RecipeRequestError`/`IngredientRequestError`, con kinds del tipo `'notFound' | 'validation' | 'conflict' | 'timeout' | 'network' | 'unexpected'` (sin `'unauthorized'`, ver design.md sección 1.4, confirmado por el interceptor de `apiClient.ts` ya descripto en punto 1).
- **Hook de referencia**: `apps/web/src/modules/meal-plan/hooks/useMealPlan.ts` — hook manual (sin librería de data-fetching) con `useState` para `status: 'loading' | 'empty' | 'error' | 'success'` (línea 5, 26) y `errorMessage` (línea 27); `AbortController` propio por request con "última petición gana" vía `latestRequestIdRef` (líneas 33, 45-46, 53, 65); no borra el último dato válido ante error (línea 68, comentario explícito); `retry()` que reinvoca la última acción disparada (líneas 148-154). Este patrón (sin combinar con `useEffect` de fetch libraries) es el que deben seguir `useRecipes`, `useRecipeDetail` y `useIngredients` — dos hooks de listado (recetas, ingredientes) y uno de detalle (receta por id), cada uno con su propio `status`/`error` independiente, tal como pide design.md sección 1.1.

## 3. Componentes visuales reutilizables ya existentes

Todos en `apps/web/src/common/components/`:
- `Pill.tsx` — botón tipo chip con estado `selected` (aria-pressed) y `disabled`; sirve tal cual para los chips de filtro por categoría del listado (aunque la categoría en sí sea una brecha de backend, el componente de chip ya existe).
- `Banner.tsx` — banner de `variant: 'success' | 'error'`; sirve para los banners de error de formulario que pide design.md sección 4.2.
- `SelectableCard.tsx` — tarjeta seleccionable con `title`/`description`/`valueLabel`/`selected`; reutilizable como base para tarjetas de listado o selección de ingrediente (con adaptación de props según lo que finalmente necesite el selector de ingredientes).
- `ChevronIcon.tsx` y `CheckIcon.tsx` — íconos SVG inline reutilizables (patrón a replicar para íconos nuevos de este ticket: cubiertos, lápiz, tacho, ✕, buscador — no existen todavía, hay que crearlos siguiendo el mismo patrón de archivo-por-ícono con `className?: string` y `aria-hidden="true"`).
- `AppLayout.tsx`, `Sidebar.tsx`, `PlaceholderPage.tsx` — layout de la app autenticada y el placeholder actual de `/recipes` (ver punto 5).

**BRECHA confirmada**: no existe ningún patrón de modal/bottom-sheet reutilizable en el proyecto. Búsqueda de `modal|Modal|bottom-sheet|BottomSheet|dialog|Dialog` en todo `apps/web/src` no encontró coincidencias. El formulario de crear/editar receta, el modal de crear ingrediente (standalone y anidado) y la confirmación de borrado que pide design.md secciones 2 y 4 **requieren crear un componente de modal/overlay nuevo desde cero** en este ticket — no hay nada existente para reutilizar en ese punto específico. Se sugiere ubicarlo como componente común (`apps/web/src/common/components/Modal.tsx` o similar) dado que se reutiliza en al menos tres flujos (form receta, form ingrediente standalone, confirmación de borrado), pero la decisión final de forma/API de ese componente queda para el tester/implementer siguiendo el mismo lenguaje visual ya usado (esquinas redondeadas, sombra suave, botones de altura táctil mínima, ver design.md sección 10).

## 4. Ubicación convencional para los archivos nuevos

Confirmado por convención ya usada en `meal-plan` y `profile`:
- Servicios en la raíz de `src`, junto a los existentes: `apps/web/src/services/recipeService.ts` y `apps/web/src/services/ingredientService.ts` (mismo nivel que `mealPlanService.ts`, `registerService.ts`, `authService.ts`, `nutritionProfileService.ts`).
- Módulo nuevo: `apps/web/src/modules/recipes/` — **no existe todavía** (`Glob apps/web/src/modules/recipes/**` no devolvió resultados). Confirmado que hay que crearlo desde cero, siguiendo la estructura ya usada en `apps/web/src/modules/meal-plan/` (que tiene `components/`, `hooks/`, `pages/`, y un archivo de utilidades `utils.ts` en la raíz del módulo):
  - `apps/web/src/modules/recipes/hooks/useRecipes.ts` (listado)
  - `apps/web/src/modules/recipes/hooks/useRecipeDetail.ts` (detalle por id)
  - `apps/web/src/modules/recipes/hooks/useIngredients.ts` (catálogo)
  - `apps/web/src/modules/recipes/pages/RecipesListPage.tsx`, `RecipeDetailPage.tsx` (o página única con estado interno, a decidir en implementación según cómo se resuelva el punto 5)
  - `apps/web/src/modules/recipes/components/` para `RecipeForm.tsx`, `IngredientForm.tsx`, tarjetas de listado, filtros, etc.

## 5. Punto de entrada — ruta `/recipes`

Confirmado: `apps/web/src/app/App.tsx` línea 80:
```
<Route path="/recipes" element={<PlaceholderPage title="Recipes" />} />
```
dentro del bloque `<ProtectedApp>` (líneas 74-86), que ya envuelve todas las rutas autenticadas con `AppLayout`. Hay que reemplazar ese elemento por la página real del módulo nuevo (p. ej. `<RecipesListPage />` como entrada, con el detalle/formularios resueltos como estado interno de esa página o como sub-rutas anidadas — design.md no especifica ruteo interno, es una decisión de implementación menor ya que design.md sección 4.1 describe el flujo como navegación dentro de una "pantalla" y no como rutas separadas del router). Import nuevo a agregar junto a los ya existentes (línea 10, mismo patrón que `import { MealPlanPage } from '../modules/meal-plan/pages/MealPlanPage';`).

## 6. Tipos compartidos

Confirmado, sin cambios respecto a NUT-10: no existe ningún paquete de tipos compartidos entre frontend/backend (`Glob packages/**` no devolvió resultados; no hay carpeta `packages/` en el repo). Los tipos de `Recipe`/`Ingredient` para este ticket se definen localmente en los nuevos `recipeService.ts`/`ingredientService.ts`, igual que `mealPlanService.ts` ya define localmente `Recipe`/`Ingredient`/`MealPlan` (líneas 8-63) pese a ser tipos que también existen conceptualmente en el backend. Nota importante para no duplicar de forma inconsistente: `mealPlanService.ts` ya exporta un tipo `Recipe` (línea 14-22) y un tipo `Ingredient` (línea 8-12) con la forma **embebida antigua** (`ingredients: Ingredient[]` con `{name, quantity?, unit?}`, ambos opcionales ahí). El nuevo `recipeService.ts` de este ticket va a necesitar su propio tipo `Recipe`/`RecipeIngredientItem` (con `quantity`/`unit` obligatorios, tal como los exige `CreateRecipeDto` real) — **decidir si se renombra/reexporta para evitar colisión de nombres** entre el `Recipe`/`Ingredient` de `mealPlanService.ts` y los nuevos de `recipeService.ts`/`ingredientService.ts` es una decisión de implementación a tomar en esa etapa, no de este plan.

---

## Resumen de brechas a escalar (no resueltas aquí, por diseño de esta etapa)

1. **Crítica**: `Recipe.ingredients` es JSON embebido por `name` de texto libre, sin `ingredientId`/tabla intermedia — el selector de ingredientes de catálogo con autocomplete no tiene backing real de relación por id.
2. `Recipe` no tiene categoría dietaria, valores nutricionales propios, propiedades/restricciones, ni campo de imagen — los cuatro son exclusivos del mock, ninguno existe en el modelo/DTO real.
3. `Ingredient` no tiene `description`, ni "unidad de medida habitual" propia, ni un campo de "propiedades/restricciones" separado del `type` (enum de 7 valores, que es el único campo real de clasificación).
4. `Recipe`/`Ingredient` `findAll()` no soportan filtro, búsqueda ni paginación en backend — buscador y chips de filtro del mock se implementan en cliente sobre la colección completa.
5. `prepMinutes`/`cookMinutes` siguen separados y obligatorios; el mock pide un único "Tiempo".
6. La validación 400/422 del backend no expone detalle estructurado por campo (mensajes genéricos de `class-validator`).
7. No existe ningún patrón de modal/bottom-sheet reutilizable en el proyecto; hay que crear uno nuevo para los tres flujos de este ticket (form receta, form ingrediente, confirmación de borrado).
