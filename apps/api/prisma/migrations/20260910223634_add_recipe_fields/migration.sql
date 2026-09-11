/*
  Warnings:

  - Added the required column `title` to the `recipes` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "recipes" 
ADD COLUMN IF NOT EXISTS "description" TEXT,
ADD COLUMN IF NOT EXISTS "ingredients" JSONB,
ADD COLUMN IF NOT EXISTS "title" TEXT NOT NULL DEFAULT '';
