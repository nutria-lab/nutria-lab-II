# NUT-83 — plan.md (explorer)

> Generado a partir de `.plans/nut-83-encontrar-una-imagen-confiable-para-cada-receta-nueva/design.md` (única fuente de verdad sobre el QUÉ). Este archivo sólo referencia archivos/símbolos reales del repo en la rama
> `mariajoserosalestorres/nut-83-encontrar-una-imagen-confiable-para-cada-receta-nueva` (creada desde `main`, con NUT-75 ya mergeado). No se tocó ningún otro archivo, no se ejecutó ningún comando de Prisma ni contra ninguna base de datos.

## Nota de herramientas (declaración explícita de fallback)

- **CodeGraph MCP no estuvo disponible en esta sesión** (`CONNECTION_CLOSED`). Se usó fallback de exploración por filesystem (Glob/Grep/Read) para todo este documento, como ya se hizo en sesiones anteriores.
- **`bundles/agent-libraries.json` y `bundles/development/AGENTS.md` no existen en este repo** (confirmado con `find`/`Glob`, cero resultados). No se pudo cargar ninguna librería MCP específica por rol porque el archivo que la define no está presente; se procedió únicamente con los módulos `.ai/*.md` indicados por `CLAUDE.md` (`.ai/index.md`, `.ai/architecture.md`, `.ai/quality-and-testing.md`, `.ai/database-and-migrations.md`) y la skill `codegraph-guidance`. Hay un `AGENTS.md` en la raíz del repo (no en `bundles/development/`) que no fue leído porque no está referenciado por el flujo de esta sesión.

---

## 1. Archivo de modelo Prisma a editar

**Archivo:** `apps/api/prisma/models/recipe.prisma`

Contenido actual completo (38 líneas):

```
1  enum RecipeCategory { ... }
11 enum RecipeOrigin {
12   MANUAL
13   AI
14 }
15
16 model Recipe {
17   id                String           @id @default(uuid())
18   title             String
19   description       String
20   prepMinutes       Int
21   cookMinutes       Int
22   ingredients       Json
23   instructions      String[]
24   categories        RecipeCategory[] @default([])
25   nutritionalValues Json?
26   properties        String[]         @default([])
27   origin            RecipeOrigin     @default(MANUAL)
28   generationRunId   String?
29   generationRun     GenerationRun?   @relation(fields: [generationRunId], references: [id], onDelete: SetNull)
30
31   createdAt DateTime @default(now())
32   updatedAt DateTime @updatedAt
33
34   plannedMeals PlannedMeal[]
35
36   @@index([generationRunId])
37   @@map("recipes")
38 }
```

**Dónde insertar `image Json?`:** entre la línea 26 (`properties`) y la línea 27 (`origin`), es decir, inmediatamente **después de `properties` y antes de `origin`**:

```prisma
  nutritionalValues Json?
  properties        String[]         @default([])
  image             Json?
  origin            RecipeOrigin     @default(MANUAL)
  generationRunId   String?
```

Razón de la ubicación exacta: `nutritionalValues`/`properties`/`image` son los tres campos de **contenido opcional producido junto con la receta**, mientras que `origin`/`generationRunId` son los dos campos de **procedencia/trazabilidad** agregados por NUT-75 (ver comentario de `createDaysMealsAndRecipes` en `apps/api/src/modules/plans/plans.repository.ts:72-84`, que ya documenta esa misma distinción conceptual). Agrupar `image` junto a `nutritionalValues`/`properties` respeta el orden semántico ya usado en el archivo y es exactamente lo que pide design.md sección 8 ("cerca de `nutritionalValues`/`properties`"). No se modifica ninguna otra línea del modelo.

---

## 2. Carpeta/archivo de migración nueva

**Carpetas existentes en `apps/api/prisma/migrations/`, en orden cronológico real (confirmado con `ls`):**

```
20260822202113_first_migration
20260902133600_add_nutrition_profile
20260902145146_add_meal_plan_models
20260905140630_update_meal_plans
20260910212521_add_recipe_title
20260910223634_add_recipe_fields
20260911195945_align_recipe_contract
20260916130941_nut20_contract
20260921121000_enable_unaccent
20260922204917_add_generation_run_and_meal_plan_versioning   <- última hoy
migration_lock.toml   (provider = "postgresql", no tocar)
```

Patrón confirmado: `<14 dígitos: YYYYMMDDHHMMSS>_<snake_case descriptivo>`. La última migración (NUT-75, ya mergeada) es `20260922204917_add_generation_run_and_meal_plan_versioning`.

**Nombre propuesto para la migración de NUT-83** (el implementer debe generar el timestamp real al momento de correr `prisma migrate dev --create-only` en su Neon branch de desarrollo, protocolo de dos commits de `.ai/database-and-migrations.md`; el valor de ejemplo abajo usa la hora real del sistema al momento de este plan, `2026-09-30T17:04:25Z` → `20260930170425`, sólo como referencia de formato, no como valor obligatorio):

```
apps/api/prisma/migrations/20260930170425_add_recipe_image/migration.sql
```

**Contenido exacto esperado del `migration.sql`** (ya especificado en design.md sección 8, aditivo, sin `NOT NULL` ni `DEFAULT`):

```sql
ALTER TABLE "recipes" ADD COLUMN "image" JSONB;
```

Conforme a `.ai/database-and-migrations.md` ("Commit 1 — generate and review"): esta migración se genera y se revisa, pero **no se ejecuta** contra ningún Neon branch en esta etapa; eso requiere aprobación humana de TL y es Commit 2, fuera del alcance de tester/implementer de este ciclo salvo instrucción explícita posterior.

---

## 3. Dónde vive el adaptador de Pexels

**Precedente real a comparar:** `GeminiService` vive en `apps/api/src/modules/plans/gemini/gemini.service.ts` (junto a `apps/api/src/modules/plans/gemini/prompts.ts`) — es decir, **dentro del módulo de su único consumidor** (`PlansModule`), no como módulo hermano de nivel superior. Confirmado en `apps/api/src/modules/plans/plans.module.ts:1-16`: `GeminiService` se registra directamente en el arreglo `providers` de `PlansModule` (línea 13), sin `GeminiModule` propio. La carpeta `apps/api/src/modules/` sólo tiene módulos de nivel superior por **recurso de dominio** (`auth`, `ingredient`, `nutrition-profile`, `plans`, `recipe`, `user`) — no hay ningún módulo de nivel superior dedicado a un proveedor externo.

**Decisión para Pexels — mismo patrón que `gemini/`, no un módulo `recipe/` ni un módulo hermano top-level nuevo:**

```
apps/api/src/modules/plans/pexels/pexels.service.ts
apps/api/src/modules/plans/pexels/pexels-query.util.ts
apps/api/src/modules/plans/pexels/pexels-candidate-selector.util.ts
apps/api/src/modules/plans/pexels/recipe-image.types.ts
```

**Justificación (criterio explícito, comparando ambas opciones reales):**
- **No** dentro del módulo `recipe/` (`apps/api/src/modules/recipe/`): design.md D1 acota el disparo de la búsqueda de imagen **exclusivamente** al camino de generación inicial de plan (`origin: 'AI'`, ver sección 4 de este documento) — nunca a `POST /recipes` manual, que es el único consumidor real de `recipe.module.ts`/`recipe.service.ts`/`recipe.repository.ts` hoy. Poner el adaptador dentro de `modules/recipe/` sugeriría visualmente (a cualquier persona que lea la estructura de carpetas) que aplica a todo el dominio Recipe, cuando el propio diseño prohíbe explícitamente eso (D1, AC13). Ubicarlo en `recipe/` ampliaría el acoplamiento aparente sin que el código lo respalde.
- **Sí** dentro de `plans/pexels/`, espejando `plans/gemini/`: el único consumidor real (hoy y según el alcance de este ticket) es `PlansService`, exactamente igual que `GeminiService`. Esto además evita una dependencia circular entre módulos (si viviera en `recipe/` pero sólo lo llamara `plans/`, `PlansModule` tendría que importar `RecipeModule` sólo para esto). Es el cambio reversible más chico y consistente con el patrón ya establecido por el propio repo (no una convención nueva inventada para este ticket).
- El adaptador se registra en `apps/api/src/modules/plans/plans.module.ts`, agregando `PexelsService` al arreglo `providers` (línea 13), mismo patrón exacto que `GeminiService`. No hace falta un `PexelsModule` propio, igual que no existe `GeminiModule`.

**Separación interna propuesta dentro de `plans/pexels/` (para que el tester pueda testear cada pieza en aislamiento, sección 9):**
- `pexels-query.util.ts`: función pura `buildPexelsQuery(title: string): string` — normalización determinística de la sección 2 de design.md. Sin red, sin Nest, sin Prisma.
- `pexels-candidate-selector.util.ts`: función pura `selectPexelsCandidate(photos: unknown): PexelsCandidate | null` — validación de forma + predicado + desempate de la sección 3 de design.md. Sin red, sin Nest, sin Prisma.
- `recipe-image.types.ts`: el tipo `RecipeImage` de design.md sección 8, compartido entre el selector, el servicio y el repositorio (para que `plans.repository.ts` pueda tipar el campo `image` sin importar el servicio completo).
- `pexels.service.ts`: clase `@Injectable() PexelsService` (inyecta `ConfigService`, patrón de `gemini.service.ts:1-4,39`) con:
  - `resolveImage(title: string): Promise<RecipeImage | null>` — un único intento, `AbortController` + `setTimeout`, lectura de `PEXELS_API_KEY` en el momento de la llamada (no en el constructor, ver sección 6 de este documento).
  - `resolveImagesForDays(days: MealPlanDayDto[]): Promise<Map<string, RecipeImage | null>>` (o firma equivalente) — orquestación con concurrencia acotada a `PEXELS_MAX_CONCURRENT_REQUESTS` (sección 8 de este documento) y memoización opcional por query normalizada (D3, optimización no obligatoria).

---

## 4. Punto de integración exacto (Flujo A del design.md)

**Archivo:** `apps/api/src/modules/plans/plans.service.ts`

### 4.1 Método de más arriba en la pila: `generateAndPersistPlan` (líneas 61-135)

Flujo real hoy, con líneas exactas:
- Línea 78: `const profileSnapshot = buildProfileSnapshot(user.nutritionProfile);`
- Líneas 79-84: se arma `requestSnapshot`.
- Líneas 89-99: `createOrRecoverGenerationRun(...)` — crea/recupera el `GenerationRun` **antes** de llamar al proveedor de IA.
- Línea 111: `generatedDays = await this.gemini.generateMealPlan(user.nutritionProfile, weekStart);` — acá es donde hoy se llama al único proveedor externo (Gemini).
- Líneas 120-123: se envuelve `generatedDays` en `CreateMealPlanDto` vía `plainToInstance` (`dto.days` queda con la forma `MealPlanDayDto[]`).
- Líneas 125-132: `validate(dto)` — si falla, transiciona el run a `FAILED` y lanza.
- **Línea 134: `return this.validateAndPersistPlan(userId, dto, run.id);`** — acá es donde este método delega al siguiente, pasando siempre `run.id` (string, nunca `undefined`) como `generationRunId`.

### 4.2 Método que abre la transacción (prohibido por D2): `validateAndPersistPlan` (líneas 143-204)

- Comentario explícito en líneas 137-141: `generationRunId` **sólo** viene definido cuando este método es invocado desde `generateAndPersistPlan` (el camino real de generación IA). El camino manual `POST /meal-plans` (`plans.controller.ts:18-23`, `createPlan`) llama a este mismo método **sin** `generationRunId` (`this.plansService.validateAndPersistPlan(userId, dto)`, sin tercer argumento).
- Línea 173: `this.validateRestrictions(dto.days, user.nutritionProfile);` — validación de dominio existente, sin cambios de este ticket.
- **Línea 184: `await this.repository.createPlanTransaction(userId, weekStart, dto.days, generationRunId);`** — esta es la llamada a la transacción de Prisma que D2 prohíbe que haga I/O de red. Está dentro de un bloque `try` (líneas 183-202) que ya maneja el caso de fallo transicionando el `GenerationRun` a `FAILED`.

### 4.3 Dónde insertar la resolución de imágenes (lugar exacto)

**Insertar en `validateAndPersistPlan`, entre la línea 181 (fin del `catch` de `validateRestrictions`) y la línea 183 (inicio del `try` que envuelve `createPlanTransaction`), condicionado a que `generationRunId` esté definido:**

```ts
// (nuevo) después de línea 181, antes de línea 183:
let daysForPersistence = dto.days;
if (generationRunId) {
  // Flujo A paso 2-3 de design.md: resolver TODAS las imágenes del batch, con concurrencia
  // acotada (D3), ANTES de invocar createPlanTransaction (D2). Nunca lanza (sección 4 de
  // design.md): cada resolución individual ya devuelve RecipeImage | null.
  daysForPersistence = await this.pexels.attachImages(dto.days); // nombre de método sugerido, no cerrado
}

try {
  await this.repository.createPlanTransaction(userId, weekStart, daysForPersistence, generationRunId);
} catch (error) {
  // ... sin cambios ...
}
```

**Por qué acá y no en `generateAndPersistPlan`:** design.md Flujo A paso 2-3 exige que la resolución ocurra "enteramente antes de invocar la persistencia transaccional del plan" (D2) y que aplique únicamente a recetas que se van a persistir con `origin: 'AI'`. La única señal disponible en código, en este punto exacto, de que el destino de persistencia será `origin: 'AI'` es la presencia de `generationRunId` (ver sección 5 de este documento para la prueba). Insertarlo en `validateAndPersistPlan` (no en `generateAndPersistPlan`) tiene dos ventajas: (a) es el método que efectivamente abre la transacción (línea 184), así que la resolución queda en el mismo método, justo antes de la línea que D2 prohíbe contaminar, minimizando la distancia entre "resolver" y "usar"; (b) automáticamente excluye el camino manual (`POST /meal-plans`, AC13) sin necesitar un parámetro booleano nuevo, porque ese camino nunca pasa `generationRunId` a este método.

**Alternativa considerada y descartada:** insertar la resolución en `generateAndPersistPlan` antes de la línea 134. Se descarta porque ese método no es el que abre la transacción — insertarlo ahí funcionalmente cumpliría D2 igual (sigue siendo antes de la transacción), pero dispersa la lógica de "quién dispara Pexels" en dos lugares distintos de la pila en vez de uno solo, y haría más fácil que un futuro cambio en `validateAndPersistPlan` (que también es invocado directamente por el controlador) rompa la regla D2 sin que sea obvio. Mantener la condición `if (generationRunId)` inmediatamente junto a la transacción que protege es más legible y más difícil de desalinear.

**Cómo pasar el resultado a la transacción (forma concreta propuesta, para no dejarlo abierto):** en vez de agregar un parámetro paralelo nuevo a `createPlanTransaction`, se propone que la resolución de imágenes devuelva una copia de `dto.days` donde cada `meal.recipe` que tenía contenido ahora trae además una propiedad `image: RecipeImage | null` (dato plano, ya resuelto). Esto es compatible con la forma en que `plans.repository.ts:85-133` (`createDaysMealsAndRecipes`) ya lee `meal.recipe.*` campo por campo para construir `recipeData` — sólo hace falta que esa función lea también `meal.recipe.image` (si viene definido) y lo agregue a `recipeData`, exactamente con el mismo patrón condicional ya usado para `generationRunId` (líneas 110-112) y `recipeOrigin` (líneas 114-116):

```ts
// plans.repository.ts, dentro de createDaysMealsAndRecipes, junto a las líneas 110-116:
if (meal.recipe.image !== undefined) {
  recipeData.image = meal.recipe.image; // RecipeImage | null, dato plano, sin I/O
}
```

Esta forma respeta al pie de la letra D2 ("la transacción sólo recibe, por receta, un valor `image` ya resuelto... como dato plano") sin cambiar la firma posicional de `createPlanTransaction`/`createDaysMealsAndRecipes` más allá de leer un campo nuevo del objeto que ya reciben.

---

## 5. Cómo distinguir "receta nueva de origen IA" en ese punto

Confirmado con el código real: en `validateAndPersistPlan`, `dto.days` tiene el tipo `MealPlanDayDto[]` (`apps/api/src/modules/plans/dto/meal-plan-day.dto.ts:6-21`), y cada día tiene `meals: MealDto[]` (`apps/api/src/modules/plans/dto/meal.dto.ts:7-27`). El campo relevante es `MealDto.recipe` (línea 26 de `meal.dto.ts`, tipado `RecipeDto`, con `@IsNotEmpty()` en la línea 23).

