import * as fs from 'node:fs';
import * as path from 'node:path';

describe('NUT-88 ShoppingItemCheck additive schema and migration', () => {
  const prismaDir = path.resolve(__dirname, '../../../prisma');
  const modelFile = path.join(prismaDir, 'models/shoppingItemCheck.prisma');
  const userFile = path.join(prismaDir, 'models/user.prisma');
  const planFile = path.join(prismaDir, 'models/mealPlan.prisma');
  const migrationDir = path.join(prismaDir, 'migrations');

  function migrationSql(): string {
    const candidates = fs.readdirSync(migrationDir)
      .filter(name => /_add_shopping_item_checks$/i.test(name))
      .sort();
    expect(candidates).toHaveLength(1);
    return fs.readFileSync(path.join(migrationDir, candidates[0], 'migration.sql'), 'utf8');
  }

  it('models only the check identity, value, audit dates, and cascade relations', () => {
    expect(fs.existsSync(modelFile)).toBe(true);
    const model = fs.readFileSync(modelFile, 'utf8');
    expect(model).toMatch(/model\s+ShoppingItemCheck\s*\{/);
    expect(model).toMatch(/\bid\s+String\s+@id\s+@default\(uuid\(\)\)/);
    expect(model).toMatch(/\buserId\s+String\b/);
    expect(model).toMatch(/\bplanId\s+String\b/);
    expect(model).toMatch(/\bitemKey\s+String\b/);
    expect(model).toMatch(/\bchecked\s+Boolean\b/);
    expect(model).toMatch(/\bcreatedAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(model).toMatch(/\bupdatedAt\s+DateTime\s+@updatedAt/);
    expect(model).toMatch(/\buser\s+User\s+@relation\(fields:\s*\[userId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/);
    expect(model).toMatch(/\bplan\s+MealPlan\s+@relation\(fields:\s*\[planId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/);
    expect(model).toMatch(/@@unique\(\[userId,\s*planId,\s*itemKey\]\)/);
    expect(model).toMatch(/@@index\(\[planId\]\)/);
    expect(model).toMatch(/@@map\("shopping_item_checks"\)/);
    expect(model).not.toMatch(/\b(?:ingredient|quantity|portion|cart)\s+/i);
    expect(fs.readFileSync(userFile, 'utf8')).toMatch(/\bshoppingItemChecks\s+ShoppingItemCheck\[\]/);
    expect(fs.readFileSync(planFile, 'utf8')).toMatch(/\bshoppingItemChecks\s+ShoppingItemCheck\[\]/);
  });

  it('creates a table, unique identity, plan index and two cascade FKs without destructive SQL', () => {
    const sql = migrationSql();
    expect(sql).toMatch(/CREATE TABLE "shopping_item_checks"\s*\(/);
    expect(sql).toMatch(/"id" TEXT NOT NULL/);
    expect(sql).toMatch(/"userId" TEXT NOT NULL/);
    expect(sql).toMatch(/"planId" TEXT NOT NULL/);
    expect(sql).toMatch(/"itemKey" TEXT NOT NULL/);
    expect(sql).toMatch(/"checked" BOOLEAN NOT NULL/);
    expect(sql).toMatch(/"createdAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(sql).toMatch(/"updatedAt" TIMESTAMP\(3\) NOT NULL/);
    expect(sql).toMatch(/PRIMARY KEY \("id"\)/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX [^;]+ ON "shopping_item_checks"\("userId",\s*"planId",\s*"itemKey"\)/);
    expect(sql).toMatch(/CREATE INDEX [^;]+ ON "shopping_item_checks"\("planId"\)/);
    expect(sql).toMatch(/FOREIGN KEY \("userId"\) REFERENCES "users"\("id"\) ON DELETE CASCADE/);
    expect(sql).toMatch(/FOREIGN KEY \("planId"\) REFERENCES "meal_plans"\("id"\) ON DELETE CASCADE/);
    expect(sql).not.toMatch(/^\s*(?:DROP|TRUNCATE|DELETE|UPDATE)\b/im);
    expect(sql).not.toMatch(/ALTER TABLE\s+"[^"]+"\s+DROP\b/i);
    expect(sql).not.toMatch(/ALTER TABLE "(?:users|meal_plans|recipes|planned_meals)"/);
  });
});
