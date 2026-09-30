import * as fs from 'fs';
import * as path from 'path';

/**
 * NUT-83 — AC11 (receta existente sin imagen sigue devolviendo `image: null`, sin backfill) y
 * AC16 (la migración aditiva no rompe el contrato existente de `Recipe` de NUT-61/NUT-75).
 *
 * Mismo patrón exacto que `generation-run-migration.spec.ts`: lectura de texto plano con
 * `fs.readFileSync`/`fs.readdirSync` sobre `migration.sql` y los `.prisma` reales, sin ejecutar
 * ningún comando de Prisma ni tocar ninguna base de datos (ni local ni remota).
 *
 * Corrección de revisión de PR: la migración se regeneró con `prisma migrate dev --create-only`
 * (sobre la base local de desarrollo de la usuaria, con su consentimiento explícito) en vez de
 * quedar escrita a mano, siguiendo el Commit 1 de `.ai/database-and-migrations.md`. Este archivo
 * sigue buscando la carpeta de forma DINÁMICA por patrón de nombre en vez de hardcodear el
 * timestamp exacto (`20260930220304_add_recipe_image`), para no romper si se regenera de nuevo.
 */
describe('Recipe.image — Migración y schema (NUT-83 AC11/AC16)', () => {
  const prismaDir = path.resolve(__dirname, '../../../prisma');
  const migrationsDir = path.resolve(prismaDir, 'migrations');
  const recipeModelFile = path.resolve(prismaDir, 'models/recipe.prisma');

  // Última migración conocida antes de NUT-83 (NUT-75, ya mergeada — ver plan.md sección 2).
  const BASELINE_MIGRATION = '20260922204917_add_generation_run_and_meal_plan_versioning';
  // Patrón de nombre pedido explícitamente por el prompt de esta etapa: cualquier carpeta que
  // matchee "*_add_recipe_image*" (substring, case-insensitive), sin fijar ningún timestamp.
  const MIGRATION_NAME_PATTERN = /_add_recipe_image/i;

  function findRecipeImageMigrationDir(): string | null {
    if (!fs.existsSync(migrationsDir)) {
      return null;
    }

    const candidates = fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .filter(name => MIGRATION_NAME_PATTERN.test(name))
      // El prefijo de 14 dígitos (YYYYMMDDHHMMSS) ordena cronológicamente también como string;
      // sólo nos interesan las carpetas posteriores a la última migración conocida de NUT-75.
      .filter(name => name > BASELINE_MIGRATION)
      .sort();

    return candidates.length > 0 ? candidates[0] : null;
  }

  let migrationSql: string;

  beforeAll(() => {
    const migrationDirName = findRecipeImageMigrationDir();

    if (!migrationDirName) {
      throw new Error(
        'NUT-83: no se encontró ninguna carpeta de migración que matchee el patrón ' +
          `"*_add_recipe_image*" posterior a "${BASELINE_MIGRATION}" dentro de ${migrationsDir}. ` +
          'Esta migración (design.md sección 8, "ALTER TABLE \\"recipes\\" ADD COLUMN \\"image\\" JSONB;") ' +
          'es parte del alcance de esta etapa y todavía no fue generada por el implementer ' +
          '(Commit 1 de `.ai/database-and-migrations.md`: `prisma migrate dev --create-only` sobre un ' +
          'Neon branch de desarrollo — nunca contra una base real en esta sesión de tests).',
      );
    }

    const migrationFile = path.resolve(migrationsDir, migrationDirName, 'migration.sql');
    expect(fs.existsSync(migrationFile)).toBe(true);
    migrationSql = fs.readFileSync(migrationFile, 'utf-8');
  });

  describe('AC11 - columna aditiva, nullable, sin backfill (contraste explícito con "origin", que sí tiene DEFAULT)', () => {
    // NUT-83 (regenerada con `prisma migrate dev --create-only` en vez de a mano, corrección de
    // revisión de PR): el SQL generado por la herramienta usa espacios múltiples entre
    // `ADD COLUMN` y el nombre de columna (formato propio de Prisma), no un único espacio como
    // asumía la versión escrita a mano de este archivo — \s+ en vez de un espacio literal.
    it('agrega la columna "image" de tipo JSON/JSONB a "recipes"', () => {
      expect(migrationSql).toMatch(/ALTER TABLE "recipes" ADD COLUMN\s+"image" JSONB?\s*;/);
    });

    it('NO declara NOT NULL para la columna "image" (nullable, backfill trivial: NULL para filas existentes)', () => {
      const addColumnStatement = migrationSql.match(/ALTER TABLE "recipes" ADD COLUMN\s+"image"[^;]*;/i);
      expect(addColumnStatement).not.toBeNull();
      expect(addColumnStatement![0].toUpperCase()).not.toContain('NOT NULL');
    });

    it('NO declara ningún DEFAULT para la columna "image"', () => {
      const addColumnStatement = migrationSql.match(/ALTER TABLE "recipes" ADD COLUMN\s+"image"[^;]*;/i);
      expect(addColumnStatement).not.toBeNull();
      expect(addColumnStatement![0].toUpperCase()).not.toContain('DEFAULT');
    });
  });

  describe('Migración aditiva / no destructiva', () => {
    it('no contiene DROP TABLE, DROP COLUMN ni TRUNCATE', () => {
      expect(migrationSql.toUpperCase()).not.toContain('DROP TABLE');
      expect(migrationSql.toUpperCase()).not.toContain('DROP COLUMN');
      expect(migrationSql.toUpperCase()).not.toContain('TRUNCATE');
    });
  });

  describe('AC16 - recipe.prisma: campo nuevo + contrato existente NUT-61/NUT-75 intacto', () => {
    let recipeModelContent: string;

    beforeAll(() => {
      expect(fs.existsSync(recipeModelFile)).toBe(true);
      recipeModelContent = fs.readFileSync(recipeModelFile, 'utf-8');
    });

    it('declara el campo "image" de tipo Json? (nullable)', () => {
      expect(recipeModelContent).toContain('model Recipe');
      expect(recipeModelContent).toMatch(/\bimage\s+Json\?/);
    });

    it.each([
      'title',
      'description',
      'prepMinutes',
      'cookMinutes',
      'ingredients',
      'instructions',
      'origin',
      'generationRunId',
    ])('el campo preexistente "%s" sigue presente (contrato NUT-61/NUT-75 intacto)', (fieldName) => {
      const fieldPattern = new RegExp(`\\b${fieldName}\\b`);
      expect(recipeModelContent).toMatch(fieldPattern);
    });

    it('"title" sigue siendo String obligatorio (no se relajó a opcional)', () => {
      expect(recipeModelContent).toMatch(/\btitle\s+String\b(?!\?)/);
    });

    it('"description" sigue siendo String obligatorio (no se relajó a opcional)', () => {
      expect(recipeModelContent).toMatch(/\bdescription\s+String\b(?!\?)/);
    });

    it('"origin" sigue siendo RecipeOrigin con @default(MANUAL) (sin cambios de NUT-75)', () => {
      expect(recipeModelContent).toMatch(/\borigin\s+RecipeOrigin\s+@default\(MANUAL\)/);
    });

    it('"generationRunId" sigue siendo String? opcional (sin cambios de NUT-75)', () => {
      expect(recipeModelContent).toMatch(/\bgenerationRunId\s+String\?/);
    });
  });
});