**Nota importante para el tester/implementer:** el DTO (`@IsNotEmpty() recipe!: RecipeDto`) hoy exige que **toda** comida tenga receta — no hay comidas sin receta en el contrato validado. Sin embargo, `plans.repository.ts:100` (`createDaysMealsAndRecipes`) sigue guardando `if (meal.recipe) { ... }` antes de crear la fila de `Recipe`, tratándolo como potencialmente ausente a nivel de tipo (`meal.recipeId = null` si no hay receta, línea 98). La resolución de imágenes debe replicar exactamente ese mismo guard (`if (meal.recipe)`) para decidir a qué entradas pedirles imagen, en vez de asumir que todas las comidas del array siempre tienen receta — así se mantiene consistente con el único otro lugar del código que ya toma esta misma decisión, y no se rompe si en el futuro el contrato de `MealDto.recipe` se relaja a opcional.

El identificador natural para memoización (D3, optimización) es la query normalizada (sección 2 de design.md, `pexels-query.util.ts`), no un id de receta (las recetas nuevas de IA no tienen `id` todavía en este punto — se crean recién dentro de la transacción, `plans.repository.ts:118`).

---

## 6. Configuración de entorno

**`GEMINI_API_KEY` hoy:**
- Declarada en `apps/api/.env.example:5`: `GEMINI_API_KEY="your-google-ai-studio-key"`.
- Leída en `apps/api/src/modules/plans/gemini/gemini.service.ts:39-45`:
  ```ts
  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is missing');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }
  ```
  Este patrón **falla al construirse** si falta la key (dependencia dura).

**Patrón a replicar para `PEXELS_API_KEY` (con la divergencia deliberada de D4):**
- Agregar a `apps/api/.env.example`, después de la línea 5 (`GEMINI_API_KEY`): `PEXELS_API_KEY="your-pexels-api-key"`.
- En `PexelsService` (`plans/pexels/pexels.service.ts`), **inyectar `ConfigService` en el constructor igual que `GeminiService`, pero NO leer/validar la key ahí.** La key se lee dentro de `resolveImage(...)`, en el momento de cada intento, **antes** de cualquier `fetch`:
  ```ts
  constructor(private readonly configService: ConfigService) {}

  async resolveImage(title: string): Promise<RecipeImage | null> {
    const apiKey = this.configService.get<string>('PEXELS_API_KEY');
    if (!apiKey) {
      this.logger.warn('PEXELS_API_KEY missing; skipping image resolution'); // sin ningún valor secreto
      return null;
    }
    // ... construir query, fetch con AbortController+timeout, seleccionar candidato ...
  }
  ```
  Esto satisface D4 (el adaptador se construye exitosamente sin importar si la key está presente) y AC5.
- `ConfigModule` ya está importado en `plans.module.ts:8,11`, así que no hace falta ningún cambio de módulo adicional para que `PexelsService` pueda inyectar `ConfigService`.

---

## 7. Tests — mapeo AC1-16 a archivos concretos

| AC (design.md §6) | Archivo de test | Patrón a replicar | Notas |
|---|---|---|---|
| AC1 — Query normalizada y sufijo fijo | `apps/api/src/modules/plans/pexels/pexels-query.util.spec.ts` (nuevo) | Spec puro, sin Nest/Prisma — mismo patrón que `apps/api/src/utils/idempotency-hash.util.spec.ts` (determinismo, casos borde) | Cubrir los 4 casos borde exactos de design.md §2 (acentos+tabs, ya limpio, sólo espacios, doble llamada determinista). |
| AC2 — Selección reproducible | `apps/api/src/modules/plans/pexels/pexels-candidate-selector.util.spec.ts` (nuevo) | Spec puro — mismo patrón que `apps/api/src/modules/plans/generation-run-state-machine.spec.ts` (tabla de casos, `it.each`) | Incluir el caso de `id` duplicado (desempate, design.md §3 último párrafo). |
| AC3 — 200 con imagen | `apps/api/src/modules/plans/pexels/pexels.service.spec.ts` (nuevo, parte 1) + `apps/api/src/modules/plans/tests/plans.repository.spec.ts` (nuevo `describe`, parte 2) | Parte 1: mock de `global.fetch` (ConfigService mockeado con key presente); parte 2: mismo patrón que el `describe('Bug 1...')` existente en `plans.repository.spec.ts:416-470` (captura `args.data` pasado a `tx.recipe.create`) | Parte 2 verifica que `recipeData.image` llega con la forma exacta del `RecipeImage` de design.md §8. |
| AC4 — Sin resultados | `pexels.service.spec.ts` | `fetch` mockeado devolviendo `{ ok:true, status:200, json: async () => ({ photos: [] }) }` | Sin warning (ver tabla design.md §4). |
| AC5 — API key ausente | `pexels.service.spec.ts` + `apps/api/src/modules/plans/tests/plans.service.spec.ts` (nuevo `describe`) | `pexels.service.spec.ts`: ConfigService mock devuelve `undefined`, assert `fetch` NO llamado; `plans.service.spec.ts`: mismo patrón de mocks planos que el archivo ya usa (`mockRepository`, `mockGemini`, agregar `mockPexels`), verificar que `generateAndPersistPlan` completa exitosamente con `mockPexels.resolveImage` devolviendo `null` | |
| AC6 — Timeout | `pexels.service.spec.ts` | Mock de `fetch` que respeta `AbortSignal` (rechaza con `Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })` cuando `signal.aborted`), igual que el `catch` de `gemini.service.ts:78-84` que distingue `error.name === 'AbortError'` | Usar `jest.useFakeTimers()` para no esperar los 5000ms reales. |
| AC7 — 429 | `pexels.service.spec.ts` | `fetch` mock con `status: 429` | Warning con status `429` (spy sobre `Logger`). |
| AC8 — 5xx | `pexels.service.spec.ts` | `fetch` mock con `status: 500` (u otro 5xx) | Warning con el status recibido. |
| AC9 — JSON inválido / forma inválida | `pexels-candidate-selector.util.spec.ts` (predicado/forma) + `pexels.service.spec.ts` (JSON.parse lanza) | Igual que AC2 para el selector; para el parseo, mock `json: async () => { throw new SyntaxError('Unexpected token'); }` | |
| AC10 — Persistencia y lectura de `image` | `plans.repository.spec.ts` (persistencia, ver AC3 parte 2) + **`apps/api/src/modules/recipe/tests/recipe.repository.spec.ts`** (lectura, extender) | Mismo patrón que los tests existentes de `findAll`/`findById` en ese archivo | **Hallazgo importante:** `RecipeRepository.findAll` (`apps/api/src/modules/recipe/recipe.repository.ts:44-61`) usa `$queryRaw` con una lista explícita de columnas (líneas 46-49: `"id","title","description","prepMinutes","cookMinutes","ingredients","instructions","categories","nutritionalValues","properties","createdAt","updatedAt"`) que **ya excluye** `origin`/`generationRunId` y por construcción **también excluiría `image`** si no se agrega a esa lista. `findById`/`findByTitle` (líneas 107-117) usan `prisma.recipe.findUnique`/`findFirst` (modelo completo, incluyen `image` automáticamente sin cambios). Un test de AC10 sobre el **listado** (`GET /recipes`, paginado) debe fallar en rojo hasta que el implementer agregue `"image"` a esa lista de columnas en la línea 49. |
| AC11 — Receta existente sin imagen | `apps/api/src/prisma/tests/recipe-image-migration.spec.ts` (nuevo) | Mismo patrón que `apps/api/src/prisma/tests/generation-run-migration.spec.ts` (lee `migration.sql`/`recipe.prisma` como texto con `fs.readFileSync`, sin tocar ninguna base) | Verificar `ADD COLUMN "image" JSONB;` SIN `NOT NULL` ni `DEFAULT` (contraste explícito con `origin`, que sí tiene `DEFAULT 'MANUAL'` en la migración de NUT-75 — ver `generation-run-migration.spec.ts:31-34`). |
| AC12 — Key nunca en logs/respuesta | `pexels.service.spec.ts` | Spy sobre `Logger.prototype.warn` (o el logger inyectado), assert que ningún argumento de ninguna llamada contiene el valor de la key mockeada, en los casos AC5/AC6/AC7/AC8/AC9 | |
| AC13 — Alcance limitado a `origin: 'AI'` | `plans.service.spec.ts` (nuevo `describe`) | Mismo patrón de mocks planos ya usado en el archivo; assert que `mockPexels.resolveImage`/`attachImages` **no** se llama cuando: (a) `validateAndPersistPlan` se invoca sin `generationRunId` (camino `POST /meal-plans`), (b) `updatePlan` invoca `updatePlanTransaction` (camino `PUT /meal-plans`, edición) | Complementar con `plans.repository.spec.ts`: extender el `describe('Bug 1...')` existente (líneas 416-470) para reafirmar que `updatePlanTransaction` nunca estampa `image` tampoco. |
| AC14 — Resolución fuera de la transacción | `plans.service.spec.ts` (orden de llamadas) + `plans.repository.spec.ts` o nuevo `plans-transaction-no-network.spec.ts` (verificación estática) | Orden de llamadas: mismo patrón `callOrder` usado en `plans.repository.spec.ts:138-180` (AC10 de NUT-75, orden `update`→`create`), acá aplicado a `pexels.resolve*` → `repository.createPlanTransaction`; verificación estática: leer `plans.repository.ts` como texto (mismo estilo que los specs de migración) y `expect(content).not.toMatch(/pexels/i)` | La verificación estática es la forma más directa de probar "el método que abre la transacción no referencia ni invoca al adaptador de Pexels" tal como lo pide design.md AC14 literalmente. |
| AC15 — Concurrencia acotada | `apps/api/src/modules/plans/pexels/pexels-concurrency.spec.ts` (nuevo, puro) | Sin red, sin Prisma: inyectar una función `resolveOne` falsa que incrementa/decrementa un contador de llamadas en vuelo con `Promise`/`setTimeout` controlados, assert que el máximo observado nunca supera `PEXELS_MAX_CONCURRENT_REQUESTS` (3) con >3 items, y que todas las promesas resuelven antes de que la función orquestadora retorne | Mismo espíritu aislado que `generation-run-state-machine.spec.ts`: prueba la lógica de concurrencia en sí misma, no el adaptador HTTP real. |
| AC16 — Migración aditiva no rompe el contrato | `recipe-image-migration.spec.ts` (mismo archivo que AC11) | Igual patrón que `generation-run-migration.spec.ts:29-63` ("AC1 - Backfill...", "es aditiva/no destructiva: no contiene DROP TABLE/COLUMN/TRUNCATE") | Agregar además una aserción de que `recipe.prisma` sigue conteniendo, sin cambios, los campos `title`, `description`, `prepMinutes`, `cookMinutes`, `ingredients`, `instructions`, `origin`, `generationRunId` (contrato NUT-61/NUT-75 intacto). |

---

## 8. Constante de concurrencia acotada (D3)

**Ubicación propuesta:** exportada como constante al inicio de `apps/api/src/modules/plans/pexels/pexels.service.ts`, mismo patrón exacto que `GEMINI_PROVIDER`/`GEMINI_MODEL_NAME` en `apps/api/src/modules/plans/gemini/gemini.service.ts:13-14` (constantes hermanas de la clase `@Injectable`, no variables de entorno, no config):

```ts
export const PEXELS_MAX_CONCURRENT_REQUESTS = 3;
export const PEXELS_TIMEOUT_MS = 5000; // sección 4 de design.md
```

Esto permite que `pexels-concurrency.spec.ts` (AC15) y `pexels.service.spec.ts` (AC6) importen el mismo valor en vez de hardcodear `3`/`5000` de nuevo en los tests, evitando que el test y la implementación diverjan silenciosamente.

---

## 9. Orden de trabajo sugerido (ciclo tester → implementer)

De lo más aislado/puro a lo más integrado, cada paso desbloqueando al siguiente:

1. **`pexels-query.util.ts` + `.spec.ts`** (AC1) — función pura, sin dependencias. Base para todo lo demás (la query normalizada es un input de todas las demás piezas).
2. **`pexels-candidate-selector.util.ts` + `.spec.ts`** (AC2, AC9 parcial) — función pura sobre un `photos[]` simulado, sin red.
3. **`recipe-image.types.ts`** (sin test propio — es sólo el tipo `RecipeImage`, consumido por los pasos siguientes).
4. **`pexels.service.ts` + `pexels.service.spec.ts`** (AC3 parte 1, AC4, AC5 parte 1, AC6, AC7, AC8, AC9 parte 2, AC12) — adaptador HTTP con `fetch` mockeado y `ConfigService` mockeado; consume los pasos 1 y 2.
5. **Constante de concurrencia + orquestador de batch (`resolveImagesForDays`/equivalente) + `pexels-concurrency.spec.ts`** (AC15) — lógica de concurrencia acotada en aislamiento, con una función `resolveOne` falsa inyectada (no el `pexels.service.ts` real, para no depender de red simulada dos veces).
6. **Integración en `plans.repository.ts`** (`createDaysMealsAndRecipes`, lectura de `meal.recipe.image`) + extensión de `plans.repository.spec.ts` (AC3 parte 2, AC13 complemento) — todavía sin tocar `plans.service.ts`.
7. **Integración en `plans.service.ts`** (`validateAndPersistPlan`, sección 4.3 de este documento) + extensión de `plans.service.spec.ts` (AC5 parte 2, AC13, AC14 orden de llamadas) — acá es donde D1/D2/D3 se atan todas juntas en el punto de integración real.
8. **Verificación estática AC14** (`plans.repository.ts` no referencia Pexels) — rápido de escribir, puede ir en paralelo con el paso 7.
9. **Lectura: `recipe.repository.ts` línea 49 (columnas del `$queryRaw` de `findAll`)** + extensión de `recipe.repository.spec.ts` (AC10 listado) — el hallazgo de la sección 7 de este documento.
10. **Modelo Prisma (`recipe.prisma`) + migración (`migration.sql`) + `recipe-image-migration.spec.ts`** (AC11, AC16) — último paso: es puramente declarativo/de texto, no depende de que el resto del código ya exista, pero probarlo en rojo antes de tener motivo para tocar el schema no aporta nada; tiene sentido dejarlo para el final del ciclo, y **no se ejecuta contra ninguna base real** en esta etapa (Commit 1 únicamente, `.ai/database-and-migrations.md`).

---

Generado: 2026-09-30T17:14:00Z (hora del sistema al momento de escribir este archivo; ver salida real de `node -e "console.log(new Date().toISOString())"` = `2026-09-30T17:04:25.268Z` tomada como referencia durante la exploración).

---

## 10. Revisión post-corrección de D1 (toda receta, no solo IA)

> **Motivo de esta sección:** `design.md` fue corregido después de que este `plan.md` se escribiera: D1 ya no limita la resolución de imagen a `origin: 'AI'` (ver nota de revisión en `design.md` sección 1, y AC13 corregido en `design.md` sección 6). Las secciones 1-9 de arriba quedan **sin borrar**, con el mismo criterio que usó `design.md`: para que quede trazado qué se pensaba antes (alcance limitado a IA, integración condicionada a `generationRunId`, ubicación de `pexels/` como submódulo exclusivo de `plans/`) y qué cambió. Todo lo que sigue fue verificado contra el código real de la rama en este momento, no contra lo que decía el plan.md original.

### 10.1 Corrección del punto de integración en `plans.service.ts`

**Estado real verificado del archivo (no ha cambiado desde que se escribió la sección 4 de arriba — mismas líneas):** `apps/api/src/modules/plans/plans.service.ts`. `PexelsService` **todavía no está inyectado** en el constructor de `PlansService` (líneas 12-17: sólo `PlansRepository` y `GeminiService`) ni registrado en `apps/api/src/modules/plans/plans.module.ts` (`providers: [PlansService, GeminiService, PlansRepository]`, sin `PexelsService`) — la integración descrita en la sección 4 de este plan y en los tests de NUT-83 todavía no se implementó. Esta sección corrige la GUÍA para cuando se implemente, no reporta una regresión.

**`validateAndPersistPlan` (líneas 143-204, sin cambios de línea respecto a la sección 4.2 de arriba):**

La sección 4.3 de arriba decía "insertar... condicionado a que `generationRunId` esté definido". Eso ya NO es correcto. La forma corregida, en el mismo punto exacto (entre el cierre del `catch` de `validateRestrictions` en la línea 181 y la apertura del `try` que envuelve `createPlanTransaction` en la línea 183), sin ninguna condición:

