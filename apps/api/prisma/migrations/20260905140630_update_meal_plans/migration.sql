/*
  Warnings:

  - You are about to drop the column `generationContext` on the `meal_plans` table. All the data in the column will be lost.
  - You are about to drop the column `isActive` on the `meal_plans` table. All the data in the column will be lost.
  - You are about to drop the column `parentPlanId` on the `meal_plans` table. All the data in the column will be lost.
  - You are about to drop the column `version` on the `meal_plans` table. All the data in the column will be lost.
  - You are about to drop the column `weekStart` on the `meal_plans` table. All the data in the column will be lost.
  - You are about to drop the column `editedFromId` on the `planned_meals` table. All the data in the column will be lost.
  - You are about to drop the column `isUserEdited` on the `planned_meals` table. All the data in the column will be lost.
  - You are about to drop the column `order` on the `planned_meals` table. All the data in the column will be lost.
  - You are about to drop the column `servings` on the `planned_meals` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `recipes` table. All the data in the column will be lost.
  - You are about to drop the column `imageUrl` on the `recipes` table. All the data in the column will be lost.
  - You are about to drop the column `instructions` on the `recipes` table. All the data in the column will be lost.
  - You are about to drop the column `servings` on the `recipes` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `recipes` table. All the data in the column will be lost.
  - You are about to drop the `recipe_ingredients` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[mealPlanId,day]` on the table `meal_plan_days` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,startDate]` on the table `meal_plans` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `nutritionalValues` to the `ingredients` table without a default value. This is not possible if the table is not empty.
  - Added the required column `type` to the `ingredients` table without a default value. This is not possible if the table is not empty.
  - Added the required column `day` to the `meal_plan_days` table without a default value. This is not possible if the table is not empty.
  - Added the required column `endDate` to the `meal_plans` table without a default value. This is not possible if the table is not empty.
  - Added the required column `startDate` to the `meal_plans` table without a default value. This is not possible if the table is not empty.
  - Added the required column `nutritionalValues` to the `planned_meals` table without a default value. This is not possible if the table is not empty.
  - Added the required column `title` to the `planned_meals` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "IngredientType" AS ENUM ('MEAT', 'VEGETABLE', 'FRUIT', 'DAIRY', 'GRAIN', 'SPICE', 'OTHER');

-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- DropForeignKey
ALTER TABLE "meal_plans" DROP CONSTRAINT "meal_plans_parentPlanId_fkey";

-- DropForeignKey
ALTER TABLE "planned_meals" DROP CONSTRAINT "planned_meals_editedFromId_fkey";

-- DropForeignKey
ALTER TABLE "planned_meals" DROP CONSTRAINT "planned_meals_recipeId_fkey";

-- DropForeignKey
ALTER TABLE "recipe_ingredients" DROP CONSTRAINT "recipe_ingredients_ingredientId_fkey";

-- DropForeignKey
ALTER TABLE "recipe_ingredients" DROP CONSTRAINT "recipe_ingredients_recipeId_fkey";

-- DropIndex
DROP INDEX "meal_plan_days_mealPlanId_date_key";

-- DropIndex
DROP INDEX "meal_plans_userId_weekStart_version_key";

-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN     "nutritionalValues" JSONB NOT NULL,
ADD COLUMN     "type" "IngredientType" NOT NULL;

-- AlterTable
ALTER TABLE "meal_plan_days" ADD COLUMN     "day" "DayOfWeek" NOT NULL;

-- AlterTable
ALTER TABLE "meal_plans" DROP COLUMN "generationContext",
DROP COLUMN "isActive",
DROP COLUMN "parentPlanId",
DROP COLUMN "version",
DROP COLUMN "weekStart",
ADD COLUMN     "endDate" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "startDate" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "planned_meals" DROP COLUMN "editedFromId",
DROP COLUMN "isUserEdited",
DROP COLUMN "order",
DROP COLUMN "servings",
ADD COLUMN     "nutritionalValues" JSONB NOT NULL,
ADD COLUMN     "title" TEXT NOT NULL,
ALTER COLUMN "recipeId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "recipes" DROP COLUMN "description",
DROP COLUMN "imageUrl",
DROP COLUMN "instructions",
DROP COLUMN "servings",
DROP COLUMN "title",
ADD COLUMN     "steps" TEXT[];

-- DropTable
DROP TABLE "recipe_ingredients";

-- CreateIndex
CREATE UNIQUE INDEX "meal_plan_days_mealPlanId_day_key" ON "meal_plan_days"("mealPlanId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "meal_plans_userId_startDate_key" ON "meal_plans"("userId", "startDate");

-- AddForeignKey
ALTER TABLE "planned_meals" ADD CONSTRAINT "planned_meals_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
