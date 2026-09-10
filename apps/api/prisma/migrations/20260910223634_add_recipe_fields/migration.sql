/*
  Warnings:

  - Added the required column `title` to the `recipes` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "recipes" ADD COLUMN     "description" TEXT,
ADD COLUMN     "ingredients" JSONB,
ADD COLUMN     "title" TEXT NOT NULL;