```ts
// (nuevo) después de línea 181, antes de línea 183:
// Flujo A paso 2-3 de design.md (D1 corregido): resolver TODAS las imágenes del batch, con
// concurrencia acotada (D3), ANTES de invocar createPlanTransaction (D2) — SIEMPRE, sin
// condicionar a generationRunId. Aplica igual al camino IA (generateAndPersistPlan, que llega
// acá con generationRunId definido) y al camino manual (POST /meal-plans -> createPlan ->
// validateAndPersistPlan sin generationRunId, plans.controller.ts:18-22).
const daysForPersistence = await this.pexels.attachImages(dto.days);

try {
  await this.repository.createPlanTransaction(userId, weekStart, daysForPersistence, generationRunId);
} catch (error) {
  // ... sin cambios ...
}
```

Diferencia concreta con la sección 4.3 original: ya no hace falta `let daysForPersistence = dto.days;` + `if (generationRunId) { ... }` — pasa a ser `const daysForPersistence = await this.pexels.attachImages(dto.days);` sin condición, porque ahora **siempre** hay que intentar la resolución antes de persistir, sin importar si este método fue invocado desde `generateAndPersistPlan` (con `generationRunId`) o directamente desde `createPlan`/`POST /meal-plans` (sin `generationRunId`).

**Importante — lo que NO cambia:** la lógica de `origin` (`recipeOrigin: 'MANUAL' | 'AI' | undefined = generationRunId ? 'AI' : undefined` en `plans.repository.ts:198`, y el comentario de NUT-75 Bug 1 en `plans.repository.ts:72-84`) es una decisión **completamente independiente** de si se intenta resolver `image`, y no se toca. `generationRunId` sigue siendo la única señal de si `origin: 'AI'` se estampa; la corrección de D1 sólo cambia si se llama a Pexels, no de dónde sale `origin`. Una receta creada vía `POST /meal-plans` sin `generationRunId` ahora SÍ intenta resolución de imagen, pero sigue estampando `origin: 'MANUAL'` (por el default de Prisma) exactamente igual que antes.

**`updatePlan` (líneas 229-300) — nuevo punto de integración, fuera de alcance en la versión original de este plan:**

La sección 4 de arriba nunca contempló `updatePlan`/`updatePlanTransaction` como lugar de integración porque, con D1 limitado a `origin: 'AI'`, el camino de edición/regeneración manual (`PUT /meal-plans`) quedaba fuera de alcance por definición (siempre estampa `recipeOrigin: 'MANUAL'` fijo, ver `plans.repository.ts:301-307`). Con la corrección, ya no hay ninguna razón de diseño para excluirlo: D1 corregido aplica a "toda receta nueva... vía edición/regeneración de plan (`PUT /meal-plans`)" (`design.md` D1, línea 24).

Verificado contra el código real: `updatePlan` construye `dto.days` (recibido del cliente, sin pasar por ningún proveedor de IA — comentario líneas 222-227) y lo pasa a `this.repository.updatePlanTransaction(userId, weekStart, dto.days, run.id)` en la línea 285, dentro de un `try` que abre en la línea 284. El bloque `validateRestrictions` anterior cierra su `catch` en la línea 282. El punto exacto de inserción, mismo patrón que D2 exige (antes de la transacción):

```ts
// (nuevo) después de línea 282, antes de línea 284:
// D2 (D1 corregido): mismo criterio que validateAndPersistPlan — resolver TODAS las imágenes
// de dto.days ANTES de invocar updatePlanTransaction. Este camino (PUT /meal-plans, edición/
// regeneración manual) antes quedaba fuera de alcance de D1 (limitado a origin: 'AI'); con la
// corrección, toda receta nueva intenta resolución de imagen, sin importar `origin`.
const daysForPersistence = await this.pexels.attachImages(dto.days);

try {
  await this.repository.updatePlanTransaction(userId, weekStart, daysForPersistence, run.id);
} catch (error) {
  // ... sin cambios ...
}
```

**Nota de repositorio — un solo fix cubre ambos caminos:** `createPlanTransaction` (línea 213) y `updatePlanTransaction` (línea 307) llaman ambos a la misma función privada `createDaysMealsAndRecipes` (`plans.repository.ts:85-133`). El fix pendiente de la sección 4.3 original ("agregar `if (meal.recipe.image !== undefined) { recipeData.image = meal.recipe.image; }` junto a las líneas 110-116") sólo necesita escribirse **una vez**, dentro de `createDaysMealsAndRecipes`, y automáticamente cubre tanto `POST /meal-plans`+`generateAndPersistPlan` como `PUT /meal-plans` — no hace falta ninguna lógica adicional en `updatePlanTransaction` más allá de pasarle `daysForPersistence` en vez de `dto.days` (ver arriba). No existe hoy ningún guard que distinga `origin` dentro de `createDaysMealsAndRecipes` para decidir si copiar `image` — y no debe agregarse ninguno: D1 corregido es justamente "sin importar `origin`".

### 10.2 Nuevo punto de integración: creación manual individual de receta (`POST /recipes`)

Confirmado contra el código real, `apps/api/src/modules/recipe/recipe.service.ts:12-14`:

```ts
async create(data: CreateRecipeDto) {
  return this.repository.create(data);
}
```

Es efectivamente corto, sin ninguna transacción de por medio. Confirmado en `apps/api/src/modules/recipe/recipe.repository.ts:30-38`:

```ts
async create(data: CreateRecipeDto) {
  return this.prisma.recipe.create({
    data: {
      ...data,
      ingredients: data.ingredients as any,
      nutritionalValues: data.nutritionalValues as any,
    },
  });
}
```

Ningún `this.prisma.$transaction(...)` en este método (a diferencia de `createPlanTransaction`/`updatePlanTransaction`/`deletePlanTransaction` en `plans.repository.ts`) — es un único `prisma.recipe.create` directo. D2 ("nunca llamar a Pexels dentro de una transacción") se cumple trivialmente con sólo resolver `image` **antes** de construir el objeto que se pasa a `repository.create`, sin necesidad de ningún reordenamiento adicional.

**Forma exacta de la edición propuesta a `RecipeService.create`:**

```ts
// apps/api/src/modules/recipe/recipe.service.ts
constructor(
  private readonly repository: RecipeRepository,
  private readonly pexels: PexelsService, // nueva dependencia, ver 10.3
) {}

async create(data: CreateRecipeDto) {
  const image = await this.pexels.resolveImage(data.title);
  return this.repository.create({ ...data, image });
}
```

Nota de método: acá se usa `resolveImage(title)` (una sola receta, sin batch) — no `attachImages(days)` como en `plans.service.ts`, porque no hay un array de días/comidas de por medio, sólo un título. Es el mismo método que `PexelsService.resolveImage` ya expone hoy (`apps/api/src/modules/plans/pexels/pexels.service.ts:82`, firma `resolveImage(title: string): Promise<RecipeImage | null>`) — no hace falta ningún método nuevo en `PexelsService` para este consumidor.

**¿Hace falta tocar `RecipeRepository.create`?** No a nivel de runtime: el método ya arma el objeto `data` con `...data` (spread posicional, sin lista explícita de columnas) y lo pasa directo a `prisma.recipe.create` — cualquier campo adicional que el objeto de entrada traiga (incluido `image`) se reenvía solo, sin que el repositorio tenga que nombrarlo. Sí hay una fricción de **tipos** a anticipar para el implementer: la firma actual es `create(data: CreateRecipeDto)`, y `CreateRecipeDto` (`apps/api/src/modules/recipe/dto/create-recipe.dto.ts:35-74`) no declara ningún campo `image`. Pasar el objeto literal `{ ...data, image }` como argumento de una función tipada `(data: CreateRecipeDto)` dispara el chequeo de propiedades excedentes de TypeScript sobre ese literal. El implementer necesita ensanchar el tipo del parámetro — por ejemplo `create(data: CreateRecipeDto & { image?: RecipeImage | null })` — o replicar el patrón `as any` que el propio método ya usa en las líneas 34-35 para `ingredients`/`nutritionalValues`. No es una decisión de diseño (D2/D1 no dictan cuál elegir), es un detalle de tipado a resolver en la etapa de implementación; se deja documentado para que no sea una sorpresa en rojo por un motivo distinto al que el test intenta cubrir.

### 10.3 Relocación de `PexelsService` a un módulo compartido

**Estado real verificado de ambos módulos (leídos completos en esta revisión):**

`apps/api/src/modules/plans/plans.module.ts` (16 líneas completas):
```ts
import { Module } from '@nestjs/common';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { PlansRepository } from './plans.repository';
import { GeminiService } from './gemini/gemini.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [PrismaModule, ConfigModule, AuthModule],
  controllers: [PlansController],
  providers: [PlansService, GeminiService, PlansRepository],
  exports: [PlansService, PlansRepository]
})
export class PlansModule {}
```

