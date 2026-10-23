-- Advance the meal token even when an older app instance relies on the existing
-- ON DELETE SET NULL foreign-key action instead of explicitly updating PlannedMeal.
CREATE FUNCTION "advance_planned_meal_token_on_recipe_unlink"() RETURNS trigger AS $$
BEGIN
    IF OLD."recipeId" IS NOT NULL AND NEW."recipeId" IS NULL THEN
        NEW."updatedAt" := GREATEST(NEW."updatedAt", OLD."updatedAt" + INTERVAL '1 millisecond');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "planned_meal_recipe_unlink_advances_token"
BEFORE UPDATE OF "recipeId" ON "planned_meals"
FOR EACH ROW
WHEN (OLD."recipeId" IS NOT NULL AND NEW."recipeId" IS NULL)
EXECUTE FUNCTION "advance_planned_meal_token_on_recipe_unlink"();

-- CreateEnum
CREATE TYPE "MealCompletionStatus" AS ENUM ('NOT_LOGGED', 'COMPLETED', 'SKIPPED');

-- CreateTable
CREATE TABLE "meal_completions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plannedMealId" TEXT NOT NULL,
    "recipeIdSnapshot" TEXT,
    "mealUpdatedAtSnapshot" TIMESTAMP(3) NOT NULL,
    "status" "MealCompletionStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meal_completions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meal_completions_plannedMealId_key" ON "meal_completions"("plannedMealId");

-- CreateIndex
CREATE INDEX "meal_completions_userId_idx" ON "meal_completions"("userId");

-- AddForeignKey
ALTER TABLE "meal_completions" ADD CONSTRAINT "meal_completions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_completions" ADD CONSTRAINT "meal_completions_plannedMealId_fkey" FOREIGN KEY ("plannedMealId") REFERENCES "planned_meals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

