import * as fs from 'fs';
import * as path from 'path';
import {
  NutritionGoal,
  Diet,
  DietaryRestriction,
  CookTimePreference,
} from '../../generated/prisma/enums';

describe('NutritionProfile Schema & Migration Tests (Commit 1 Verification)', () => {
  const prismaDir = path.resolve(__dirname, '../../../prisma');
  const migrationFile = path.resolve(
    prismaDir,
    'migrations/20260902133600_add_nutrition_profile/migration.sql',
  );
  const nutritionProfileModelFile = path.resolve(
    prismaDir,
    'models/nutritionProfile.prisma',
  );
  const userModelFile = path.resolve(prismaDir, 'models/user.prisma');

  describe('Migration SQL inspection', () => {
    let migrationSql: string;

    beforeAll(() => {
      expect(fs.existsSync(migrationFile)).toBe(true);
      migrationSql = fs.readFileSync(migrationFile, 'utf-8');
    });

    it('should define NutritionGoal enum with all allowed values', () => {
      expect(migrationSql).toMatch(
        /CREATE TYPE "NutritionGoal" AS ENUM \('LOSE_WEIGHT', 'GAIN_MUSCLE', 'MAINTAIN'\);/,
      );
    });

    it('should define Diet enum with all allowed values', () => {
      expect(migrationSql).toMatch(
        /CREATE TYPE "Diet" AS ENUM \('VEGAN', 'VEGETARIAN', 'PALEO', 'KETO', 'PESCATARIAN', 'ALL'\);/,
      );
    });

    it('should define DietaryRestriction enum with all allowed values', () => {
      expect(migrationSql).toMatch(
        /CREATE TYPE "DietaryRestriction" AS ENUM \('NUTS', 'GLUTEN', 'DAIRY', 'SHELLFISH', 'SOY'\);/,
      );
    });

    it('should define CookTimePreference enum with all allowed values', () => {
      expect(migrationSql).toMatch(
        /CREATE TYPE "CookTimePreference" AS ENUM \('QUICK', 'STANDARD', 'GOURMET'\);/,
      );
    });

    it('should create nutrition_profiles table with expected columns and types', () => {
      expect(migrationSql).toContain('CREATE TABLE "nutrition_profiles" (');
      expect(migrationSql).toContain('"id" TEXT NOT NULL');
      expect(migrationSql).toContain('"userId" TEXT NOT NULL');
      expect(migrationSql).toContain('"goal" "NutritionGoal" NOT NULL');
      expect(migrationSql).toContain('"diet" "Diet" NOT NULL');
      expect(migrationSql).toContain(
        '"excludedIngredients" "DietaryRestriction"[]',
      );
      expect(migrationSql).toContain(
        '"cookTimePreference" "CookTimePreference" NOT NULL',
      );
      expect(migrationSql).toContain(
        '"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
      );
      expect(migrationSql).toContain('"updatedAt" TIMESTAMP(3) NOT NULL');
      expect(migrationSql).toContain(
        'CONSTRAINT "nutrition_profiles_pkey" PRIMARY KEY ("id")',
      );
    });

    it('should enforce one-profile-per-user uniqueness constraint via unique index', () => {
      expect(migrationSql).toMatch(
        /CREATE UNIQUE INDEX "nutrition_profiles_userId_key" ON "nutrition_profiles"\("userId"\);/,
      );
    });

    it('should configure foreign-key constraint with ON DELETE CASCADE and ON UPDATE CASCADE', () => {
      expect(migrationSql).toMatch(
        /ALTER TABLE "nutrition_profiles" ADD CONSTRAINT "nutrition_profiles_userId_fkey" FOREIGN KEY \("userId"\) REFERENCES "users"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE;/,
      );
    });

    it('should be non-destructive and contain no DROP or table truncation statements', () => {
      expect(migrationSql.toUpperCase()).not.toContain('DROP TABLE');
      expect(migrationSql.toUpperCase()).not.toContain('DROP COLUMN');
      expect(migrationSql.toUpperCase()).not.toContain('TRUNCATE');
    });
  });

  describe('Prisma Model Definitions', () => {
    it('should define NutritionProfile model correctly in nutritionProfile.prisma', () => {
      expect(fs.existsSync(nutritionProfileModelFile)).toBe(true);
      const content = fs.readFileSync(nutritionProfileModelFile, 'utf-8');

      // Model name and mapping
      expect(content).toContain('model NutritionProfile');
      expect(content).toContain('@@map("nutrition_profiles")');

      // Fields
      expect(content).toMatch(/id\s+String\s+@id\s+@default\(uuid\(\)\)/);
      expect(content).toMatch(/userId\s+String\s+@unique/);
      expect(content).toMatch(
        /user\s+User\s+@relation\(fields:\s*\[userId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/,
      );
      expect(content).toMatch(/goal\s+NutritionGoal/);
      expect(content).toMatch(/diet\s+Diet/);
      expect(content).toMatch(/excludedIngredients\s+DietaryRestriction\[\]/);
      expect(content).toMatch(/cookTimePreference\s+CookTimePreference/);
      expect(content).toMatch(
        /createdAt\s+DateTime\s+@default\(now\(\)\)/,
      );
      expect(content).toMatch(/updatedAt\s+DateTime\s+@updatedAt/);
    });

    it('should define relation to NutritionProfile in user.prisma', () => {
      expect(fs.existsSync(userModelFile)).toBe(true);
      const content = fs.readFileSync(userModelFile, 'utf-8');

      expect(content).toContain('model User');
      expect(content).toMatch(/nutritionProfile\s+NutritionProfile\?/);
    });
  });

  describe('Generated Prisma Client Enum Constants', () => {
    it('should match NutritionGoal values', () => {
      expect(NutritionGoal).toEqual({
        LOSE_WEIGHT: 'LOSE_WEIGHT',
        GAIN_MUSCLE: 'GAIN_MUSCLE',
        MAINTAIN: 'MAINTAIN',
      });
    });

    it('should match Diet values', () => {
      expect(Diet).toEqual({
        VEGAN: 'VEGAN',
        VEGETARIAN: 'VEGETARIAN',
        PALEO: 'PALEO',
        KETO: 'KETO',
        PESCATARIAN: 'PESCATARIAN',
        ALL: 'ALL',
      });
    });

    it('should match DietaryRestriction values', () => {
      expect(DietaryRestriction).toEqual({
        NUTS: 'NUTS',
        GLUTEN: 'GLUTEN',
        DAIRY: 'DAIRY',
        SHELLFISH: 'SHELLFISH',
        SOY: 'SOY',
      });
    });

    it('should match CookTimePreference values', () => {
      expect(CookTimePreference).toEqual({
        QUICK: 'QUICK',
        STANDARD: 'STANDARD',
        GOURMET: 'GOURMET',
      });
    });
  });
});