`apps/api/src/modules/recipe/recipe.module.ts` (15 líneas completas):
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { RecipeController } from '@/modules/recipe/recipe.controller';
import { RecipeService } from '@/modules/recipe/recipe.service';
import { RecipeRepository } from './recipe.repository';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [RecipeController],
  providers: [RecipeService, RecipeRepository],
  exports: [RecipeService, RecipeRepository]
})
export class RecipeModule {}
```

**Confirmado: no hay dependencia circular.** Ninguno de los dos módulos importa al otro hoy (`PlansModule.imports` = `[PrismaModule, ConfigModule, AuthModule]`; `RecipeModule.imports` = `[PrismaModule, AuthModule]`). Ningún archivo de `recipe/` importa nada de `plans/` ni viceversa (confirmado también con el grep de la sección siguiente: los únicos imports hacia `plans/pexels/*` hoy son internos a esa misma carpeta). Agregar un tercer módulo `PexelsModule` que ninguno de los dos importa al otro, y que ambos importan a él, es un grafo en forma de diamante sin ciclo: `PlansModule -> PexelsModule <- RecipeModule`.

**Relocación propuesta — mover, no reescribir:**

```
apps/api/src/modules/plans/pexels/pexels.service.ts                     -> apps/api/src/modules/pexels/pexels.service.ts
apps/api/src/modules/plans/pexels/pexels-query.util.ts                  -> apps/api/src/modules/pexels/pexels-query.util.ts
apps/api/src/modules/plans/pexels/pexels-candidate-selector.util.ts     -> apps/api/src/modules/pexels/pexels-candidate-selector.util.ts
apps/api/src/modules/plans/pexels/recipe-image.types.ts                 -> apps/api/src/modules/pexels/recipe-image.types.ts
apps/api/src/modules/plans/pexels/pexels.service.spec.ts                -> apps/api/src/modules/pexels/pexels.service.spec.ts
apps/api/src/modules/plans/pexels/pexels-query.util.spec.ts             -> apps/api/src/modules/pexels/pexels-query.util.spec.ts
apps/api/src/modules/plans/pexels/pexels-candidate-selector.util.spec.ts -> apps/api/src/modules/pexels/pexels-candidate-selector.util.spec.ts
apps/api/src/modules/plans/pexels/pexels-concurrency.spec.ts            -> apps/api/src/modules/pexels/pexels-concurrency.spec.ts
```

Nuevo archivo (no existe hoy): `apps/api/src/modules/pexels/pexels.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PexelsService } from './pexels.service';

@Module({
  imports: [ConfigModule],
  providers: [PexelsService],
  exports: [PexelsService],
})
export class PexelsModule {}
```

Y en los dos consumidores:
- `plans.module.ts`: agregar `PexelsModule` a `imports` (`imports: [PrismaModule, ConfigModule, AuthModule, PexelsModule]`) y quitar `PexelsService` de `providers` si algún commit intermedio llegó a agregarlo ahí directamente (hoy no está, ver arriba) — el provider vive en `PexelsModule`, no en `PlansModule`.
- `recipe.module.ts`: agregar `PexelsModule` a `imports` (`imports: [PrismaModule, AuthModule, PexelsModule]`).

**Grep real de todo `apps/api/src` buscando imports hacia `plans/pexels/*` (patrón `from ['"]\.\./pexels|from ['"].*plans/pexels|from ['"]\./pexels`, sobre `**/*.ts`), ejecutado en esta revisión — resultado completo, 7 líneas, en 4 archivos, todos dentro de la propia carpeta `plans/pexels/`:**

```
apps/api/src/modules/plans/pexels/pexels-candidate-selector.util.spec.ts:24: import { selectPexelsCandidate } from './pexels-candidate-selector.util';
apps/api/src/modules/plans/pexels/pexels.service.ts:4:                    import { buildPexelsQuery } from './pexels-query.util';
apps/api/src/modules/plans/pexels/pexels.service.ts:5:                    import { selectPexelsCandidate } from './pexels-candidate-selector.util';
apps/api/src/modules/plans/pexels/pexels-concurrency.spec.ts:39:         import { PEXELS_MAX_CONCURRENT_REQUESTS, resolveWithBoundedConcurrency } from './pexels.service';
apps/api/src/modules/plans/pexels/pexels.service.spec.ts:52:             import { PexelsService, PEXELS_TIMEOUT_MS } from './pexels.service';
apps/api/src/modules/plans/pexels/pexels.service.spec.ts:54:             import { buildPexelsQuery } from './pexels-query.util';
apps/api/src/modules/plans/pexels/pexels-query.util.spec.ts:20:          import { buildPexelsQuery } from './pexels-query.util';
```

(`pexels.service.ts` también importa `type { RecipeImage } from './recipe-image.types'` en su línea 3 — mismo patrón relativo, no capturado por el patrón de grep literal pero confirmado por lectura directa del archivo.)

**Lectura de este resultado — el move es prácticamente gratis hoy:** ningún archivo *fuera* de `plans/pexels/` importa nada de ahí todavía. Ni `plans.module.ts`, ni `plans.service.ts`, ni `plans.repository.ts`, ni (por supuesto) ningún archivo de `recipe/` referencian hoy a `PexelsService`/`buildPexelsQuery`/`selectPexelsCandidate`/`RecipeImage` — porque, como documenta la sección 10.1, la integración real en `plans.service.ts` todavía no se escribió. Todos los imports existentes son relativos (`./...`) entre archivos **hermanos dentro de la misma carpeta**, así que mover la carpeta entera de `plans/pexels/` a `pexels/` (nivel superior) no rompe ninguno de esos 7 imports — la relación de hermandad no cambia, sólo cambia la carpeta contenedora. Lo único que el implementer necesita hacer, además de mover los 8 archivos y crear `pexels.module.ts`, es escribir los imports **nuevos** que todavía no existen (los de la sección 10.1 en `plans.service.ts` y los de la sección 10.2 en `recipe.service.ts`) apuntando ya a la ubicación nueva (`../pexels/pexels.service` desde `plans/plans.service.ts`, o el alias `@/modules/pexels/pexels.service` siguiendo el estilo que ya usa `recipe.module.ts`) en vez de a `./pexels/pexels.service`.

**Alcance del move — puramente de ubicación, ninguna lógica interna cambia:** el contenido de `pexels-query.util.ts` (normalización determinística de query, `design.md` sección 2), `pexels-candidate-selector.util.ts` (predicado + desempate, `design.md` sección 3), `pexels.service.ts` (`resolveImage`, `resolveWithBoundedConcurrency`, constantes `PEXELS_MAX_CONCURRENT_REQUESTS`/`PEXELS_TIMEOUT_MS`, `design.md` secciones 3-4) y `recipe-image.types.ts` (tipo `RecipeImage`, `design.md` sección 8) **no se toca en absoluto** — se mueven de carpeta byte por byte. Lo único nuevo es `pexels.module.ts` (no existía) y los imports de los dos consumidores nuevos. Este move puede hacerse en cualquier momento del ciclo tester/implementer sin arriesgar ningún test ya en verde de `pexels-query.util.spec.ts`/`pexels-candidate-selector.util.spec.ts`/`pexels.service.spec.ts`/`pexels-concurrency.spec.ts`, precisamente porque esos specs sólo importan de sus hermanos relativos, nunca desde afuera de la carpeta.

**Nota sobre la sección 3 original (arriba):** la sección 3 de este plan justificaba ubicar `pexels/` dentro de `plans/` (en vez de un módulo top-level nuevo) precisamente citando D1 limitado a `origin: 'AI'` ("el único consumidor real... es `PlansService`, exactamente igual que `GeminiService`"). Esa premisa ya no es válida — `RecipeService` es ahora un segundo consumidor real de primer nivel, en un módulo de dominio distinto (`recipe/`, no `plans/`), así que el criterio que llevó a espejar `plans/gemini/` ya no aplica: `GeminiService` sigue teniendo un único consumidor (`PlansService`), pero `PexelsService` ya no.

### 10.4 Tests que quedan obsoletos por la corrección

Los siguientes tests, agregados en la etapa de integración de NUT-83 (no son de NUT-75 — esos siguen válidos sin cambios), afirman hoy lo **contrario** de lo correcto después de la corrección de D1. El tester debe corregirlos en la siguiente etapa; esta revisión sólo los identifica, no los toca.

**`apps/api/src/modules/plans/tests/plans.service.spec.ts`:**

1. **Líneas 458-469** — comentario JSDoc del `describe` de integración: dice literalmente *"dentro de `validateAndPersistPlan`, condicionado a que `generationRunId` esté definido"* (línea 461). Ya no es correcto (ver 10.1) — debe actualizarse para reflejar que ya no hay condición.
2. **Línea 470** — encabezado del `describe`: `describe('NUT-83 - integración de PexelsService en validateAndPersistPlan (AC5 parte 2, AC13, AC14)', () => {`. El nombre sigue siendo válido como encabezado, pero el contenido de AC13 que agrupa (puntos 3 y 4 de abajo) ya no expresa el AC13 corregido.
3. **Líneas 488-500** — test `'AC13: validateAndPersistPlan invocado SIN generationRunId (camino manual POST /meal-plans) nunca llama a pexels.attachImages'`. Afirma `expect(mockPexels.attachImages).not.toHaveBeenCalled()` para el camino manual — **esto es exactamente lo contrario** de lo que pide el AC13 corregido (`design.md` sección 6, punto 13): ahora esa llamada SÍ debe dispararse. Debe reescribirse para afirmar que `attachImages` **sí** se llama, con el mismo assert de orden que el test de la línea 471 (AC14).
4. **Líneas 502-515** — test `'AC13: updatePlan (regeneración/edición manual, camino updatePlanTransaction) nunca llama a pexels.attachImages'`. Mismo problema: afirma que `updatePlan` nunca llama a `attachImages`. Con la corrección (sección 10.1 de este documento), `updatePlan` ahora SÍ debe llamarlo, antes de `updatePlanTransaction`. Debe reescribirse como un test de orden (`attachImages` -> `updatePlanTransaction`), análogo al de la línea 471 pero para este método.

**`apps/api/src/modules/plans/tests/plans.repository.spec.ts`:**

5. **Líneas 524-542** — comentario JSDoc del `describe` de integración de `image`: dice *"su ausencia deliberada en `updatePlanTransaction` (camino manual)"* (línea 526-527). Ya no es correcto (ver 10.1) — `updatePlanTransaction` ahora sí debe recibir/propagar `image` (vía el mismo fix único en `createDaysMealsAndRecipes`, sección 10.1).
6. **Líneas 619-645** — test `"updatePlanTransaction (camino manual, PUT /meal-plans): NUNCA agrega la clave \"image\" a recipeData, aunque el objeto de entrada la traiga (AC13, alcance limitado a origin: \"AI\")"`. Este es el test más directamente contradicho por la corrección: afirma `expect(Object.prototype.hasOwnProperty.call(recipeData, 'image')).toBe(false)` para `updatePlanTransaction` incluso cuando la entrada trae un `RecipeImage` válido (línea 639, `withRecipeImage(sampleRecipeImage)`). Con D1 corregido, este camino debe comportarse **igual** que `createPlanTransaction` (tests de las líneas 578-589 y 591-603, que sí quedan válidos sin cambios): la clave `image` debe llegar tal cual cuando está definida, y `null` tal cual cuando Pexels no encontró nada — nunca "siempre ausente". Este test debe reescribirse para reflejar el mismo comportamiento que ya prueban los tests de `createPlanTransaction` inmediatamente arriba, aplicado a `updatePlanTransaction`.

**No están afectados y siguen válidos sin cambios:** todos los tests de NUT-75 en ambos archivos (`Bug 1`, `Bug 2`, `Bug 3`, `Bug 4`, Gap 1-6, tests de `origin`/`generationRunId`/`GenerationRun`), los tests de `createPlanTransaction` de las líneas 578-617 de `plans.repository.spec.ts` (ya reflejan el comportamiento correcto y sirven de plantilla para corregir el punto 6), y el test de la línea 471 de `plans.service.spec.ts` (AC14, orden de llamadas en `generateAndPersistPlan`) — ese test ya expresa la regla correcta sin condición de `generationRunId`, no necesita cambios.

---

Generado (sección 10): 2026-09-30T17:32:32.373Z (`node -e "console.log(new Date().toISOString())"`, hora real del sistema al momento de escribir esta sección de revisión).

---

## 11. Revisión: swap Pexels → Unsplash + disciplina de comentarios

> **Motivo de esta sección:** `design.md` sección 11 (posterior a las secciones 1-10 de `design.md` y a las secciones 1-10 de este `plan.md`, ambas ya reconciliadas y con 2 rondas de revisión de PR pasadas sobre Pexels) ordena dos cambios retroactivos: (11.1) disciplina de comentarios para todo el código tocado por este ticket, y (11.2) reemplazo total de Pexels por Unsplash como proveedor — mismo campo `Recipe.image Json?`, mismo rol arquitectónico, contrato HTTP y de mapeo nuevos. Todo lo que sigue fue verificado contra el código REAL de la rama en este momento (no contra lo que describían las secciones 1-10 de este documento, que ya habían quedado desactualizadas por la propia implementación — ver nota debajo sobre el estado real encontrado).

**Nota importante sobre el estado real encontrado (no documentado por ninguna sección anterior de este `plan.md`):** las secciones 1-10 de este documento fueron escritas en distintos momentos de la exploración y quedaron, en varios puntos, por detrás de lo que terminó implementándose y pasando revisión de PR. Verificado con lectura directa de archivos en esta revisión:
- La carpeta ya vive en `apps/api/src/modules/pexels/` (nivel superior, no `apps/api/src/modules/plans/pexels/`) — el move descrito como "propuesto" en la sección 10.3 de este documento ya se ejecutó, con `pexels.module.ts` ya creado y ya importado desde `plans.module.ts` y `recipe.module.ts`.
- La integración en `plans.service.ts` (`PexelsService` inyectado, usado sin condicionar a `generationRunId`, con un wrapper `resolveImagesOrDegrade` que nunca relanza) y en `recipe.service.ts` (`PexelsService.resolveImage` llamado dentro de `create`, también con guard anti-relanzamiento) ya están escritas y ya tienen tests en verde.
- `apps/api/.env.example` y `apps/api/.env` **ya tienen `UNSPLASH_ACCESS_KEY`** y **ya NO tienen `PEXELS_API_KEY` en absoluto** — es decir, el nombre de la variable de entorno ya fue migrado antes que el código (consistente con `git status` al inicio de esta sesión, que marca `apps/api/.env.example` como modificado). Esto es una desalineación real a corregir, no un hallazgo que invalide nada: el código (`pexels.service.ts`) sigue leyendo literalmente `'PEXELS_API_KEY'` de `ConfigService`, que hoy ya no existe en el entorno — si algo intentara usar el adaptador tal cual está ahora mismo, se comportaría como "key ausente" (D4: degrada a `null`, nunca lanza) de forma silenciosa, no como un error visible. Motivo de más para que el rename de código cierre esta brecha cuanto antes.

### 11.1 Inventario completo verificado (grep real, no re-derivado)

Ejecutado en esta revisión: `grep -rli "pexels" apps/api/src apps/api/prisma` → **17 archivos**, cero resultados en `apps/api/prisma` (el modelo Prisma de `Recipe` nunca mencionó el nombre del proveedor — `image Json?` es agnóstico, confirmado también por `design.md` sección 11.2: "`Recipe.image Json?` no cambia"). Lista completa, con ruta exacta desde la raíz del repo:

```
apps/api/src/modules/pexels/pexels-candidate-selector.util.spec.ts
apps/api/src/modules/pexels/pexels-candidate-selector.util.ts
apps/api/src/modules/pexels/pexels-concurrency.spec.ts
apps/api/src/modules/pexels/pexels-query.util.spec.ts
apps/api/src/modules/pexels/pexels-query.util.ts
apps/api/src/modules/pexels/pexels.module.ts
apps/api/src/modules/pexels/pexels.service.spec.ts
apps/api/src/modules/pexels/pexels.service.ts
apps/api/src/modules/pexels/recipe-image.types.ts
apps/api/src/modules/plans/plans.module.ts
apps/api/src/modules/plans/plans.service.ts
apps/api/src/modules/plans/tests/plans-transaction-no-network.spec.ts
apps/api/src/modules/plans/tests/plans.repository.spec.ts
apps/api/src/modules/plans/tests/plans.service.spec.ts
apps/api/src/modules/recipe/recipe.module.ts
apps/api/src/modules/recipe/recipe.service.ts
apps/api/src/modules/recipe/tests/recipe.service.spec.ts
```

**Archivo notable que NO está en esta lista pese a ser el consumidor directo del campo `image`:** `apps/api/src/modules/plans/plans.repository.ts`. Confirmado por lectura directa (líneas 118-127 y 252-270): lee/escribe `meal.recipe.image` y `recipeData.image` como dato plano sin tipar contra ningún provider literal (`(meal.recipe as { image?: unknown }).image`), y el propio `plans-transaction-no-network.spec.ts` (AC14/D2) depende de que ese archivo **nunca** contenga la cadena "pexels" — es justamente la prueba de que D2 se cumple. Este archivo **no necesita ningún cambio** por el swap de proveedor; sólo cambia el valor en runtime del campo `provider` dentro del JSON que pasa a través suyo, nunca su propio código. Mencionarlo explícitamente para que el implementer no lo toque por error ni el tester lo liste como pendiente.

### 11.2 Mapeo archivo por archivo: `pexels/` → `unsplash/`

Carpeta nueva: `apps/api/src/modules/unsplash/` (mismo nivel que `apps/api/src/modules/pexels/` hoy — el move de pexels/ a nivel superior, sección 10.3, ya está hecho; este es el mismo movimiento aplicado al nombre del proveedor, no una relocación de nivel adicional).

| Archivo actual (`pexels/`) | Archivo nuevo (`unsplash/`) | Tipo de cambio |
|---|---|---|
| `pexels.service.ts` | `unsplash.service.ts` | Reescritura del contenido (contrato HTTP distinto), mismo rol |
| `pexels.service.spec.ts` | `unsplash.service.spec.ts` | Reescritura mayoritaria (ver 11.4) |
| `pexels-query.util.ts` | `unsplash-query.util.ts` | Rename de archivo/función únicamente — algoritmo de normalización **sin cambios** (`design.md` 11.2: "la misma query normalizada de la sección 2, sin cambios en el algoritmo de normalización") |
| `pexels-query.util.spec.ts` | `unsplash-query.util.spec.ts` | Rename+adapt (ver 11.4) |
| `pexels-candidate-selector.util.ts` | `unsplash-candidate-selector.util.ts` | Reescritura del predicado/mapeo de campos, misma lógica de selección/desempate |
| `pexels-candidate-selector.util.spec.ts` | `unsplash-candidate-selector.util.spec.ts` | Reescritura de fixtures (ver 11.4) |
| `pexels-concurrency.spec.ts` | `unsplash-concurrency.spec.ts` | Rename+adapt únicamente — `resolveWithBoundedConcurrency` es una primitiva genérica sin conocimiento del proveedor (ver 11.4) |
| `pexels.module.ts` | `unsplash.module.ts` | Rename de clase/import, contenido estructuralmente idéntico |
| `recipe-image.types.ts` | **`recipe-image.types.ts` (mismo nombre, nueva carpeta)** | Ver debajo |

**`recipe-image.types.ts` — confirmación explícita pedida por la tarea:** el archivo **se mueve de carpeta pero NO se renombra**, y el tipo exportado sigue llamándose `RecipeImage` (no `UnsplashImage` ni similar). Razón: es el contrato público persistido en la columna `Recipe.image` (`design.md` sección 8, sin cambios de forma por este ticket) — su nombre ya es agnóstico del proveedor a propósito (es "la imagen de la receta", no "la respuesta de Pexels"), y `design.md` 11.2 es explícito en que sólo cambia el *valor* del campo `provider` (`'PEXELS'` → `'UNSPLASH'`), nunca la forma del tipo ni dónde vive conceptualmente. Lo único que cambia dentro del archivo es el literal de tipo de la propiedad `provider`:
```ts
// antes:
provider: 'PEXELS';
// después:
provider: 'UNSPLASH';
```
Ningún otro campo de `RecipeImage` (`providerPhotoId`, `imageUrl`, `sourceUrl`, `photographer`, `photographerUrl`, `alt`, `query`, `retrievedAt`) cambia de nombre ni de tipo.

**Constantes/tipos internos a renombrar dentro de `unsplash.service.ts` (hoy en `pexels.service.ts`):**
- `PEXELS_MAX_CONCURRENT_REQUESTS` → `UNSPLASH_MAX_CONCURRENT_REQUESTS` (valor sin cambios: `3`)
- `PEXELS_TIMEOUT_MS` → `UNSPLASH_TIMEOUT_MS` (valor sin cambios: `5000`, `design.md` 11.2 confirma "mismo patrón... sin cambios en el mecanismo")
- `PEXELS_SEARCH_URL` (`'https://api.pexels.com/v1/search'`) → `UNSPLASH_SEARCH_URL` (`'https://api.unsplash.com/search/photos'`)
- `PEXELS_PER_PAGE` → `UNSPLASH_PER_PAGE` (valor sin cambios: `5`)
- `resolveWithBoundedConcurrency` — **no se renombra**, es genérico y no referencia a ningún proveedor en su firma ni implementación (confirmado por lectura directa, `pexels.service.ts:28-55`); sólo cambia de archivo junto con el resto de `unsplash.service.ts`.
- `PexelsCandidate` (tipo interno de `pexels-candidate-selector.util.ts`) → `UnsplashCandidate`, con forma nueva: `{ id: number; urls: { regular: string }; links: { html: string; download_location: string }; user: { name: string; links: { html: string } }; alt_description?: string; width: number; height: number; [key: string]: unknown }` (agrega `links.download_location`, necesario para el tracking de 11.2 de `design.md`).
- `buildPexelsQuery` → `buildUnsplashQuery`; `selectPexelsCandidate` → `selectUnsplashCandidate`.
- `PexelsService` (clase) → `UnsplashService`; `PexelsModule` → `UnsplashModule`.

**Método nuevo, sin archivo propio (vive dentro de `unsplash.service.ts`):** el tracking de `download_location` (`design.md` 11.2) no necesita un archivo separado — es una responsabilidad interna de `UnsplashService`, invocada una vez por `resolveImage` inmediatamente después de seleccionar un candidato válido, antes de retornar el `RecipeImage`. Nombre sugerido: `private trackDownload(downloadLocation: string, providerPhotoId: string): Promise<void>` — fire-and-forget respecto al resultado de `resolveImage` (nunca debe hacer que `resolveImage` espere indefinidamente ni propague su fallo), con su propio `try/catch` que sólo loguea `error` (nunca `warn`, per `design.md` 11.2) y nunca lanza hacia `resolveImage`.

### 11.3 Puntos de consumo — línea exacta de cada import/uso a cambiar

**`apps/api/src/modules/plans/plans.module.ts`:**
- Línea 9: `import { PexelsModule } from '@/modules/pexels/pexels.module';` → `import { UnsplashModule } from '@/modules/unsplash/unsplash.module';`
- Línea 12: `imports: [PrismaModule, ConfigModule, AuthModule, PexelsModule],` → `imports: [PrismaModule, ConfigModule, AuthModule, UnsplashModule],`

**`apps/api/src/modules/plans/plans.service.ts`:**
- Línea 11: `import { PexelsService } from '@/modules/pexels/pexels.service';` → `import { UnsplashService } from '@/modules/unsplash/unsplash.service';`
- Línea 20 (parámetro de constructor): `private readonly pexels: PexelsService` → `private readonly unsplash: UnsplashService`
- Línea 32 (único call-site de uso real): `return await this.pexels.attachImages(days);` → `return await this.unsplash.attachImages(days);`
- Líneas 23-29 y 33-38 son comentario (JSDoc + inline) mencionando "Pexels" en prosa — se actualizan como parte del rename, pero ver 11.6: es también la oportunidad de aplicar la poda de comentarios pedida en 11.1, no sólo el search-replace del nombre.

**`apps/api/src/modules/recipe/recipe.module.ts`:**
- Línea 7: `import { PexelsModule } from '@/modules/pexels/pexels.module';` → `import { UnsplashModule } from '@/modules/unsplash/unsplash.module';`
- Línea 11: `imports: [PrismaModule, AuthModule, PexelsModule],` → `imports: [PrismaModule, AuthModule, UnsplashModule],`

**`apps/api/src/modules/recipe/recipe.service.ts`:**
- Línea 7: `import { PexelsService } from '@/modules/pexels/pexels.service';` → `import { UnsplashService } from '@/modules/unsplash/unsplash.service';`
- Línea 8: `import type { RecipeImage } from '@/modules/pexels/recipe-image.types';` → `import type { RecipeImage } from '@/modules/unsplash/recipe-image.types';`
- Línea 16 (parámetro de constructor): `private readonly pexels: PexelsService,` → `private readonly unsplash: UnsplashService,`
- Línea 36 (único call-site de uso real): `image = await this.pexels.resolveImage(data.title);` → `image = await this.unsplash.resolveImage(data.title);`
- Líneas 19-32 y 37-41 son comentario — mismo caso que arriba, ver 11.6.

No hay ningún otro archivo de producción (fuera de `pexels/`→`unsplash/` y estos 4) que importe o referencie al adaptador — confirmado por el inventario de 17 archivos de 11.1 (los 4 archivos de test de `plans/tests/` y `recipe/tests/` son tests, cubiertos en 11.4, no "puntos de consumo" de producción).

### 11.4 Tests existentes — rename+adapt vs. reescritura, con criterio por archivo

| Spec | Decisión | Por qué |
|---|---|---|
| `pexels-query.util.spec.ts` → `unsplash-query.util.spec.ts` | **Rename + adapt mínimo** (import y nombre de función únicamente) | El algoritmo de normalización de query es idéntico (`design.md` 11.2: "sin cambios en el algoritmo de normalización"). Cada `expect(buildPexelsQuery(...)).toBe(...)` pasa a `expect(buildUnsplashQuery(...)).toBe(...)` con el mismo string esperado — cero cambio de lógica de test. |
| `pexels-concurrency.spec.ts` → `unsplash-concurrency.spec.ts` | **Rename + adapt mínimo** (import y nombre de constante únicamente) | `resolveWithBoundedConcurrency` es una primitiva genérica inyectada con un `resolveOne` falso (ver `pexels.service.ts:28-55` y el propio spec, que nunca toca `fetch` ni ningún campo de Pexels/Unsplash) — no tiene ningún conocimiento del proveedor. Sólo cambia `PEXELS_MAX_CONCURRENT_REQUESTS` → `UNSPLASH_MAX_CONCURRENT_REQUESTS` y la ruta de import. |
| `pexels-candidate-selector.util.spec.ts` → `unsplash-candidate-selector.util.spec.ts` | **Reescritura de fixtures, estructura de casos conservada** | La *lógica* que se prueba (primero válido por posición, desempate por `id` duplicado, `photos` no-array → `null`, nunca lanza) es idéntica — el `describe`/`it` de más alto nivel pueden conservar sus nombres y orden. Pero el fixture `validCandidate()` (hoy `{ id, src: { large }, url, photographer, photographer_url, width, height }`) tiene que reescribirse campo por campo a la forma de Unsplash (`{ id, urls: { regular }, links: { html, download_location }, user: { name, links: { html } }, alt_description, width, height }`) — ningún campo del fixture actual sobrevive sin cambio de nombre o de anidamiento, así que en la práctica casi todo el contenido del archivo se reescribe aunque la *forma* del archivo (misma cantidad de tests, mismos nombres de `describe`) se mantenga. |
| `pexels.service.spec.ts` → `unsplash.service.spec.ts` | **Reescritura**, con reutilización explícita de 3 helpers | El contrato HTTP cambia en casi todos los ejes a la vez: URL base, forma del header (`Authorization: <key>` sin prefijo → `Authorization: Client-ID <key>`), parámetros de query nuevos (`order_by=relevant`, `content_filter=high`, a verificar explícitamente — AC nueva, ver 11.5), mapeo completo candidato→`RecipeImage`, y el tracking de `download_location` es un flujo enteramente nuevo sin equivalente en el archivo actual. Esto hace que casi cada `it(...)` deba reescribirse con cuerpos nuevos, no sólo nombres. **Sí se reutilizan tal cual** (helpers puros, sin acoplar al proveedor): `getHeaderValue` (lee headers en cualquier forma), `assertApiKeyNeverLeaked` (genérico sobre cualquier spy y cualquier valor de key — sólo cambia qué constante de key mockeada se le pasa), y la estructura general `createConfigServiceMock` (cambia sólo el nombre de la key leída, `'PEXELS_API_KEY'` → `'UNSPLASH_ACCESS_KEY'`). El test de regresión del bug de timeout durante `response.json()` (líneas 325-396 del archivo actual) también se conserva como caso a re-probar contra la nueva implementación — es una regla de mecanismo (el `AbortSignal` debe cubrir también la lectura del body), no algo específico de Pexels, y `design.md` 11.2 confirma explícitamente que ese fix "sigue vigente sin cambios en el mecanismo". |
| `plans.service.spec.ts`, `plans.repository.spec.ts`, `recipe.service.spec.ts`, `plans-transaction-no-network.spec.ts` | **Adapt (rename de identificadores), no reescritura** | Estos 4 archivos no conocen el contrato HTTP del proveedor en absoluto — mockean `PexelsService`/`mockPexels`/`mockPexelsService` como una caja negra con los métodos `resolveImage`/`attachImages` (ver `recipe.service.spec.ts:36-38`, `mockPexelsService = { resolveImage: jest.fn() }`). El cambio es mecánico: renombrar el import (`PexelsService`→`UnsplashService`), el nombre de la variable mock (`mockPexels`→`mockUnsplash`), los literales de texto en nombres de `describe`/`it` que dicen "Pexels", y — único caso con contenido real que cambia — en `plans-transaction-no-network.spec.ts` la aserción de la línea 32 (`expect(content).not.toMatch(/pexels/i);`) pasa a `expect(content).not.toMatch(/unsplash/i);`, y el título del `describe` (línea 23) de "...no referencia al adaptador de Pexels..." a "...no referencia al adaptador de Unsplash...". La *lógica* de cada test (orden de llamadas, guard anti-relanzamiento, AC13/AC14) no cambia una coma. |

**Tests NUEVOS que hacen falta y no existían antes** (tracking de `download_location`, `design.md` 11.2 — ninguno de estos tiene equivalente en el código actual de Pexels, que no tenía ningún requisito de tracking):
1. **Se dispara exactamente una vez por candidato elegido:** dado un `fetch` mock que responde 200 con un candidato válido (incluyendo `links.download_location`), `resolveImage` debe disparar una segunda llamada a `fetch` (o al mecanismo elegido) contra esa URL exacta, con header `Authorization: Client-ID <key>`, **después** de haber seleccionado el candidato y **antes** de retornar el `RecipeImage` — o, si se implementa realmente fire-and-forget sin esperar su resolución, verificable al menos como "se invocó" sin bloquear el `await` de `resolveImage`.
2. **No se duplica en relecturas:** el camino de lectura (`findAll`/`findById` de `recipe.repository.ts`, cualquier controlador GET) nunca debe referenciar `UnsplashService` en absoluto — esto es demostrable con el mismo patrón estático que `plans-transaction-no-network.spec.ts` ya usa para D2 (leer el archivo de lectura como texto y afirmar que no contiene "unsplash"), que es más fuerte y más barato que un test de comportamiento con mocks. Complementar con un test de comportamiento sobre `attachImages`: si dos recetas del mismo batch normalizan a la misma query (ya cubierto por el test de memoización existente, líneas 423-491 de `pexels.service.spec.ts`) y por tanto comparten el mismo candidato resuelto, el tracking debe dispararse **una sola vez** para esa foto, no una vez por receta — este caso sí es nuevo respecto al test de memoización actual (que sólo verifica que `fetch` de búsqueda se llama una vez, no que el tracking también se deduplica).
3. **Falla sin romper la receta:** mock de la llamada a `download_location` rechazando (timeout/401/403/429/5xx) — `resolveImage` debe seguir retornando el `RecipeImage` completo y válido (la imagen en sí ya fue encontrada; sólo el tracking falló), sin lanzar, con un log de nivel `error` (no `warn`) que mencione el `providerPhotoId` y la URL de tracking que falló.
4. **Nunca expone la key ni la URL de tracking en logs públicos:** extender `assertApiKeyNeverLeaked` (o un helper hermano) para cubrir también el spy del log de `error` del punto 3 — la key nunca debe aparecer ahí, y (nueva regla, no pedida para los warnings de búsqueda) tampoco debe aparecer el valor de `download_location` en ningún log de nivel distinto a ese `error` interno controlado — en particular, nunca en ninguna respuesta HTTP pública ni en el objeto `RecipeImage` retornado (ese objeto no tiene ningún campo para `download_location`, confirmado por el tipo `RecipeImage` sin cambios de forma).

### 11.5 Parámetros de búsqueda — AC nueva explícita

No estaba cubierto por ningún test de Pexels (no existían esos parámetros): un test que verifique que la URL de búsqueda incluye `order_by=relevant` y `content_filter=high` además de `query`/`per_page`/`page` (`design.md` 11.2). Mismo patrón que el test AC3 actual (línea 149-153 de `pexels.service.spec.ts`, que ya lee `urlObj.searchParams.get(...)`), extendido con dos `expect` adicionales.

### 11.6 Config — estado real confirmado (sin imprimir valores)

Confirmado con `grep -oE '^[A-Z_]+=' apps/api/.env.example` y el equivalente sobre `apps/api/.env` (ambos devuelven sólo nombres de variable, nunca valores):

```
DATABASE_URL=
DIRECT_URL=
JWT_SECRET=
JWT_EXPIRES_IN=
GEMINI_API_KEY=
CORS_ORIGINS=
UNSPLASH_ACCESS_KEY=
```

Idéntico en ambos archivos. **`UNSPLASH_ACCESS_KEY` ya está presente** en los dos (al final del archivo, no inmediatamente después de `GEMINI_API_KEY` como sugería la sección 6 original de este documento para `PEXELS_API_KEY` — la ubicación real ya quedó fijada y no hace falta reordenar). **`PEXELS_API_KEY` ya NO aparece en ninguno de los dos archivos** — su remoción ya se hizo. No hay ninguna acción pendiente de config: el único trabajo pendiente es que `unsplash.service.ts` lea `'UNSPLASH_ACCESS_KEY'` (no `'PEXELS_API_KEY'`, que es lo que lee hoy el archivo todavía llamado `pexels.service.ts`) — ver la nota de "estado real encontrado" al inicio de esta sección 11.

### 11.7 Disciplina de comentarios — ejemplos concretos verificados (para que el tester/implementer tengan qué NO replicar)

Verificado por lectura directa de línea, los 3 ejemplos más flagrantes:

1. **`apps/api/src/modules/pexels/pexels.service.spec.ts:325-350`** (26 líneas de comentario `/** ... */`) documentando el test que arranca en la línea 351 ("BUG real de PR review"). El comentario reexplica en prosa, con el mismo nivel de detalle, exactamente lo que el propio test ya hace con nombres descriptivos (`fetchMock` que resuelve rápido pero cuyo `.json()` se cuelga, avance de fake timers, assert de `result === null`) — es el ejemplo más literal de "más líneas de comentario que de código" que señala `design.md` 11.1. El dato de negocio real que vale la pena preservar (que hubo un bug real de PR review sobre el alcance del `AbortSignal`) cabe en una o dos líneas, no 26.
2. **`apps/api/src/modules/pexels/pexels.service.ts:178-200`** (23 líneas de JSDoc) sobre el método `attachImages` (líneas 201-243, 43 líneas de código). Mezcla una explicación legítima y no obvia (por qué se memoiza por *query normalizada* y no por título crudo — una lección real de revisión de PR, "mejora barata #4") con prosa que sólo repite lo que el código ya dice con sus propios nombres (`titleByQuery`, `resolveWithBoundedConcurrency`, el guard `if (meal.recipe)`). Vale la pena conservar la primera parte (la razón no obvia), no la segunda.
3. **`apps/api/src/modules/recipe/recipe.service.ts:19-32`** (14 líneas de JSDoc) sobre `create` (líneas 33-48, 16 líneas de código). Reexplica en prosa referencias a D1/D2 de `design.md` que ya están trazadas en el propio `design.md` — el método en sí es corto y su propio código (`resolveImage` antes de `repository.create`, sin ninguna transacción de por medio) ya es evidente sin la reexplicación completa de por qué D2 se satisface "trivialmente" acá.

Regla operativa para el código nuevo de `unsplash/` (11.1 de `design.md`): cada comentario que se escriba debe poder responder "¿esto no sería obvio leyendo sólo el código?" — si la respuesta es que sí sería obvio, no se escribe. Las referencias a `design.md`/AC se mantienen cuando dan trazabilidad real (ej. "por qué 401/403 se tratan igual que un fallo de proveedor" si no fuera evidente), pero sin reabrir la explicación completa de la decisión ya documentada en `design.md`.

### 11.8 Orden de trabajo sugerido para el ciclo tester → implementer

**Recomendación: dos ciclos, no uno solo y no la granularidad incremental original de 10 pasos de la sección 9.**

Razonamiento:
- **Por qué NO un solo ciclo gigante para todo:** el tracking de `download_location` (11.2 de `design.md`) es la única pieza de este cambio que es lógica genuinamente nueva, sin equivalente construido y revisado en Pexels — tiene su propio riesgo real (relación con D2, con el saneamiento de logs de la sección 7 de `design.md`, con el "fire-and-forget que nunca debe bloquear ni romper la receta"). Mezclarla en el mismo commit/ciclo que un rename mecánico de 17 archivos hace más difícil, si algo falla en rojo, saber si falló por un error de rename (ej. un import que quedó apuntando a `pexels/`) o por un bug real en la lógica de tracking nueva.
- **Por qué NO replicar los 10 pasos incrementales de la sección 9 original:** esos pasos existían para validar, uno por uno, decisiones de diseño nuevas y no probadas (D1-D4, la ubicación del módulo, la forma de pasar `image` a través de la transacción). Ninguna de esas decisiones cambia con el swap de proveedor — ya están tomadas, construidas y en verde. Re-trocear el swap mecánico en 10 etapas (query util, luego selector, luego service, luego integración...) no reduce ningún riesgo nuevo, porque no hay ningún riesgo de diseño nuevo en esa parte — sólo agregaría cambios de contexto sin beneficio, para un trabajo que es, en esencia, buscar-y-reemplazar con remapeo de campos.

**Ciclo 1 (grande, mecánico) — todo el swap de nombre/contrato HTTP/fixtures de una vez:**
- Tester: reescribe/renombra los 9 archivos de `unsplash/` (incluidos los specs, sección 11.4) + adapta los 4 specs de `plans/`/`recipe/` (rename de identificadores) + agrega el test de parámetros de búsqueda (11.5), todo en un solo lote de cambios en rojo.
- Implementer: mueve+reescribe los 9 archivos de implementación de `unsplash/`, actualiza los 4 puntos de consumo (11.3), aplica la disciplina de comentarios (11.7) al código que toca.
- Un solo ciclo tiene sentido acá porque todas estas piezas están acopladas entre sí por construcción (el fixture del selector y las aserciones del service tienen que coincidir en la forma del candidato; los 4 archivos de consumo sólo compilan si el import nuevo existe) — partirlo en etapas obligaría a tener estados intermedios deliberadamente rotos sin que eso aporte ninguna señal.

**Ciclo 2 (chico, foco en lo nuevo) — tracking de `download_location`, después de que el Ciclo 1 esté en verde:**
- Tester: los 4 tests nuevos de 11.4 (dispara una vez, no se duplica, falla sin romper la receta, nunca expone key/URL de tracking).
- Implementer: el método `trackDownload` dentro de `unsplash.service.ts`.
- Se separa del Ciclo 1 precisamente porque es la única parte de este trabajo con riesgo de diseño real (no mecánico) — merece su propio rojo→verde aislado, con su propia oportunidad de iterar sin arrastrar o re-tocar los 17 archivos del rename mecánico si algo de la lógica de tracking necesita ajustarse.

---

Generado (sección 11): 2026-10-01T14:37:51.447Z (`node -e "console.log(new Date().toISOString())"`, hora real del sistema al momento de escribir esta sección de revisión).

---

## 12. Revisión mayor — mapeo a archivos reales

> **Motivo de esta sección:** `design.md` sección 12 (bugs #1-#8 confirmados contra el código real de `apps/api/src/modules/unsplash/`, ya movido e implementado — secciones 1-11 de este `plan.md` describen el estado anterior al swap completo a Unsplash y a este hallazgo de revisión). Todo lo que sigue se verificó leyendo el código real de la rama en este momento: los 9 archivos de `apps/api/src/modules/unsplash/`, `recipe.service.ts`/`recipe.controller.ts`/`recipe.repository.ts`/`recipe.module.ts`, `plans.service.ts`/`plans.repository.ts`/`plans.controller.ts`, `apps/api/prisma/seed.ts`, `apps/api/package.json`, `apps/api/jest.config.js`, `apps/api/tsconfig.json` y los specs existentes relevantes. No se ejecutó ningún comando contra ninguna base de datos ni de red; no se tocó ningún archivo fuera de este `plan.md`.

### 12.1 Archivo por archivo — qué cambia en `apps/api/src/modules/unsplash/`

**Estado real verificado de la carpeta (9 archivos, `ls` directo):**
```
apps/api/src/modules/unsplash/recipe-image.types.ts
apps/api/src/modules/unsplash/unsplash-candidate-selector.util.ts
apps/api/src/modules/unsplash/unsplash-candidate-selector.util.spec.ts
apps/api/src/modules/unsplash/unsplash-concurrency.spec.ts
apps/api/src/modules/unsplash/unsplash-query.util.ts
apps/api/src/modules/unsplash/unsplash-query.util.spec.ts
apps/api/src/modules/unsplash/unsplash.module.ts
apps/api/src/modules/unsplash/unsplash.service.ts
apps/api/src/modules/unsplash/unsplash.service.spec.ts
```

#### 12.1.1 `unsplash-candidate-selector.util.ts` (reescritura parcial — tipo + predicado)

Contenido real completo leído (86 líneas). Cambios exactos:

- **Línea 5** — `id: number;` → `id: string;` (fix #1 de `design.md` 12.1/12.2).
- **Línea 7** — `links: { html: string; download_location: string };` **ya declara `download_location` en el tipo** (confirmado por lectura directa — el hallazgo de `design.md` 12.1 punto 2 es que el *tipo* ya lo tiene pero `isValidCandidate` nunca lo valida, no que falte del tipo). Sin cambio en esta línea.
- **Línea 30** — `if (typeof record.id !== 'number' || !Number.isFinite(record.id)) { return false; }` → reemplazar por la validación de string no vacío (`typeof record.id !== 'string' || record.id.length === 0`), orden 1 del predicado de `design.md` 12.2.
- **Entre las líneas 42 (cierre del bloque `links`) y 44 (bloque `user`)** — insertar la validación nueva de `links.download_location` (orden 4 del predicado de `design.md` 12.2, requisito nuevo: `!isNonEmptyString(links.download_location)` → `return false`). Hoy sólo se valida `links.html` (línea 40); `download_location` nunca se mira.
- **Después de la línea 56 (`if (!isPositiveInteger(record.width) || !isPositiveInteger(record.height))`) y antes del `return true;` de la línea 58** — insertar el paso 8 del predicado (`design.md` 12.2/12.3): validar los 4 campos de URL (`urls.regular`, `links.html`, `user.links.html`, `links.download_location`) contra `isValidUnsplashUrl(value, expectedHost)` con el host esperado correspondiente a cada campo (ver 12.1.2 para dónde vive esa función). Si cualquiera falla, `return false` — mismo criterio "se descarta y se sigue probando el siguiente candidato" ya usado por todo el resto del predicado, sin rama de manejo de error distinta.
- **Líneas 68 y 72-73** (`selectUnsplashCandidate`, deduplicación) — `const seenIds = new Set<number>();` → `Set<string>`; la comparación `typeof (candidate as Record<string, unknown>).id === 'number'` (línea 71) → `=== 'string'`. Mismo mecanismo, sólo el tipo del `Set` y el chequeo de tipo cambian (`design.md` 12.2, "mismo mecanismo y mismo razonamiento... sólo cambia el tipo del `Set`").
- **Fixtures de `unsplash-candidate-selector.util.spec.ts`** (confirmado: hoy usa `id` numérico en sus fixtures, por ejemplo el `describe` de la línea 22 y los `it` de las líneas 23/84/92/103/119) — deben reescribirse con `id` string real (`"LBI7cgq3pbM"`, `"eOLpJytrbsQ"`, etc.) y agregar `links.download_location` con una URL válida de `api.unsplash.com` a cada fixture `validCandidate()`, por el requisito nuevo del predicado. Ningún fixture actual con `id` numérico sigue siendo válido tal cual (`design.md` 12.2, "no se reemplazan, no se mantienen en paralelo").

#### 12.1.2 Nuevo archivo: `apps/api/src/modules/unsplash/unsplash-url-validator.util.ts`

**No existe hoy** (confirmado — los 9 archivos de la carpeta no incluyen ningún validador de URL; `unsplash.service.ts` nunca llama a `new URL(...)` para validar un host, sólo para construir la URL de búsqueda con `searchParams`, línea 79). Es un archivo nuevo, no una modificación.

**Por qué un archivo propio y no un método privado dentro de `unsplash-candidate-selector.util.ts` o de `unsplash.service.ts`:** `design.md` 12.3 es explícito en que es "función única, reutilizada en los dos lugares donde el código envía el header `Authorization` o persiste una URL del proveedor" — y son **tres** consumidores reales distintos una vez contado el mecanismo de recuperación (12.6), no dos:
1. `unsplash-candidate-selector.util.ts` (paso 8 del predicado, 12.1.1 arriba) — valida los 4 campos de un candidato recién llegado de la respuesta de búsqueda.
2. `unsplash.service.ts`, dentro de `trackDownload` (línea 169 hoy) — debe revalidar `candidate.links.download_location` contra `api.unsplash.com` inmediatamente antes del `fetch` de la línea 174, no confiar en que ya pasó la validación del selector (`design.md` 12.3, "defensa en profundidad... un valor persistido no es una fuente de confianza transitiva" — aplica también acá porque entre seleccionar el candidato y hacer el tracking puede mediar la escritura a base de datos, sección 12.5.2).
3. El script/función de recuperación nuevo (12.4 de este documento) — revalida `trackingUrl` leído *desde la base de datos* (no desde una respuesta fresca de Unsplash) contra `api.unsplash.com` antes de cada `fetch` de reintento.

Poner la función en cualquiera de los dos módulos existentes obligaría al tercero a importar un archivo "candidate-selector" o "service" sólo por esta función aislada — un archivo de utilidad nuevo, pura (sin Nest, sin Prisma, mismo criterio ya usado para `unsplash-query.util.ts`/`unsplash-candidate-selector.util.ts`), es la forma más limpia de que los tres consumidores (incluido el script en `apps/api/prisma/`, fuera del árbol de Nest) importen la misma fuente de verdad sin dependencias cruzadas nuevas.

**Contenido propuesto** (firma exacta de `design.md` 12.3, sin cambios):
```ts
export function isValidUnsplashUrl(value: unknown, expectedHost: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && parsed.hostname === expectedHost;
}

// Hosts esperados por campo (design.md 12.3) — exportados para que los 3 consumidores no
// repitan el literal del hostname cada uno por su cuenta.
export const UNSPLASH_IMAGE_HOST = 'images.unsplash.com';   // urls.regular
export const UNSPLASH_PAGE_HOST = 'unsplash.com';           // links.html, user.links.html
export const UNSPLASH_API_HOST = 'api.unsplash.com';        // links.download_location
```

Spec nuevo: `apps/api/src/modules/unsplash/unsplash-url-validator.util.spec.ts` — puro, sin red/Nest/Prisma, mismo patrón que `unsplash-query.util.spec.ts`. Casos mínimos: HTTPS + host exacto → `true`; `http://` (no https) → `false`; host distinto → `false`; el truco de userinfo (`https://api.unsplash.com@evil.com/...`) → `false` (`design.md` 12.3, caso explícitamente citado); string vacío/`undefined`/no-string → `false`; string no parseable como URL → `false` (sin lanzar).

#### 12.1.3 `unsplash.service.ts` (reescritura estructural — split + UTM + cuota + 401/403)

Contenido real completo leído (242 líneas). Cambios por bloque, todos sobre el archivo real:

**a) UTM (`design.md` 12.4) — nuevo paso en `buildRecipeImage` (líneas 145-162):**
Insertar una función nueva `withAttributionUtm(url: string): string` (firma exacta de `design.md` 12.4, puede vivir como función privada del archivo o como export hermano junto a `UNSPLASH_TIMEOUT_MS`) y aplicarla a `sourceUrl`/`photographerUrl` dentro de `buildRecipeImage`:
- **Línea 155** — `sourceUrl: candidate.links.html,` → `sourceUrl: withAttributionUtm(candidate.links.html),`
- **Línea 157** — `photographerUrl: candidate.user.links.html,` → `photographerUrl: withAttributionUtm(candidate.user.links.html),`
- **Línea 154** (`imageUrl: candidate.urls.regular,`) — **sin cambio**, `design.md` 12.4 es explícito: `imageUrl` nunca pasa por UTM.

**b) El split de `resolveCandidate` (`design.md` 12.1 hallazgo #5 / 12.5.2) — el cambio más grande del archivo:**

Estado real hoy: `resolveCandidate` (líneas 70-140) hace búsqueda + selección + tracking **todo junto**, y el tracking (`await this.trackDownload(candidate, apiKey);`, línea 127) ocurre **antes** de que la función retorne `{ query, candidate }` a `resolveImage`/`attachImages` — es decir, antes de que exista ninguna fila de `Recipe` en la base. Esto es exactamente el bug #5 de `design.md` 12.1.

Cambio estructural propuesto (nombres sugeridos, no cerrados por diseño — el tester/implementer puede ajustar siempre que la separación de responsabilidades se mantenga):
- **Renombrar** el método actual `resolveCandidate` (líneas 70-140) a algo como `searchAndSelectCandidate`, y **quitarle** la línea 127 (`await this.trackDownload(candidate, apiKey);`) por completo — esta función deja de hacer ningún tracking, sólo busca y selecciona.
- El valor que retorna (hoy `{ query, candidate }`) pasa a construirse ya como el `PersistedRecipeImage` completo de `design.md` 12.5.1 — con `tracking.status: 'PENDING'`, `tracking.lastAttemptAt: null`, `tracking.trackingUrl: candidate.links.download_location` ya armado en este punto (sin llamar a nada de red para armarlo, es sólo construir el objeto) — para que `resolveImage`/`attachImages` reciban directamente un `PersistedRecipeImage | null`, no un par `{query, candidate}` que cada caller tendría que volver a mapear.
- `trackDownload` (líneas 164-193 hoy) **deja de ser una llamada interna de `resolveCandidate`/`searchAndSelectCandidate`** y pasa a ser un **método público** de `UnsplashService`, invocable independientemente después de que la persistencia ya resolvió (`design.md` 12.5.2 paso 3). Firma sugerida: `async trackDownload(recipeId: string, trackingUrl: string, providerPhotoId: string): Promise<'SUCCEEDED' | 'FAILED'>` — devuelve el nuevo estado en vez de ser `void`, para que el caller (capa de servicio de `recipe`/`plans`, ver 12.2 de este documento) sepa qué escribir en la segunda escritura suelta. **Antes de cada `fetch`** (línea 174 hoy), este método debe llamar a `isValidUnsplashUrl(trackingUrl, UNSPLASH_API_HOST)` (12.1.2) y, si falla, devolver `'FAILED'` sin hacer ningún `fetch` — nunca confiar en que el valor que llega ya fue validado en el momento de selección (`design.md` 12.3, AC4 de `design.md` 12.8).
- **Importante — `trackDownload` ya NO recibe `apiKey` como parámetro externo** (hoy lo recibe de `resolveCandidate`, línea 169/127): como método público invocado después de la persistencia, debe releer `UNSPLASH_ACCESS_KEY` de `this.configService` él mismo (mismo patrón D4 que `searchAndSelectCandidate`/`resolveImage` ya usan) — si falta la key en ese momento (improbable pero no imposible si cambia la config entre el momento de búsqueda y el de tracking), debe degradar a `'FAILED'` sin lanzar, igual que cualquier otro fallo.
- **Caché de `resolveCandidate` por query normalizada** (ver nota en línea 66-69, comentario existente) — se preserva igual en `searchAndSelectCandidate`: `attachImages` sigue deduplicando por query, pero ahora lo que se cachea es el `PersistedRecipeImage` con `tracking.status: 'PENDING'` ya armado, no un `{query, candidate}` crudo.

**c) Cuota (`X-Ratelimit-Remaining`, `design.md` 12.7) — nuevo estado de instancia + nuevo guard:**
- Agregar un campo de instancia nuevo, por ejemplo `private quotaRemaining: number | null = null;` (estado en memoria por proceso, `design.md` 12.7 punto 4).
- **Al inicio de `searchAndSelectCandidate`** (antes de construir la URL, cerca de donde hoy está el chequeo de `apiKey` en las líneas 71-75) — insertar el guard: `if (this.quotaRemaining === 0) { this.logger.warn('unsplash quota exhausted, skipping search'); return null; }` (sin ningún `fetch`, mismo tratamiento que la ausencia de key, `design.md` 12.7 punto 1).
- **Después de la respuesta** (justo después de la línea 96, `const response = await fetch(...)`, antes de mirar `response.status`) — leer `response.headers.get('X-Ratelimit-Remaining')`, parsear como entero no negativo, y si es válido sobreescribir `this.quotaRemaining` (`design.md` 12.7 punto 2 — "sin importar el status", así que esta lectura debe ocurrir antes de la rama `if (response.status !== 200)` de la línea 98, no después).

