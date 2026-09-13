/*
  Warnings:

  - You are about to drop the column `steps` on the `recipes` table. All the data in the column will be lost.
  - Made the column `description` on table `recipes` required. This step will fail if there are existing NULL values in that column.
  - Made the column `ingredients` on table `recipes` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "recipes" DROP COLUMN "steps",
ADD COLUMN     "instructions" TEXT[],
ALTER COLUMN "description" SET NOT NULL,
ALTER COLUMN "ingredients" SET NOT NULL;
