-- CreateEnum
CREATE TYPE "NutritionGoal" AS ENUM ('LOSE_WEIGHT', 'GAIN_MUSCLE', 'MAINTAIN');

-- CreateEnum
CREATE TYPE "Diet" AS ENUM ('VEGAN', 'VEGETARIAN', 'PALEO', 'KETO', 'PESCATARIAN', 'ALL');

-- CreateEnum
CREATE TYPE "DietaryRestriction" AS ENUM ('NUTS', 'GLUTEN', 'DAIRY', 'SHELLFISH', 'SOY');

-- CreateEnum
CREATE TYPE "CookTimePreference" AS ENUM ('QUICK', 'STANDARD', 'GOURMET');

-- CreateTable
CREATE TABLE "nutrition_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goal" "NutritionGoal" NOT NULL,
    "diet" "Diet" NOT NULL,
    "excludedIngredients" "DietaryRestriction"[],
    "cookTimePreference" "CookTimePreference" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nutrition_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_profiles_userId_key" ON "nutrition_profiles"("userId");

-- AddForeignKey
ALTER TABLE "nutrition_profiles" ADD CONSTRAINT "nutrition_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