**d) 401/403 distinguidos (`design.md` 12.7, bug #7) — nueva rama dentro del chequeo de status:**
- **Línea 98-101 hoy:** `if (response.status !== 200) { this.logger.warn(\`Unsplash responded with unexpected status ${response.status}...\`); return null; }` trata 401/403 igual que cualquier otro status. Cambiar a una rama específica **antes** de la rama genérica: `if (response.status === 401 || response.status === 403) { this.logger.warn('Unsplash configuration invalid (401/403) - check UNSPLASH_ACCESS_KEY permissions'); return null; }` (nunca la key en el mensaje, `design.md` 12.7), seguida de la rama genérica existente para el resto de los status no-200.

**e) Constantes/tipo a actualizar junto con 12.1.1:**
- Línea 5 de `unsplash-candidate-selector.util.ts` ya cubierta en 12.1.1 — pero `unsplash.service.ts` importa `UnsplashCandidate` (línea 5 de `unsplash.service.ts`) y usa `candidate.id` en varios lugares (`String(candidate.id)` en la línea 153 — **sin cambio necesario ahí**, `String(...)` sobre un string ya es ese mismo string, sigue siendo correcto sin modificación; líneas 183/188, mensajes de log de `trackDownload`, también usan `candidate.id` en template strings — sin cambio necesario, interpolar un string en un template string funciona igual que interpolar un number).

