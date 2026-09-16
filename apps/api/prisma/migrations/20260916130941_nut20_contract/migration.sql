-- CreateEnum
CREATE TYPE "RecipeCategory" AS ENUM ('VEGAN', 'VEGETARIAN', 'HIGH_PROTEIN', 'GLUTEN_FREE', 'DAIRY_FREE', 'LOW_CARB', 'OTHER');

-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN     "defaultUnit" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "properties" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "recipes" ADD COLUMN     "categories" "RecipeCategory"[] DEFAULT ARRAY[]::"RecipeCategory"[],
ADD COLUMN     "nutritionalValues" JSONB,
ADD COLUMN     "properties" TEXT[] DEFAULT ARRAY[]::TEXT[];
