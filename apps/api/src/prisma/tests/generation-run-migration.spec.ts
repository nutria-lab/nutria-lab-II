import * as fs from 'fs';
import * as path from 'path';

/**
 * NUT-75 — AC1 (backfill) y AC6 (onDelete SetNull) a nivel de esquema/migración.
 *
 * Sigue el mismo patrón exacto de `nutrition-profile-migration.spec.ts`: lee el `migration.sql`
 * real y los `.prisma` reales con `fs.readFileSync` y hace `toContain`/`toMatch` sobre el texto.
 * No se ejecuta ningún comando de Prisma ni se toca ninguna base de datos (ni local ni remota).
 */
describe('GenerationRun Schema & Migration Tests (NUT-75 AC1/AC6 Verification)', () => {
  const prismaDir = path.resolve(__dirname, '../../../prisma');
  const migrationFile = path.resolve(
    prismaDir,
    'migrations/20260922204917_add_generation_run_and_meal_plan_versioning/migration.sql',
  );
  const recipeModelFile = path.resolve(prismaDir, 'models/recipe.prisma');
  const mealPlanModelFile = path.resolve(prismaDir, 'models/mealPlan.prisma');
  const generationRunModelFile = path.resolve(prismaDir, 'models/generationRun.prisma');

  describe('Migration SQL inspection', () => {
    let migrationSql: string;

    beforeAll(() => {
      expect(fs.existsSync(migrationFile)).toBe(true);
      migrationSql = fs.readFileSync(migrationFile, 'utf-8');
    });

    describe('AC1 - Backfill sobre datos existentes', () => {
      it('recipes.origin se agrega con DEFAULT MANUAL (toda fila existente queda backfillada)', () => {
        expect(migrationSql).toContain(
          'ADD COLUMN "origin" "RecipeOrigin" NOT NULL DEFAULT \'MANUAL\'',
        );
      });

      it('meal_plans.version se agrega con DEFAULT 1 (toda fila existente queda backfillada)', () => {
        expect(migrationSql).toContain(
          'ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1',
        );
      });

      it('meal_plans.isCurrent se agrega con DEFAULT true (toda fila existente queda backfillada)', () => {
        expect(migrationSql).toContain(
          'ADD COLUMN "isCurrent" BOOLEAN NOT NULL DEFAULT true',
        );
      });

      it('es aditiva/no destructiva: no contiene DROP TABLE, DROP COLUMN ni TRUNCATE', () => {
        expect(migrationSql.toUpperCase()).not.toContain('DROP TABLE');
        expect(migrationSql.toUpperCase()).not.toContain('DROP COLUMN');
        expect(migrationSql.toUpperCase()).not.toContain('TRUNCATE');
      });

      it('sí contiene DROP INDEX (esperado: sustituye la unicidad simple vieja por el índice único parcial nuevo, no es destructivo de datos)', () => {
        // Nota explícita (design.md sección 5.6 / plan.md sección 3): esta migración dropea
        // "meal_plans_userId_startDate_key" porque esa unicidad simple queda reemplazada por el
        // índice único parcial "meal_plans_user_week_current_key" (WHERE isCurrent = true) que
        // se crea más abajo en el mismo script. Dropear un índice no borra filas ni columnas —
        // es la razón por la que esta aserción es positiva (toContain) y no viola la regla de
        // "no destructivo de datos" verificada arriba.
        expect(migrationSql).toContain('DROP INDEX "meal_plans_userId_startDate_key"');
      });
    });

    describe('AC6 - onDelete SetNull conserva Recipe/MealPlan a nivel de FK', () => {
      it('recipes_generationRunId_fkey usa ON DELETE SET NULL', () => {
        expect(migrationSql).toMatch(
          /ALTER TABLE "recipes" ADD CONSTRAINT "recipes_generationRunId_fkey"[\s\S]*?ON DELETE SET NULL ON UPDATE CASCADE;/,
        );
      });

      it('meal_plans_generationRunId_fkey usa ON DELETE SET NULL', () => {
        expect(migrationSql).toMatch(
          /ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_generationRunId_fkey"[\s\S]*?ON DELETE SET NULL ON UPDATE CASCADE;/,
        );
      });
    });
  });

  describe('AC6 - Prisma model definitions declaran onDelete: SetNull', () => {
    it('recipe.prisma: la relación generationRun usa onDelete: SetNull', () => {
      expect(fs.existsSync(recipeModelFile)).toBe(true);
      const content = fs.readFileSync(recipeModelFile, 'utf-8');

      expect(content).toContain('model Recipe');
      expect(content).toMatch(
        /generationRun\s+GenerationRun\?\s+@relation\(fields:\s*\[generationRunId\],\s*references:\s*\[id\],\s*onDelete:\s*SetNull\)/,
      );
    });

    it('mealPlan.prisma: la relación generationRun usa onDelete: SetNull', () => {
      expect(fs.existsSync(mealPlanModelFile)).toBe(true);
      const content = fs.readFileSync(mealPlanModelFile, 'utf-8');

      expect(content).toContain('model MealPlan');
      expect(content).toMatch(
        /generationRun\s+GenerationRun\?\s+@relation\(fields:\s*\[generationRunId\],\s*references:\s*\[id\],\s*onDelete:\s*SetNull\)/,
      );
    });
  });

  /**
   * NUT-75 — Bug 2 (BLOQUEANTE, revisión externa de PR): `.ai/ai-generation-safety.md` exige
   * "Recoverable failure state with a clear retry path". Hoy el
   * `@@unique([userId, kind, idempotencyKeyHash])` de `GenerationRun` (`generationRun.prisma`)
   * hace que, una vez que un run llega a `FAILED`/`REJECTED`, CUALQUIER reintento futuro con el
   * mismo contenido de solicitud choque para siempre contra ese run terminal (vía el catch de
   * `P2002` en `createOrRecoverGenerationRun`), y `assertRecoveredRunIsUsable`
   * (`plans.service.ts`) lo rechaza con `ConflictException` sin posibilidad real de reintentar.
   *
   * Corrección de diseño ya decidida (no se reinventa acá, sólo se prueba en rojo contra el
   * contenido actual/viejo de los archivos, que NO se tocan en esta etapa): reemplazar el
   * `@@unique` por un `@@index` simple en `generationRun.prisma`, y mover la unicidad real a un
   * índice único PARCIAL en `migration.sql`:
   * `WHERE status NOT IN ('FAILED', 'REJECTED', 'EXPIRED')` sobre
   * `("userId", "kind", "idempotencyKeyHash")` — mismo patrón que ya usa este ticket para
   * `meal_plans_user_week_current_key`. Un run `SUCCEEDED`/`CONFIRMED`/`PENDING`/
   * `READY_FOR_REVIEW` sigue deduplicando; un run `FAILED`/`REJECTED`/`EXPIRED` deja de
   * "ocupar" el hash y un reintento idéntico simplemente inserta un `GenerationRun` nuevo.
   */
  describe('Bug 2 (BLOQUEANTE) - unicidad de idempotencia debe ser PARCIAL (excluir FAILED/REJECTED/EXPIRED), no total', () => {
    let migrationSql: string;

    beforeAll(() => {
      expect(fs.existsSync(migrationFile)).toBe(true);
      migrationSql = fs.readFileSync(migrationFile, 'utf-8');
    });

    it('migration.sql contiene un índice único PARCIAL sobre generation_runs("userId","kind","idempotencyKeyHash") que excluye FAILED, REJECTED y EXPIRED', () => {
      expect(migrationSql).toMatch(
        /CREATE UNIQUE INDEX "generation_runs_userId_kind_idempotencyKeyHash_key"\s+ON\s+"generation_runs"\("userId",\s*"kind",\s*"idempotencyKeyHash"\)\s+WHERE\s+"status"\s+NOT IN\s*\(\s*'FAILED'\s*,\s*'REJECTED'\s*,\s*'EXPIRED'\s*\)/i,
      );
    });

    it('migration.sql ya NO contiene un índice único simple (sin WHERE) sobre esas mismas 3 columnas', () => {
      const uniqueIndexStatementMatch = migrationSql.match(
        /CREATE UNIQUE INDEX "generation_runs_userId_kind_idempotencyKeyHash_key"[^;]*;/,
      );

      expect(uniqueIndexStatementMatch).not.toBeNull();
      // El statement completo del índice único sobre estas columnas debe traer una cláusula
      // WHERE (parcial) — si no la trae, es el índice único TOTAL viejo, exactamente lo que
      // bloquea reintentos para siempre (Bug 2).
      expect(uniqueIndexStatementMatch![0]).toMatch(/WHERE/i);
    });

    it('generationRun.prisma NO declara @@unique([userId, kind, idempotencyKeyHash]) (debe ser un @@index no único en su lugar)', () => {
      expect(fs.existsSync(generationRunModelFile)).toBe(true);
      const content = fs.readFileSync(generationRunModelFile, 'utf-8');

      expect(content).toContain('model GenerationRun');
      expect(content).not.toMatch(
        /@@unique\(\[\s*userId\s*,\s*kind\s*,\s*idempotencyKeyHash\s*\]\)/,
      );
      expect(content).toMatch(
        /@@index\(\[\s*userId\s*,\s*kind\s*,\s*idempotencyKeyHash\s*\]\)/,
      );
    });
  });

  // Gap documentado explícitamente (design.md sección 4, AC6; plan.md sección 10, fila AC6):
  // el comportamiento real de cascada de Postgres (que al borrar un GenerationRun, las filas de
  // Recipe/MealPlan que lo referencian sobrevivan con generationRunId = null) NO se puede probar
  // sin una base de datos real. Este archivo cubre únicamente el nivel de esquema/SQL (que la
  // migración y el schema.prisma *declaran* la intención ON DELETE SET NULL correctamente), no
  // el comportamiento en runtime contra una base — no hay hoy en este repo ningún harness de
  // integración contra Postgres real (todo lo llamado "integration" en los specs de `plans`
  // mockea Prisma), y esta sesión tiene explícitamente prohibido usar cualquier base real.
});