**f) `attachImages` (líneas 199-240) — impacto indirecto:** no necesita cambios de lógica propios más allá de que el tipo de retorno de `resolveCandidate`/`searchAndSelectCandidate` cambia de `{query, candidate} | null` a `PersistedRecipeImage | null` (12.1.3.b) — las líneas 213-215, 219-222, 230-237 que hoy arman `this.buildRecipeImage(resolved.candidate, resolved.query, meal.recipe.title)` deben ajustarse a la nueva forma (si `searchAndSelectCandidate` ya devuelve el `PersistedRecipeImage` completo con `alt` ya resuelto por receta, no hace falta volver a llamar a `buildRecipeImage` acá — pero el fallback de `alt` por título propio de cada receta, documentado en el comentario de las líneas 217-218 como "bug fix, design.md 11.2", debe preservarse: **cuidado**, ese fallback depende del título de **cada receta individual**, no de la query cacheada compartida — el refactor de 12.1.3.b no puede romper esa regla ya corregida en una revisión anterior. Se deja documentado como riesgo concreto a vigilar en el ciclo de implementación, no un cambio nuevo a hacer).

#### 12.1.4 `unsplash.module.ts` — sin cambios (confirmado)

Contenido real completo leído (11 líneas, ver 12.1 arriba para el listing de la carpeta). El módulo sólo importa `ConfigModule`, declara `UnsplashService` como `provider`/`export`. Ninguno de los cambios de 12.1.1-12.1.3 ni de 12.2-12.4 de este documento agrega un provider nuevo al propio módulo `unsplash/` (el nuevo archivo `unsplash-url-validator.util.ts` de 12.1.2 es una función pura exportada, no una clase `@Injectable()` — no se registra en `providers`). **Confirmado: `unsplash.module.ts` no requiere ningún cambio.**

### 12.2 Punto de integración post-persistencia — líneas exactas

