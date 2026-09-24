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

  // Gap documentado explícitamente (design.md sección 4, AC6; plan.md sección 10, fila AC6):
  // el comportamiento real de cascada de Postgres (que al borrar un GenerationRun, las filas de
  // Recipe/MealPlan que lo referencian sobrevivan con generationRunId = null) NO se puede probar
  // sin una base de datos real. Este archivo cubre únicamente el nivel de esquema/SQL (que la
  // migración y el schema.prisma *declaran* la intención ON DELETE SET NULL correctamente), no
  // el comportamiento en runtime contra una base — no hay hoy en este repo ningún harness de
  // integración contra Postgres real (todo lo llamado "integration" en los specs de `plans`
  // mockea Prisma), y esta sesión tiene explícitamente prohibido usar cualquier base real.
});
