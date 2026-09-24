-- 1) Enums nuevos
CREATE TYPE "GenerationKind" AS ENUM ('RECIPE_SINGLE', 'RECIPE_BATCH', 'MEAL_PLAN_INITIAL', 'MEAL_PLAN_REGENERATION', 'MEAL_REPLACEMENT');
CREATE TYPE "GenerationStatus" AS ENUM ('PENDING', 'READY_FOR_REVIEW', 'CONFIRMED', 'SUCCEEDED', 'REJECTED', 'FAILED', 'EXPIRED');
CREATE TYPE "RecipeOrigin" AS ENUM ('MANUAL', 'AI');

-- 2) Tabla nueva generation_runs
CREATE TABLE "generation_runs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "GenerationKind" NOT NULL,
    "status" "GenerationStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "idempotencyKeyHash" TEXT,
    "requestSnapshot" JSONB NOT NULL,
    "profileSnapshot" JSONB NOT NULL,
    "outputSnapshot" JSONB,
    "validationSnapshot" JSONB,
    "errorCode" TEXT,
    "expiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generation_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "generation_runs_userId_createdAt_idx" ON "generation_runs"("userId", "createdAt");

-- NUT-75 Bug 2 (bloqueante, revisión externa de PR): un único índice único TOTAL sobre
-- ("userId","kind","idempotencyKeyHash") bloqueaba para siempre cualquier reintento con el
-- mismo contenido de solicitud una vez que el run terminaba en FAILED/REJECTED/EXPIRED
-- (`.ai/ai-generation-safety.md` exige "Recoverable failure state with a clear retry path").
-- Se reemplaza por: (1) un índice simple no único, para que las búsquedas de
-- `findFirst`/`createOrRecoverGenerationRun` sigan siendo eficientes, y (2) un índice único
-- PARCIAL que sólo deduplica runs en estados no terminal-fallidos — un run
-- FAILED/REJECTED/EXPIRED deja de "ocupar" el hash, así que un reintento idéntico simplemente
-- crea un GenerationRun nuevo.
CREATE INDEX "generation_runs_userId_kind_idempotencyKeyHash_idx" ON "generation_runs"("userId", "kind", "idempotencyKeyHash");
CREATE UNIQUE INDEX "generation_runs_userId_kind_idempotencyKeyHash_key" ON "generation_runs"("userId", "kind", "idempotencyKeyHash") WHERE "status" NOT IN ('FAILED', 'REJECTED', 'EXPIRED');

ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) recipes: origin + generationRunId
ALTER TABLE "recipes"
    ADD COLUMN "origin" "RecipeOrigin" NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN "generationRunId" TEXT;

CREATE INDEX "recipes_generationRunId_idx" ON "recipes"("generationRunId");

ALTER TABLE "recipes" ADD CONSTRAINT "recipes_generationRunId_fkey"
    FOREIGN KEY ("generationRunId") REFERENCES "generation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) meal_plans: quitar la unicidad simple vieja, agregar versionado
DROP INDEX "meal_plans_userId_startDate_key";

ALTER TABLE "meal_plans"
    ADD COLUMN "generationRunId" TEXT,
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "supersedesId" TEXT;

CREATE INDEX "meal_plans_userId_startDate_idx" ON "meal_plans"("userId", "startDate");
CREATE INDEX "meal_plans_generationRunId_idx" ON "meal_plans"("generationRunId");
CREATE INDEX "meal_plans_supersedesId_idx" ON "meal_plans"("supersedesId");

-- Índice único PARCIAL: sustituye a la unicidad simple que se quitó arriba.
-- No representable en schema.prisma (ver design.md sección 5.5) — vive sólo acá.
CREATE UNIQUE INDEX "meal_plans_user_week_current_key"
    ON "meal_plans"("userId", "startDate")
    WHERE "isCurrent" = true;

ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_generationRunId_fkey"
    FOREIGN KEY ("generationRunId") REFERENCES "generation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_supersedesId_fkey"
    FOREIGN KEY ("supersedesId") REFERENCES "meal_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