Esta es la pieza de plomería que `design.md` 12.5.2 no cierra del todo (documenta el *cuándo* y el *por qué*, no la forma exacta de pasar los ids de receta recién creados desde la transacción hacia el paso de tracking) — se documenta acá como decisión de implementación necesaria, verificada contra el código real, para que el tester/implementer no la descubra a mitad de un ciclo rojo→verde.

#### 12.2.1 Camino simple: `RecipeService.create` (sin transacción)

Archivo real, contenido completo ya leído arriba (`apps/api/src/modules/recipe/recipe.service.ts`, 73 líneas):

- **Línea 38 hoy:** `return this.repository.create({ ...data, image } as CreateRecipeDto & { image: RecipeImage | null });` — el `await` implícito de `return this.repository.create(...)` es exactamentente "el `await` de `repository.create(...)`" que cita `design.md` 12.5.2 paso 3 como el momento exacto después del cual debe dispararse el tracking.
- **Cambio propuesto:** dejar de retornar directamente el resultado de `repository.create`; capturarlo en una variable, invocar el tracking inmediatamente después (si el `image` resuelto no es `null`), actualizar `tracking.status` con una segunda escritura suelta, y **recién ahí** retornar — pasando el resultado por `toPublicRecipeImage` (12.3 de este documento) antes de responder al cliente:
  ```ts
  // apps/api/src/modules/recipe/recipe.service.ts, reemplazo de la línea 38 en adelante:
  const created = await this.repository.create({ ...data, image } as CreateRecipeDto & { image: RecipeImage | null });
  if (image) {
    const trackingResult = await this.unsplash.trackDownload(created.id, image.tracking.trackingUrl, image.providerPhotoId);
    await this.repository.updateImageTracking(created.id, trackingResult); // ver 12.2.3 para este método nuevo
  }
  return toPublicRecipeImage.applyTo(created); // ver 12.3 — forma exacta a definir ahí
  ```
  (Pseudocódigo de orientación, no firma cerrada — el implementer decide el nombre exacto de los métodos nuevos de `RecipeRepository`, documentados como necesarios en 12.2.3.)
- **Dependencia nueva de `RecipeRepository` en `RecipeService`:** hoy `RecipeService` sólo inyecta `RecipeRepository` y `UnsplashService` (líneas 14-17) — no hace falta ningún provider nuevo, sólo un método nuevo en `RecipeRepository` (12.2.3).

#### 12.2.2 Camino de plan: `PlansService.validateAndPersistPlan`/`updatePlan` + `PlansRepository`

**Hallazgo central, verificado por lectura directa de `plans.repository.ts` (contenido completo ya leído arriba, 428 líneas):**

- `createPlanTransaction` (líneas 204-240) **retorna únicamente `plan.id`** (línea 238: `return plan.id;`) — nunca los ids de las recetas que `createDaysMealsAndRecipes` acaba de crear dentro de la misma transacción (línea 129 de `createDaysMealsAndRecipes`: `const recipe = await tx.recipe.create({ data: recipeData }); recipeId = recipe.id;` — ese `recipe.id` se usa sólo localmente, para `plannedMeal.recipeId`, línea 139, y nunca se propaga hacia arriba).
- `updatePlanTransaction` (líneas 282-350) tiene el mismo problema: retorna sólo `newPlan.id` (línea 348).
- **Confirmado además:** en `plans.service.ts`, ninguno de los dos call sites captura el valor de retorno hoy — `await this.repository.createPlanTransaction(userId, weekStart, daysForPersistence, generationRunId);` (línea 215) y `await this.repository.updatePlanTransaction(userId, weekStart, daysForPersistence, run.id);` (línea 323) son ambos sentencias `await` sueltas, sin asignar a ninguna variable.

**Esto significa que, tal como está el código hoy, `PlansService` no tiene forma de saber qué `recipeId` le corresponde a cada `image` resuelto del batch una vez que la transacción ya comiteó** — el único lugar donde existe esa asociación (`recipeId` real de base de datos ↔ `image` con su `tracking.trackingUrl`) es dentro de `createDaysMealsAndRecipes`, en el momento mismo de `tx.recipe.create`. Esta es la pieza de plomería que falta y que `design.md` 12.5.2 asume resuelta sin especificar cómo.

**Cambio propuesto (decisión de implementación, no de diseño — documentado para que no sea una sorpresa en rojo):**

1. **`createDaysMealsAndRecipes`** (líneas 85-144) — acumular, durante el mismo loop que ya recorre `day.meals` (línea 97), un array nuevo `recipesForTracking: Array<{ recipeId: string; image: PersistedRecipeImage }>` — empujar un elemento cada vez que `recipeImage` (línea 124, hoy sólo usado para `recipeData.image = recipeImage`) no es `null`/`undefined`, usando el `recipe.id` recién obtenido en la línea 130. Esto es **dato plano dentro de la misma transacción, sin ningún I/O adicional** — no viola D2, es sólo recolectar valores que ya existen en memoria en ese punto del loop.
2. **`createDaysMealsAndRecipes` debe retornar `recipesForTracking`** (hoy no retorna nada — `Promise<void>` implícito).
3. **`createPlanTransaction`** (línea 224, `await this.createDaysMealsAndRecipes(tx, plan.id, generatedDays, generationRunId, recipeOrigin);`) — capturar el retorno, y la función completa pasa de `return plan.id;` (línea 238) a `return { planId: plan.id, recipesForTracking };`.
4. **`updatePlanTransaction`** (línea 340, mismo patrón) — mismo cambio: de `return newPlan.id;` (línea 348) a `return { planId: newPlan.id, recipesForTracking };`.
5. **`plans.service.ts` líneas 215 y 323** — pasar de `await this.repository.createPlanTransaction(...)` suelto a `const { recipesForTracking } = await this.repository.createPlanTransaction(...)` (mismo patrón para `updatePlanTransaction`), e inmediatamente después, **todavía dentro de `validateAndPersistPlan`/`updatePlan`, fuera de cualquier `$transaction`** (el `try/catch` de las líneas 214-233/322-335 ya cerró en ese punto), invocar el tracking con concurrencia acotada reutilizando `resolveWithBoundedConcurrency` (ya exportado desde `unsplash.service.ts`, línea 16 hoy) sobre `recipesForTracking`, y por cada resultado, una escritura suelta de actualización de `tracking.status` (12.2.3).
6. **No rompe `AC14`/`plans-transaction-no-network.spec.ts`:** el nuevo array `recipesForTracking` es dato plano acumulado dentro del callback de `$transaction` — ningún código nuevo de `plans.repository.ts` importa ni referencia a `UnsplashService`/`unsplash.service.ts` (el guard estático de `plans-transaction-no-network.spec.ts`, ya leído arriba, sigue pasando sin cambios porque sigue sin existir ningún `unsplash` en el texto del archivo). El tracking en sí (el `fetch` real) ocurre enteramente en `plans.service.ts`, después de que `createPlanTransaction`/`updatePlanTransaction` ya retornaron.

**Dónde exactamente, línea por línea, en `plans.service.ts`:**
- **`validateAndPersistPlan`:** entre la línea 215 (ahora `const { recipesForTracking } = await this.repository.createPlanTransaction(...)`) y la línea 234 (`return this.getPlanByWeek(userId, dto.weekStart);`) — insertar el loop de tracking con concurrencia acotada, todavía dentro del mismo `try` o inmediatamente después de su cierre (el `catch` de las líneas 216-233 sólo cubre errores de la transacción en sí; un fallo del tracking nunca debe transicionar el `GenerationRun` a `FAILED`, así que el tracking debe quedar **fuera** de ese `try/catch`, después de su cierre en la línea 233).
- **`updatePlan`:** mismo patrón, entre la línea 323 (ahora `const { recipesForTracking } = await this.repository.updatePlanTransaction(...)`) y la línea 337 (`return this.getPlanByWeek(userId, dto.weekStart);`), fuera del `try/catch` de las líneas 322-335.
- Ambos call sites terminan igual (`return this.getPlanByWeek(...)`) — `getPlanByWeek` debe aplicar el filtrado de DTO público (12.3 de este documento) sobre lo que lee de vuelta de la base, que ya va a incluir el `tracking.status` actualizado por la segunda escritura.

#### 12.2.3 Métodos nuevos de repositorio necesarios para 12.2.1/12.2.2

- **`RecipeRepository`** (`apps/api/src/modules/recipe/recipe.repository.ts`): método nuevo, ej. `async updateImageTracking(recipeId: string, tracking: UnsplashTrackingMetadata): Promise<void>` — `prisma.recipe.update({ where: { id: recipeId }, data: { image: { ...valor actual, tracking } } })`. **Cuidado real a documentar:** un `prisma.recipe.update` con `data: { image: {...} }` sobre una columna `Json` **reemplaza el JSON completo**, no hace un merge parcial — el método necesita leer el `image` actual (ya lo tiene disponible como parámetro si se le pasa el objeto `RecipeImage`/`PersistedRecipeImage` completo en vez de sólo el `tracking`) o reconstruir el objeto completo antes de escribir, para no perder los 9 campos públicos en la escritura. Firma más segura: `updateImageTracking(recipeId: string, fullImage: PersistedRecipeImage): Promise<void>` (recibe el objeto completo ya armado con el `tracking` actualizado, no fragmentos).
- **`PlansRepository`**: método nuevo equivalente, mismo cuidado de reemplazo completo del JSON, ej. `async updateRecipeImageTracking(recipeId: string, fullImage: PersistedRecipeImage): Promise<void>` — **fuera de cualquier `$transaction`** (`this.prisma.recipe.update(...)` directo, no `tx.recipe.update(...)`), llamado desde `plans.service.ts` en el loop de 12.2.2 punto 5. Este método tampoco referencia `UnsplashService` — sigue siendo dato plano, no rompe el guard de AC14.

### 12.3 Filtrado de DTO público (`toPublicRecipeImage`, `design.md` 12.5.1) — línea exacta de cada punto de lectura

**Archivo nuevo propuesto:** `apps/api/src/modules/unsplash/to-public-recipe-image.util.ts` — función pura, mismo criterio que `unsplash-query.util.ts`/`unsplash-candidate-selector.util.ts` (sin Nest, sin Prisma), exportando `toPublicRecipeImage(persisted: PersistedRecipeImage | null): RecipeImage | null` con la forma exacta de `design.md` 12.5.1 (lista blanca explícita de los 9 campos, no *spread*+destructuring — `design.md` 12.5.1 documenta las dos formas como válidas pero marca la lista blanca explícita como "la preferida"). Spec nuevo: `apps/api/src/modules/unsplash/to-public-recipe-image.util.spec.ts`.

**Puntos de lectura reales que hoy devuelven `image` crudo (verificados por lectura directa, no asumidos):**

1. **`RecipeService.create`** (`apps/api/src/modules/recipe/recipe.service.ts`, línea 38 hoy) — devuelve directamente lo que resuelve `repository.create(...)` (el modelo `Recipe` completo de Prisma, incluyendo `image` con `tracking` sin filtrar). Ver 12.2.1 para el cambio completo del método; el filtrado se aplica al final, justo antes del `return`.
2. **`RecipeService.findAll`** (líneas 41-53) — `return this.repository.findAll({...});` retorna `PaginatedRecipes` (`items: Recipe[]`, `recipe.repository.ts` línea 16) sin ningún mapeo. **Cambio necesario:** mapear `result.items` aplicando `toPublicRecipeImage` a `item.image` de cada uno, antes de retornar — ej. `const result = await this.repository.findAll({...}); return { ...result, items: result.items.map(item => ({ ...item, image: toPublicRecipeImage(item.image as PersistedRecipeImage | null) })) };`.
3. **`RecipeService.findById`** (líneas 55-61) — `const recipe = await this.repository.findById(id); ... return recipe;` (línea 60) retorna el modelo completo sin mapeo. **Cambio necesario:** `return { ...recipe, image: toPublicRecipeImage(recipe.image as PersistedRecipeImage | null) };` antes del `return recipe;` de la línea 60.
4. **`RecipeRepository.findAll`** (`apps/api/src/modules/recipe/recipe.repository.ts`, líneas 44-61, `$queryRaw`) — **confirmado, `design.md` 12.5.1 ya lo documenta así:** la columna `"image"` ya está en la lista de columnas del `SELECT` (línea 49, confirmado por lectura directa — ya incluye `"image"` entre `"properties"` y `"createdAt"`) y **se mantiene sin cambios**: el filtrado se hace en `RecipeService.findAll` (punto 2 arriba), no acá, por el razonamiento explícito de `design.md` 12.5.1 (no duplicar la lista de campos públicos en SQL a mano).
5. **`RecipeRepository.findById`** (líneas 107-111, `prisma.recipe.findUnique`) — modelo completo, incluye `image` crudo automáticamente. **Sin cambios necesarios en el repositorio** — el filtrado ocurre en `RecipeService.findById` (punto 3 arriba).
6. **Hallazgo no pedido explícitamente por `design.md` 12.5.1 pero real por el mismo patrón — `RecipeService.update`** (líneas 63-66) y **`RecipeService.delete`** (líneas 68-71): ambos retornan directamente `this.repository.update(...)`/`this.repository.delete(...)`, que a su vez retornan el modelo `Recipe` completo de Prisma (`recipe.repository.ts` líneas 119-128 y 130-134) — **también exponen `image` crudo sin filtrar**, aunque `design.md` 12.5.1 sólo menciona explícitamente "la respuesta de `POST /recipes`, `GET /recipes`... `GET /recipes/:id`" (los 3 verbos que el ticket original cubre). `PATCH /recipes/:id` (`update`) y `DELETE /recipes/:id` (`delete`, que retorna la fila borrada) no están en esa lista pero tienen el mismo problema de fuga potencial si alguna vez el JSON de `image` trae `tracking`. **Se deja documentado como gap a decidir por el tester/implementer/TL, no como AC obligatoria de esta revisión** (no está en las 20 historias de `design.md` 12.8) — pero aplicar el mismo `toPublicRecipeImage` ahí también es consistente y barato de hacer en el mismo ciclo si se decide cerrarlo.
7. **`RecipeController`** (`apps/api/src/modules/recipe/recipe.controller.ts`, las 5 rutas, líneas 13-36) — confirmado por lectura directa: el controller nunca transforma la respuesta de `RecipeService`, sólo delega (`return await this.recipeService.xxx(...)`) — consistente con el test existente `recipe.controller.spec.ts:34` ("delegates the validated query exactly once and returns its paginated response unchanged"). **El filtrado nunca debe vivir en el controller** — reafirma que 1-3 arriba (capa de servicio) son los puntos correctos.
8. **`PlansRepository.findPlanByWeek`** (`apps/api/src/modules/plans/plans.repository.ts`, líneas 17-31) — `include: { days: { include: { meals: { include: { recipe: true } } } } }` trae el modelo `Recipe` completo (con `image` crudo) embebido en cada `meal.recipe`. **Único choke point real para todas las respuestas de plan:** `PlansService.getPlanByWeek` (líneas 340-346) es el **único** método que llama a `findPlanByWeek`, y es llamado, directa o indirectamente, por **los 4 endpoints de plan que devuelven una receta embebida**:
   - `POST /meal-plans/generate` (`generatePlan`, `plans.controller.ts` línea 15) → `generateAndPersistPlan` → termina en `return this.validateAndPersistPlan(...)` (línea 156) → `validateAndPersistPlan` termina en `return this.getPlanByWeek(...)` (línea 234). También puede retornar antes, en la línea 93 (`return this.getPlanByWeek(userId, weekStartStr);`, camino de idempotencia) o en la línea 128 (mismo método, camino de recuperación de run) — **los 3 puntos de retorno de `generateAndPersistPlan`/`validateAndPersistPlan` terminan en `getPlanByWeek`**.
   - `POST /meal-plans` (`createPlan`, línea 22) → `validateAndPersistPlan` sin `generationRunId` → mismo final, línea 234.
   - `GET /meal-plans/current` (`getCurrentPlan`, línea 28) → `getPlanByWeek` directo.
   - `PUT /meal-plans` (`updatePlan`, línea 34) → `updatePlan` → termina en `return this.getPlanByWeek(...)` (línea 337), o antes en la línea 303 (camino de idempotencia).
   **Cambio necesario, en un único lugar:** `PlansService.getPlanByWeek` (líneas 340-346) — antes de `return plan;` (línea 345), mapear `plan.days[].meals[].recipe.image` con `toPublicRecipeImage` sobre una copia (no mutar `plan` in-place, mismo criterio ya usado en `buildOutputSnapshot` de `plans.repository.ts` líneas 262-275 para no mutar los `days` originales). Un único fix acá cubre los 4 endpoints — no hace falta tocar `plans.controller.ts` ni duplicar el mapeo en cada call site.
