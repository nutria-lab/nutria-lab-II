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
