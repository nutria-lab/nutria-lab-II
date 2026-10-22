import { randomBytes, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { Client, Pool } from 'pg';
import { ShoppingListRepository } from '../shopping-list.repository';
import { ShoppingListService } from '../shopping-list.service';

// This suite creates and drops its own schema. It never falls back to DATABASE_URL.
const dbUrl = process.env.SHOPPING_LIST_TEST_DATABASE_URL;
const describeWithDb = dbUrl ? describe : describe.skip;
const weekStart = '2026-10-19';

describeWithDb('Shopping list persistence on isolated local PostgreSQL', () => {
  let schema: string;
  let admin: Client;
  let pool: Pool;
  let prisma: any;
  let service: ShoppingListService;
  let patchAppName: string;

  beforeAll(async () => {
    const parsed = new URL(dbUrl!);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)) {
      throw new Error('SHOPPING_LIST_TEST_DATABASE_URL must point to a disposable local PostgreSQL instance');
    }

    schema = `nut88_it_${randomBytes(6).toString('hex')}`;
    admin = new Client({ connectionString: dbUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);

    patchAppName = `nut88_patch_${randomBytes(6).toString('hex')}`;
    const options = `-c search_path=${schema},public -c application_name=${patchAppName}`;
    const migrator = new Client({ connectionString: dbUrl, options });
    await migrator.connect();
    try {
      const migrationsDir = path.resolve(__dirname, '../../../../prisma/migrations');
      for (const name of fs.readdirSync(migrationsDir).sort()) {
        const sqlFile = path.join(migrationsDir, name, 'migration.sql');
        if (!fs.existsSync(sqlFile)) continue;
        await migrator.query('BEGIN');
        try {
          await migrator.query(fs.readFileSync(sqlFile, 'utf8'));
          await migrator.query('COMMIT');
        } catch (error) {
          await migrator.query('ROLLBACK');
          throw new Error(`Failed isolated test migration ${name}: ${(error as Error).message}`);
        }
      }
    } finally {
      await migrator.end();
    }

    pool = new Pool({ connectionString: dbUrl, options });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
    await prisma.$connect();
    service = new ShoppingListService(new ShoppingListRepository(prisma));
  }, 60000);

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    if (admin) {
      if (schema) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  });

  async function fixture(suffix: string) {
    const user = await prisma.user.create({ data: {
      email: `shopping-${suffix}-${randomBytes(4).toString('hex')}@example.test`,
      passwordHash: 'synthetic-test-hash',
    } });
    const recipe = await prisma.recipe.create({ data: {
      title: 'Avena sintética',
      description: 'Synthetic test recipe',
      prepMinutes: 1,
      cookMinutes: 1,
      ingredients: [{ name: 'Avena', quantity: 2, unit: 'g' }],
      instructions: ['Synthetic test step'],
    } });
    const plan = await prisma.mealPlan.create({ data: {
      userId: user.id,
      startDate: new Date(`${weekStart}T00:00:00.000Z`),
      endDate: new Date('2026-10-25T00:00:00.000Z'),
      days: { create: [{
        day: 'MONDAY',
        date: new Date(`${weekStart}T00:00:00.000Z`),
        meals: { create: [{
          mealType: 'LUNCH',
          title: 'Synthetic lunch',
          recipeId: recipe.id,
          nutritionalValues: {},
        }] },
      }] },
    } });
    return { user, recipe, plan };
  }

  async function waitForBlockedQuery(tableName: string, applicationName = patchAppName): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const activity = await admin.query<{ waiting: number }>(`
        SELECT COUNT(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND application_name = $1
          AND query LIKE $2
      `, [applicationName, `%${tableName}%`]);
      if (activity.rows[0].waiting > 0) return;
      await new Promise<void>(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Expected a PostgreSQL row-lock wait on ${tableName} for the named test session`);
  }

  it('persists idempotent true/false sets, isolates users, and leaves the plan token unchanged', async () => {
    const { user, plan } = await fixture('sets');
    const other = await fixture('other');
    const initial = await service.getForWeek(user.id, weekStart);
    const key = initial.items[0].key;
    const input = { planId: plan.id, planUpdatedAt: initial.plan!.updatedAt, checked: true };

    await service.setChecked(user.id, key, input);
    await service.setChecked(user.id, key, input);
    const marked = await service.getForWeek(user.id, weekStart);
    const otherList = await service.getForWeek(other.user.id, weekStart);

    expect(marked.items[0].checked).toBe(true);
    expect(marked.summary.checkedItems).toBe(1);
    expect(marked.plan!.updatedAt).toBe(initial.plan!.updatedAt);
    expect(otherList.items[0].checked).toBe(false);
    expect(otherList.summary.checkedItems).toBe(0);
    expect(await prisma.shoppingItemCheck.count({ where: { userId: user.id, planId: plan.id, itemKey: key } })).toBe(1);
    await expect(service.setChecked(other.user.id, key, input)).rejects.toMatchObject({ status: 404 });

    await service.setChecked(user.id, key, { ...input, checked: false });
    await service.setChecked(user.id, key, { ...input, checked: false });
    const unmarked = await service.getForWeek(user.id, weekStart);
    expect(unmarked.items[0].checked).toBe(false);
    expect(unmarked.summary.checkedItems).toBe(0);
    expect(await prisma.shoppingItemCheck.count({ where: { userId: user.id, planId: plan.id, itemKey: key } })).toBe(1);
  }, 30000);

  it('enforces FK/unique/index, keeps GET read-only, and does not inherit checks into a new planId', async () => {
    const { user, recipe, plan } = await fixture('constraints');
    const original = await service.getForWeek(user.id, weekStart);
    const oldKey = original.items[0].key;
    await service.setChecked(user.id, oldKey, {
      planId: plan.id,
      planUpdatedAt: original.plan!.updatedAt,
      checked: true,
    });

    const indexes = await admin.query<{ indexname: string; indexdef: string }>(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = $1 AND tablename = 'shopping_item_checks'
    `, [schema]);
    expect(indexes.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ indexdef: expect.stringMatching(/UNIQUE INDEX .*\("userId", "planId", "itemKey"\)/) }),
      expect.objectContaining({ indexdef: expect.stringMatching(/INDEX .*\("planId"\)/) }),
    ]));
    const foreignKeys = await admin.query<{ conname: string; confdeltype: string }>(`
      SELECT c.conname, c.confdeltype FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = $1 AND t.relname = 'shopping_item_checks' AND c.contype = 'f'
    `, [schema]);
    expect(foreignKeys.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ conname: 'shopping_item_checks_userId_fkey', confdeltype: 'c' }),
      expect.objectContaining({ conname: 'shopping_item_checks_planId_fkey', confdeltype: 'c' }),
    ]));

    await expect(prisma.shoppingItemCheck.create({ data: {
      userId: user.id, planId: plan.id, itemKey: oldKey, checked: true,
    } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.shoppingItemCheck.create({ data: {
      userId: user.id, planId: 'missing-plan-id', itemKey: oldKey, checked: true,
    } })).rejects.toMatchObject({ code: 'P2003' });

    const rowsBeforeReads = await prisma.shoppingItemCheck.findMany({ where: { planId: plan.id } });
    const tokenBeforeReads = (await prisma.mealPlan.findUnique({ where: { id: plan.id } })).updatedAt;
    await service.getForWeek(user.id, weekStart);
    await service.getForWeek(user.id, weekStart);
    expect(await prisma.shoppingItemCheck.findMany({ where: { planId: plan.id } })).toEqual(rowsBeforeReads);
    expect((await prisma.mealPlan.findUnique({ where: { id: plan.id } })).updatedAt).toEqual(tokenBeforeReads);

    await prisma.mealPlan.update({ where: { id: plan.id }, data: { isCurrent: false } });
    const next = await prisma.mealPlan.create({ data: {
      userId: user.id,
      startDate: new Date(`${weekStart}T00:00:00.000Z`),
      endDate: new Date('2026-10-25T00:00:00.000Z'),
      version: 2,
      supersedesId: plan.id,
      days: { create: [{
        day: 'MONDAY', date: new Date(`${weekStart}T00:00:00.000Z`),
        meals: { create: [{
          mealType: 'LUNCH', title: 'Synthetic lunch', recipeId: recipe.id,
          nutritionalValues: {},
        }] },
      }] },
    } });
    const regenerated = await service.getForWeek(user.id, weekStart);
    expect(regenerated.plan!.id).toBe(next.id);
    expect(regenerated.items[0].key).not.toBe(oldKey);
    expect(regenerated.items[0].checked).toBe(false);
    expect(regenerated.summary.checkedItems).toBe(0);
    expect(await prisma.shoppingItemCheck.count({ where: { planId: plan.id } })).toBe(1);

    await prisma.mealPlan.delete({ where: { id: plan.id } });
    expect(await prisma.shoppingItemCheck.count({ where: { planId: plan.id } })).toBe(0);
    expect((await service.getForWeek(user.id, weekStart)).plan!.id).toBe(next.id);
  }, 30000);

  it('rejects a stale token and a concurrently removed plan without leaving a check', async () => {
    const { user, plan } = await fixture('stale');
    const initial = await service.getForWeek(user.id, weekStart);
    const key = initial.items[0].key;
    const input = { planId: plan.id, planUpdatedAt: initial.plan!.updatedAt, checked: true };

    await prisma.mealPlan.update({ where: { id: plan.id }, data: { updatedAt: new Date('2026-10-20T12:00:00.000Z') } });
    await expect(service.setChecked(user.id, key, input)).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'SHOPPING_LIST_STALE' }),
    });
    expect(await prisma.shoppingItemCheck.count({ where: { planId: plan.id } })).toBe(0);

    const fresh = await service.getForWeek(user.id, weekStart);
    await prisma.mealPlan.delete({ where: { id: plan.id } });
    await expect(service.setChecked(user.id, key, {
      ...input,
      planUpdatedAt: fresh.plan!.updatedAt,
    })).rejects.toMatchObject({ status: 404 });
    expect(await prisma.shoppingItemCheck.count({ where: { planId: plan.id } })).toBe(0);
  }, 30000);

  it('serializes PATCH behind a plan edit and rejects the old token without writing a check', async () => {
    const { user, plan } = await fixture('race');
    const initial = await service.getForWeek(user.id, weekStart);
    const key = initial.items[0].key;
    const blocker = new Client({
      connectionString: dbUrl,
      options: `-c search_path=${schema},public`,
    });
    await blocker.connect();
    let transactionOpen = false;
    try {
      await blocker.query('BEGIN');
      transactionOpen = true;
      await blocker.query('SELECT "id" FROM "meal_plans" WHERE "id" = $1 FOR UPDATE', [plan.id]);

      const pending = service.setChecked(user.id, key, {
        planId: plan.id,
        planUpdatedAt: initial.plan!.updatedAt,
        checked: true,
      }).then(() => ({ ok: true }), error => ({ ok: false, error }));

      await waitForBlockedQuery('meal_plans');

      await blocker.query('UPDATE "meal_plans" SET "updatedAt" = $2 WHERE "id" = $1', [
        plan.id, new Date('2026-10-20T12:00:00.000Z'),
      ]);
      await blocker.query('COMMIT');
      transactionOpen = false;

      const outcome = await pending;
      expect(outcome).toMatchObject({
        ok: false,
        error: {
          status: 409,
          response: expect.objectContaining({ code: 'SHOPPING_LIST_STALE' }),
        },
      });
      expect(await prisma.shoppingItemCheck.count({ where: { planId: plan.id } })).toBe(0);
    } finally {
      if (transactionOpen) await blocker.query('ROLLBACK').catch(() => undefined);
      await blocker.end();
    }
  }, 30000);

  it('waits for a direct recipe edit, then rejects a key made stale without a plan token change', async () => {
    const { user, recipe, plan } = await fixture('recipe-first');
    const initial = await service.getForWeek(user.id, weekStart);
    const oldKey = initial.items[0].key;
    const blocker = new Client({ connectionString: dbUrl, options: `-c search_path=${schema},public` });
    await blocker.connect();
    let transactionOpen = false;
    try {
      await blocker.query('BEGIN');
      transactionOpen = true;
      await blocker.query('SELECT "id" FROM "recipes" WHERE "id" = $1 FOR UPDATE', [recipe.id]);
      const pending = service.setChecked(user.id, oldKey, {
        planId: plan.id,
        planUpdatedAt: initial.plan!.updatedAt,
        checked: true,
      }).then(() => ({ ok: true }), error => ({ ok: false, error }));

      await waitForBlockedQuery('recipes');
      await blocker.query('UPDATE "recipes" SET "ingredients" = $2::jsonb WHERE "id" = $1', [
        recipe.id, JSON.stringify([{ name: 'Avena', quantity: 3, unit: 'g' }]),
      ]);
      await blocker.query('COMMIT');
      transactionOpen = false;

      expect(await pending).toMatchObject({
        ok: false,
        error: {
          status: 409,
          response: expect.objectContaining({ code: 'SHOPPING_LIST_STALE' }),
        },
      });
      const changed = await service.getForWeek(user.id, weekStart);
      expect(changed.plan!.updatedAt).toBe(initial.plan!.updatedAt);
      expect(changed.items[0].key).not.toBe(oldKey);
      expect(changed.items[0].checked).toBe(false);
      expect(await prisma.shoppingItemCheck.count({ where: { planId: plan.id } })).toBe(0);
    } finally {
      if (transactionOpen) await blocker.query('ROLLBACK').catch(() => undefined);
      await blocker.end();
    }
  }, 30000);

  it('allows PATCH to finish before a recipe edit, then leaves only the old key checked', async () => {
    const { user, recipe, plan } = await fixture('patch-first');
    const initial = await service.getForWeek(user.id, weekStart);
    const oldKey = initial.items[0].key;
    await service.setChecked(user.id, oldKey, {
      planId: plan.id, planUpdatedAt: initial.plan!.updatedAt, checked: false,
    });

    const checkBlocker = new Client({ connectionString: dbUrl, options: `-c search_path=${schema},public` });
    const editorAppName = `nut88_recipe_editor_${randomBytes(6).toString('hex')}`;
    const recipeEditor = new Client({
      connectionString: dbUrl,
      options: `-c search_path=${schema},public -c application_name=${editorAppName}`,
    });
    await checkBlocker.connect();
    await recipeEditor.connect();
    let transactionOpen = false;
    try {
      await checkBlocker.query('BEGIN');
      transactionOpen = true;
      await checkBlocker.query('SELECT "id" FROM "shopping_item_checks" WHERE "planId" = $1 FOR UPDATE', [plan.id]);

      const patch = service.setChecked(user.id, oldKey, {
        planId: plan.id, planUpdatedAt: initial.plan!.updatedAt, checked: true,
      }).then(() => ({ ok: true }), error => ({ ok: false, error }));
      await waitForBlockedQuery('shopping_item_checks');

      const edit = recipeEditor.query('UPDATE "recipes" SET "ingredients" = $2::jsonb WHERE "id" = $1', [
        recipe.id, JSON.stringify([{ name: 'Avena', quantity: 3, unit: 'g' }]),
      ]).then(() => ({ ok: true }), error => ({ ok: false, error }));
      await waitForBlockedQuery('recipes', editorAppName);

      await checkBlocker.query('COMMIT');
      transactionOpen = false;
      expect(await patch).toEqual({ ok: true });
      expect(await edit).toEqual({ ok: true });

      const changed = await service.getForWeek(user.id, weekStart);
      expect(changed.items[0].key).not.toBe(oldKey);
      expect(changed.items[0].checked).toBe(false);
      expect(changed.summary.checkedItems).toBe(0);
      expect(await prisma.shoppingItemCheck.findMany({ where: { planId: plan.id } })).toEqual([
        expect.objectContaining({ itemKey: oldKey, checked: true }),
      ]);
    } finally {
      if (transactionOpen) await checkBlocker.query('ROLLBACK').catch(() => undefined);
      await checkBlocker.end();
      await recipeEditor.end();
    }
  }, 30000);

  it('lets PATCH commit first, then atomically supersedes the plan without inheriting its check', async () => {
    const { user, recipe, plan } = await fixture('plan-patch-first');
    const initial = await service.getForWeek(user.id, weekStart);
    const oldKey = initial.items[0].key;
    const nextPlanId = randomUUID();
    const nextDayId = randomUUID();
    const nextMealId = randomUUID();
    const tableBlocker = new Client({ connectionString: dbUrl, options: `-c search_path=${schema},public` });
    const editorAppName = `nut88_plan_editor_${randomBytes(6).toString('hex')}`;
    const planEditor = new Client({
      connectionString: dbUrl,
      options: `-c search_path=${schema},public -c application_name=${editorAppName}`,
    });
    await tableBlocker.connect();
    await planEditor.connect();
    let blockerOpen = false;
    let editorOpen = false;
    try {
      await tableBlocker.query('BEGIN');
      blockerOpen = true;
      await tableBlocker.query('LOCK TABLE "shopping_item_checks" IN ACCESS EXCLUSIVE MODE');

      const patch = service.setChecked(user.id, oldKey, {
        planId: plan.id, planUpdatedAt: initial.plan!.updatedAt, checked: true,
      }).then(() => ({ ok: true }), error => ({ ok: false, error }));
      await waitForBlockedQuery('shopping_item_checks');

      const replacement = (async () => {
        await planEditor.query('BEGIN');
        editorOpen = true;
        await planEditor.query('UPDATE "meal_plans" SET "isCurrent" = false, "updatedAt" = $2 WHERE "id" = $1', [
          plan.id, '2026-10-20T12:00:00.000',
        ]);
        // PostgreSQL columns are TIMESTAMP(3) without time zone. Pass literal UTC
        // wall-clock fields so pg does not reinterpret a JS Date in the host zone.
        const now = '2026-10-20T12:00:00.000';
        await planEditor.query(`
          INSERT INTO "meal_plans" ("id", "userId", "startDate", "endDate", "createdAt", "updatedAt", "version", "isCurrent", "supersedesId")
          VALUES ($1, $2, $3, $4, $5, $5, 2, true, $6)
        `, [nextPlanId, user.id, `${weekStart}T00:00:00.000`, '2026-10-25T00:00:00.000', now, plan.id]);
        await planEditor.query(`
          INSERT INTO "meal_plan_days" ("id", "mealPlanId", "day", "date", "createdAt", "updatedAt")
          VALUES ($1, $2, 'MONDAY', $3, $4, $4)
        `, [nextDayId, nextPlanId, `${weekStart}T00:00:00.000`, now]);
        await planEditor.query(`
          INSERT INTO "planned_meals" ("id", "dayId", "mealType", "title", "recipeId", "nutritionalValues", "createdAt", "updatedAt")
          VALUES ($1, $2, 'LUNCH', 'Synthetic lunch', $3, '{}'::jsonb, $4, $4)
        `, [nextMealId, nextDayId, recipe.id, now]);
        await planEditor.query('COMMIT');
        editorOpen = false;
      })().then(() => ({ ok: true }), error => ({ ok: false, error }));

      await waitForBlockedQuery('meal_plans', editorAppName);
      await tableBlocker.query('COMMIT');
      blockerOpen = false;
      expect(await patch).toEqual({ ok: true });
      expect(await replacement).toEqual({ ok: true });

      const planRows = await prisma.mealPlan.findMany({
        where: { userId: user.id },
        select: { id: true, startDate: true, isCurrent: true, version: true },
      });
      expect(planRows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: nextPlanId,
          startDate: new Date(`${weekStart}T00:00:00.000Z`),
          isCurrent: true,
          version: 2,
        }),
      ]));
      const regenerated = await service.getForWeek(user.id, weekStart);
      expect(regenerated.plan!.id).toBe(nextPlanId);
      expect(regenerated.items[0].key).not.toBe(oldKey);
      expect(regenerated.items[0].checked).toBe(false);
      expect(regenerated.summary.checkedItems).toBe(0);
      expect(await prisma.shoppingItemCheck.findMany({ where: { userId: user.id } })).toEqual([
        expect.objectContaining({ planId: plan.id, itemKey: oldKey, checked: true }),
      ]);
    } finally {
      if (blockerOpen) await tableBlocker.query('ROLLBACK').catch(() => undefined);
      if (editorOpen) await planEditor.query('ROLLBACK').catch(() => undefined);
      await tableBlocker.end();
      await planEditor.end();
    }
  }, 30000);
});