9. **`deletePlan`** (`plans.service.ts` líneas 237-251) — también llama a `getPlanByWeek` (línea 239), pero sólo para extraer `recipeIds` (líneas 242-247) antes de borrar — su propio `return` (línea 250) es el resultado de `deletePlanTransaction`, no el plan con recetas embebidas. **No necesita el filtrado** (no expone `image` en su respuesta), pero sí se beneficia transitivamente de que `getPlanByWeek` esté filtrada (no afecta su lógica, que sólo lee `recipeId`, no `image`).

### 12.4 El mecanismo de recuperación

**Patrón real confirmado de `apps/api/prisma/seed.ts` (contenido completo ya leído, 213 líneas) — cómo arma su conexión:**
```ts
// líneas 1-13: imports relativos, nunca alias "@/" — el script vive en apps/api/prisma/, fuera
// del árbol que cubre tsconfig.json (baseUrl "./src", include "src/**/*.ts") y de jest.config.js
// (rootDir: 'src'). Los imports hacia código de apps/api/src/ son SIEMPRE relativos
// ('../src/generated/prisma/client', '../src/prisma/seed-data'), nunca '@/...'.
import { PrismaClient, ... } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();
import { seedBaseData } from '../src/prisma/seed-data';

// líneas 27-33: construcción manual del cliente con el adapter de pg (no `new PrismaClient()` a
// secas) — mismo patrón a replicar exactamente, no uno nuevo.
function getPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  return { prisma, pool };
}

// líneas 35-37, 201-208: main() con try/finally (disconnect) + catch final que hace process.exit
async function main() {
  const { prisma, pool } = getPrismaClient();
  try {
    // ... lógica real delegada a funciones importadas de src/, nunca escrita inline ...
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { /* ... */ });
```

**Hallazgo clave sobre testabilidad (por qué `seed.ts` en sí nunca tiene un `.spec.ts` propio):** `jest.config.js` (`rootDir: 'src'`, `testRegex: '.*\\.spec\\.ts$'`) sólo descubre specs **dentro de `apps/api/src/`** — `apps/api/prisma/seed.ts` queda fuera del alcance de Jest por construcción. Lo que sí se testea es `seedBaseData` (la lógica real), que vive en `apps/api/src/prisma/seed-data.ts` y se testea en `apps/api/src/prisma/tests/seed.spec.ts` (ya leído completo) **pasándole un objeto `mockClient` plano como su parámetro `prisma`** (`seedBaseData(mockClient)`, línea 65 del spec) — nunca instanciando `PrismaClient` real ni mockeando el módulo `@prisma/client`. Mismo patrón a replicar al pie de la letra para la recuperación: lógica testeable separada del script ejecutable.

**Estructura propuesta para NUT-83 (dos archivos nuevos, ninguno existe hoy):**

1. **Lógica testeable:** `apps/api/src/modules/unsplash/unsplash-recovery.util.ts` (dentro de `src/`, cubierto por `tsconfig.json`/`jest.config.js`, puede usar el alias `@/` libremente si hiciera falta importar otra cosa del árbol de Nest/Prisma-types). Exporta una función, ej.:
   ```ts
   export async function recoverUnsplashTracking(
     prisma: { recipe: { findMany: Function; update: Function } }, // tipado mínimo, mockeable
     options?: { limit?: number },
   ): Promise<{ found: number; succeeded: number; failed: string[] }> {
     // paso 1 de design.md 12.6: prisma.recipe.findMany({ where: { OR: [...PENDING, ...FAILED] }, take: limit ?? 50, orderBy: { createdAt: 'asc' } })
     // paso 2: por cada receta, concurrencia acotada (reutilizar resolveWithBoundedConcurrency de unsplash.service.ts),
     //         revalidar con isValidUnsplashUrl(trackingUrl, UNSPLASH_API_HOST) (12.1.2) antes de cada fetch
     // paso 3: prisma.recipe.update(...) suelto por receta (igual que 12.2.3)
     // retorna el resumen para que el script lo imprima
   }
   ```
   Esta función es la que importan tanto el script ejecutable (2) como su propio spec.
2. **Spec:** `apps/api/src/modules/unsplash/unsplash-recovery.util.spec.ts` — Prisma mockeado exactamente como `seed.spec.ts` (un objeto plano con `findMany`/`update` como `jest.fn()`, sin tocar ninguna base real), más un mock de `global.fetch` para simular las respuestas de `GET trackingUrl` (mismo patrón que `unsplash.service.spec.ts`).
3. **Script ejecutable:** `apps/api/prisma/recover-unsplash-tracking.ts` — **fuera de `src/`, no cubierto por Jest** (igual que `seed.ts`), import relativo hacia la lógica (`import { recoverUnsplashTracking } from '../src/modules/unsplash/unsplash-recovery.util';`, **no** `'@/modules/unsplash/unsplash-recovery.util'` — el alias `@/` no está garantizado fuera del árbol que cubre `tsconfig.json`/`jest.config.js`, y `seed.ts` deliberadamente nunca lo usa), mismo `getPrismaClient()` que `seed.ts` (se puede importar literalmente la función si se extrae a un helper compartido, o duplicarla — `seed.ts` no la exporta hoy, así que la opción más simple y más fiel al patrón existente es duplicar las 6 líneas de `getPrismaClient()` en el script nuevo, igual que si `seed.ts` tuviera un segundo script hermano), mismo `main()` con `try/finally`+`disconnect`+`catch` final, imprimiendo el resumen que retorna `recoverUnsplashTracking(...)` (`design.md` 12.6, "Documentación operativa para la demo", punto 2).

**Script nuevo de `package.json`** (`apps/api/package.json`, bloque `"scripts"` líneas 5-15, confirmado completo): insertar una línea nueva inmediatamente después de la línea 14 (`"prisma:seed": "npx tsx prisma/seed.ts"`), mismo patrón exacto:
```json
"unsplash:recover-tracking": "npx tsx prisma/recover-unsplash-tracking.ts"
```
(Un flag opcional de límite, mencionado en `design.md` 12.6 "Documentación operativa", puede pasarse como argumento de línea de comando estándar — `process.argv` — sin necesidad de ningún script adicional en `package.json`; queda como detalle menor de implementación.)

### 12.5 Tests — mapeo de las 20 AC de `design.md` 12.8 a archivos concretos

| AC (`design.md` §12.8) | Archivo de test | Nuevo/extender | Notas |
|---|---|---|---|
| 1 — `id` string, ruta feliz | `unsplash-candidate-selector.util.spec.ts` | Extender (reescribir fixtures, 12.1.1) | Reemplaza los casos existentes de `id` numérico. |
| 2 — `download_location` ausente invalida | `unsplash-candidate-selector.util.spec.ts` | Extender | Caso nuevo: candidato válido en todo lo demás, `links.download_location: ''` o ausente → `null`. |
| 3 — URL de dominio inválido descarta candidato | `unsplash-url-validator.util.spec.ts` (nuevo, 12.1.2) + `unsplash-candidate-selector.util.spec.ts` (integración del paso 8 del predicado) | Ambos nuevos/extender | El spec del validador prueba la función pura en aislamiento; el spec del selector prueba que el predicado completo la invoca y descarta el candidato. |
| 4 — nunca se envía `Authorization` a host no validado | `unsplash.service.spec.ts` (nuevo `describe`, método `trackDownload`) | Extender | Spy sobre `fetch`, `trackingUrl` con host corrupto, assert `fetch` nunca invocado y resultado `'FAILED'`. |
| 5 — UTM en `sourceUrl`/`photographerUrl`, `imageUrl` intacta | `unsplash.service.spec.ts` (extender el test existente de la línea 69, AC3) | Extender | Agregar `expect` sobre `utm_source`/`utm_medium` en ambas URLs y verificar `imageUrl` byte a byte igual a `urls.regular`. |
| 6 — Creación manual, secuencia completa `PENDING`→`SUCCEEDED` | `apps/api/src/modules/recipe/tests/recipe.service.spec.ts` (extender el `describe('create')`, línea 119) | Extender | Interceptar la escritura de `repository.create` para capturar el `image` con `tracking.status === 'PENDING'` en ese instante, luego assert `SUCCEEDED` al final del método. |
| 7 — Plan, secuencia completa con concurrencia 3 | `apps/api/src/modules/plans/tests/plans.service.spec.ts` (nuevo `describe`) | Nuevo | N recetas, assert que el tracking se dispara después del `await` de `createPlanTransaction`/`updatePlanTransaction`, concurrencia acotada (reutilizar el patrón de `unsplash-concurrency.spec.ts`). |
| 8 — Ninguna llamada externa dentro de `$transaction`, extendido a tracking | `plans-transaction-no-network.spec.ts` (ya existe, sigue pasando sin cambios — ver 12.2.2 punto 6) | Sin cambios | El guard estático (`not.toMatch(/unsplash/i)`) ya cubre esto estructuralmente; no necesita un AC nuevo si el tracking se implementa en `plans.service.ts` como documenta 12.2. |
| 9 — Tracking fallido conserva receta e imagen | `unsplash.service.spec.ts` (ya existe un `describe` similar, línea 512 — "a failed tracking call never affects resolveImage's own result") | Extender/adaptar a la nueva firma de `trackDownload` (12.1.3.b, ya no `void`, ahora retorna `'FAILED'`) | |
| 10 — Recuperación procesa sólo `PENDING`/`FAILED` | `unsplash-recovery.util.spec.ts` (nuevo, 12.4) | Nuevo | Mock de `findMany` con las 3 filas de ejemplo (`PENDING`/`SUCCEEDED`/`FAILED`); assert que sólo se pasa el filtro correcto a `findMany` (`where.OR`) y que `fetch` se llama exactamente `PENDING`+`FAILED` veces. |
| 11 — Recuperación segura de correr 2 veces | `unsplash-recovery.util.spec.ts` | Nuevo | Dos invocaciones de `recoverUnsplashTracking` con el mismo `mockClient`; la segunda no debe incluir en su resumen la fila que la primera dejó `SUCCEEDED` (el mock de `findMany` debe reflejar el cambio de estado entre invocaciones). |
| 12 — Metadata privada nunca sale en DTO público | `recipe.service.spec.ts` (nuevo `it`, `describe('findById')`/`describe('findAll')`/`describe('create')`) + `plans.service.spec.ts` (nuevo `it`, sobre `getPlanByWeek`) + `to-public-recipe-image.util.spec.ts` (nuevo, prueba la función pura en aislamiento) | Nuevo/extender | El test de la función pura (lista blanca exacta de claves) es el más barato y fuerte; los de `recipe.service.spec.ts`/`plans.service.spec.ts` confirman que de verdad se invoca en cada punto de lectura (12.3). |
| 13 — Metadata privada nunca en logs/snapshots | `unsplash.service.spec.ts` (extender `assertApiKeyNeverLeaked` o un helper hermano) + `plans.repository.spec.ts` (extender el `describe` de `buildOutputSnapshot`, líneas 636+, ya leído arriba) | Extender | `plans.repository.spec.ts` ya prueba que `image` no está en el snapshot en absoluto (líneas 670-671) — alcanza con confirmar que sigue pasando sin cambios tras agregar `tracking` al JSON, no hace falta un test nuevo ahí salvo para reforzar explícitamente. |
| 14 — 401/403, mensaje específico | `unsplash.service.spec.ts` (ya existen tests de 401/403, líneas 219/241 — "returns null... logs a warning mentioning status 401/403") | Extender | Ajustar el `expect` del mensaje para que pida el texto específico ("configuración de Unsplash inválida") en vez de sólo mencionar el status. |
| 15 — Cuota agotada no dispara más búsquedas | `unsplash.service.spec.ts` (nuevo `describe`) | Nuevo | Simular una respuesta con `X-Ratelimit-Remaining: 0`, luego una segunda llamada a `resolveImage`/`searchAndSelectCandidate` en la misma instancia de `UnsplashService`; assert `fetch` no se invoca la segunda vez. |
| 16 — Parámetros/normalización revalidados con ids string | `unsplash.service.spec.ts` (test existente línea 69, AC3) | Extender | Ya cubierto en su mayor parte (`order_by`/`content_filter` ya se testean, confirmado por el test de la línea 69) — sólo actualizar los fixtures a `id` string (12.1.1). |
| 17 — Mapeo DTO completo y alt fallback revalidado | `unsplash.service.spec.ts` (tests existentes líneas 109/125, ya cubren el fallback) | Extender | Agregar aserción de `providerPhotoId` como string exacto del fixture. |
| 18 — Imagen estable en lecturas, a nivel de contrato público | `recipe.service.spec.ts`/`plans.service.spec.ts` (mismo test que AC12) | Cubierto por 12 | No necesita un test separado — "dos lecturas devuelven lo mismo" es una consecuencia directa de que `toPublicRecipeImage` sea una función pura determinística, ya cubierta por su propio spec. |
| 19 — Receta reutilizada no re-busca ni re-trackea | `plans.service.spec.ts` (verificar si ya existe un test equivalente para NUT-75/NUT-83; si no, nuevo) | Nuevo o ya cubierto | A verificar en el ciclo de tester: buscar primero si algún test de `attachImages`/batch ya cubre "receta sin `meal.recipe`" (el guard `if (meal.recipe)` de `plans.repository.ts` línea 100 y de `unsplash.service.ts` línea 203 ya existen) antes de escribir uno nuevo. |
| 20 — Trazabilidad (cubierta por 9/10/11) | — | — | Sin archivo propio, `design.md` 12.8 lo dice explícitamente. |

### 12.6 Orden de trabajo sugerido para el ciclo tester → implementer

**Recomendación: cuatro ciclos, en el orden A → D → B → C (no el orden literal A-B-C-D sugerido como ejemplo) — razonamiento de dependencias real, verificado contra el código:**

- **Ciclo A — candidato/URL/UTM (fixes #1-#4 de `design.md` 12.1):** 12.1.1 (`unsplash-candidate-selector.util.ts`, tipo `id`/`download_location`/paso 8 del predicado), 12.1.2 (`unsplash-url-validator.util.ts` nuevo), 12.1.3.a (UTM en `buildRecipeImage`). Todo esto son cambios aislados sobre funciones puras o sobre el método `buildRecipeImage` existente (no toca `resolveCandidate`/el split de 12.1.3.b) — es el trabajo con menos riesgo estructural y el más rápido de dejar en verde.
- **Ciclo D (se adelanta) — cuota/401-403 (fixes #6-#7 de `design.md` 12.1):** 12.1.3.c (`quotaRemaining`) y 12.1.3.d (401/403) — **ambos viven dentro del método `resolveCandidate` actual** (líneas 70-140 de `unsplash.service.ts`, antes de que 12.1.3.b lo divida en dos). Razonamiento para adelantarlo respecto del orden sugerido por la tarea: si el split de responsabilidades (Ciclo B) se hace primero, D tendría que decidir en qué mitad de la función dividida insertar cada guard (ambos van en la mitad de "búsqueda", no en la de "tracking", pero es una decisión extra que no hace falta tomar si D se resuelve sobre la función todavía unificada). Haciendo D antes que B, el split de B hereda estos guards ya escritos y sólo tiene que preservarlos al mover código, en vez de escribirlos de cero sobre una función ya partida.
- **Ciclo B — arquitectura de tracking post-persistencia + filtrado de DTO (fix #5 y #8 de `design.md` 12.1):** 12.1.3.b (split de `resolveCandidate`), 12.2 completo (plomería de `recipesForTracking` en `plans.repository.ts`, integración en `recipe.service.ts`/`plans.service.ts`), 12.3 completo (`toPublicRecipeImage` y sus 9 puntos de lectura). Es, con diferencia, el ciclo de mayor riesgo real (cambia la forma de retorno de `createPlanTransaction`/`updatePlanTransaction`, un contrato interno que otros tests ya ejercitan — ver 12.2.2 punto 3-4) y debe hacerse **después** de A/D para no mezclar un refactor estructural grande con fixes puntuales de bajo riesgo en el mismo diff.
- **Ciclo C — mecanismo de recuperación (12.6 de `design.md`):** 12.4 completo (`unsplash-recovery.util.ts` + script + `package.json`). Depende **estructuralmente** de B: la query de recuperación (`image: { path: ['tracking', 'status'], equals: 'PENDING' } }`) sólo tiene sentido una vez que `tracking.status` existe de verdad en filas persistidas, y depende de A para reutilizar `isValidUnsplashUrl`. Debe ir última.

---

Generado (sección 12): 2026-10-01T18:56:25.283Z (`node -e "console.log(new Date().toISOString())"`, hora real del sistema al momento de escribir esta sección).
