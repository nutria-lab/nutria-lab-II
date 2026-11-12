import {
  PrismaClient,
  NutritionGoal,
  Diet,
  DietaryRestriction,
  CookTimePreference,
  DayOfWeek,
  MealType,
} from '../src/generated/prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { SeedGuardError, SeedTarget, assertSeedTarget } from './synthetic/guard';
import { MAX_SYNTHETIC_USERS, generateSyntheticDataset } from './synthetic/generate';
import { SeedPhaseError, loadSynthetic } from './synthetic/load';

dotenv.config();

export {
  PECHUGA_POLLO_SEED,
  ARROZ_INTEGRAL_SEED,
  RECETA_POLLO_ID,
  RECETA_POLLO_SEED,
  seedBaseData,
} from '../src/prisma/seed-data';
import { seedBaseData } from '../src/prisma/seed-data';

const SUCCESS_LINE = 'Seeding completado con exito.';
const DEFAULT_BATCH_SIZE = 1000;

export interface SeedDeps {
  /** Única fuente de configuración: nunca se lee process.env dentro de runSeed. */
  env: Record<string, string | undefined>;
  createClient: () => { prisma: any; close(): Promise<void> };
  now: () => Date;
  log: (line: string) => void;
  /** Solo para SEED_DEMO_PASSWORD, una vez. */
  hashPassword: (plain: string) => Promise<string>;
}

export interface SeedResult {
  exitCode: 0 | 1;
  summary: string;
}

// ---------------------------------------------------------------------------
// Datos base: ingredientes, receta, usuario.prueba1-3 y su plan de la semana.
// ---------------------------------------------------------------------------
async function seedBaseUsersAndPlans(prisma: any, log: (line: string) => void): Promise<void> {
  log('Procesando ingredientes y recetas base...');
  const { recipePollo } = await seedBaseData(prisma);

  log('Procesando usuarios...');

  const defaultPasswordHash = await bcrypt.hash('password123', 10);

  const usersToSeed = [
    {
      email: 'usuario.prueba1@nutria.com',
      name: 'Usuario Prueba 1',
      profile: {
        goal: NutritionGoal.LOSE_WEIGHT,
        diet: Diet.ALL,
        excludedIngredients: [],
        cookTimePreference: CookTimePreference.STANDARD
      }
    },
    {
      email: 'usuario.prueba2@nutria.com',
      name: 'Usuario Prueba 2',
      profile: {
        goal: NutritionGoal.GAIN_MUSCLE,
        diet: Diet.VEGETARIAN,
        excludedIngredients: [DietaryRestriction.DAIRY],
        cookTimePreference: CookTimePreference.QUICK
      }
    },
    {
      email: 'usuario.prueba3@nutria.com',
      name: 'Usuario Prueba 3',
      profile: {
        goal: NutritionGoal.MAINTAIN,
        diet: Diet.KETO,
        excludedIngredients: [DietaryRestriction.GLUTEN],
        cookTimePreference: CookTimePreference.GOURMET
      }
    }
  ];

  for (const userData of usersToSeed) {
    // Usuario
    const user = await prisma.user.upsert({
      where: { email: userData.email },
      update: {
        name: userData.name,
        passwordHash: defaultPasswordHash
      },
      create: {
        email: userData.email,
        name: userData.name,
        passwordHash: defaultPasswordHash
      },
    });
    log(`Usuario asegurado: ${user.email}`);

    // Perfil Nutricional
    await prisma.nutritionProfile.upsert({
      where: { userId: user.id },
      update: {
        goal: userData.profile.goal,
        diet: userData.profile.diet,
        excludedIngredients: userData.profile.excludedIngredients,
        cookTimePreference: userData.profile.cookTimePreference
      },
      create: {
        userId: user.id,
        goal: userData.profile.goal,
        diet: userData.profile.diet,
        excludedIngredients: userData.profile.excludedIngredients,
        cookTimePreference: userData.profile.cookTimePreference
      }
    });

    // Plan Alimentario (Semanal)
    // Normalizar a medianoche UTC de la semana actual (Lunes)
    const now = new Date();
    const utcDay = now.getUTCDay();
    // En JS UTC: Domingo = 0. Si es domingo (0), son 6 días atrás; si no, (utcDay - 1) días atrás.
    const diff = utcDay === 0 ? 6 : utcDay - 1;

    const startDate = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - diff,
      0, 0, 0, 0
    ));

    const endDate = new Date(startDate.getTime() + 6 * 24 * 60 * 60 * 1000);

    // Limpiamos planes previos de este usuario de prueba para evitar registros desfasados o duplicados
    await prisma.mealPlan.deleteMany({ where: { userId: user.id } });

    // Creacion de Plan para la semana en curso
    const plan = await prisma.mealPlan.create({
      data: {
        userId: user.id,
        startDate,
        endDate
      }
    });

    const daysOfWeek = [
      DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY,
      DayOfWeek.THURSDAY, DayOfWeek.FRIDAY, DayOfWeek.SATURDAY, DayOfWeek.SUNDAY
    ];

    const almuerzos = [
      'Pollo con Arroz', 'Ensalada Cesar', 'Tacos de Pescado',
      'Pasta al Pesto', 'Wrap de Atun', 'Hamburguesa de Lentejas', 'Salteado de Tofu'
    ];

    const cenas = [
      'Sopa de Verduras', 'Pescado a la Plancha', 'Tortilla de Espinacas',
      'Pizza Integral', 'Pollo al Horno', 'Bowl de Quinoa', 'Cena Ligera'
    ];

    for (let i = 0; i < daysOfWeek.length; i++) {
      const currentDate = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);

      await prisma.mealPlanDay.create({
        data: {
          mealPlanId: plan.id,
          day: daysOfWeek[i],
          date: currentDate,
          meals: {
            create: [
              {
                mealType: MealType.LUNCH,
                title: almuerzos[i],
                nutritionalValues: { calories: 400, protein: 35 },
                recipeId: recipePollo.id // Reutilizamos la misma receta de prueba para simplificar
              },
              {
                mealType: MealType.DINNER,
                title: cenas[i],
                nutritionalValues: { calories: 300, protein: 20 }
              }
            ]
          }
        }
      });
    }
  }
}

function parseVolume(raw: string | undefined, fallback: number, name: string, max?: number): number {
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || (max !== undefined && value > max)) {
    throw new RangeError(`${name} debe ser un entero entre 1 y ${max ?? 'un valor positivo'}.`);
  }
  return value;
}

/** Mensaje seguro para el resumen: nunca el texto de un error desconocido (podría traer credenciales). */
function describeError(error: unknown): string {
  if (error instanceof SeedGuardError || error instanceof SeedPhaseError || error instanceof RangeError) return error.message;
  const code = typeof error === 'object' && error !== null && 'code' in error ? ` (código ${String((error as { code: unknown }).code)})` : '';
  return `error inesperado${code}.`;
}

export async function runSeed(deps: SeedDeps): Promise<SeedResult> {
  const { env, log } = deps;
  log('Iniciando el proceso de seeding...');

  let target: SeedTarget;
  try {
    target = assertSeedTarget(env);
  } catch (error) {
    return { exitCode: 1, summary: `Seed bloqueado antes de escribir: ${describeError(error)}` };
  }
  log(`Destino permitido: ${target.maskedHost}/${target.database}`);

  let client: { prisma: any; close(): Promise<void> } | undefined;
  try {
    client = deps.createClient();
    await seedBaseUsersAndPlans(client.prisma, log);

    if (!target.synthetic) {
      return { exitCode: 0, summary: SUCCESS_LINE };
    }

    const users = parseVolume(env.SEED_SYNTHETIC_USERS, MAX_SYNTHETIC_USERS, 'SEED_SYNTHETIC_USERS', MAX_SYNTHETIC_USERS);
    const batchSize = parseVolume(env.SEED_BATCH_SIZE, DEFAULT_BATCH_SIZE, 'SEED_BATCH_SIZE');
    const now = deps.now();
    log(`Datos sintéticos: ${users} usuarios, lotes de ${batchSize}.`);
    const demoPasswordHash = await deps.hashPassword(env.SEED_DEMO_PASSWORD!);
    const dataset = generateSyntheticDataset({ users, demoPasswordHash, now });
    const startedAt = Date.now();
    const report = await loadSynthetic(client.prisma, { dataset, now, batchSize, log });
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    const counts = Object.entries(report.bulk.counts).map(([table, n]) => `${table}=${n}`).join(', ');

    if (!report.currentWeek.ok) {
      return {
        exitCode: 1,
        summary: `carga masiva OK, current-week FALLÓ (${seconds} s). Conteos: ${counts}. ${report.currentWeek.error.message}`,
      };
    }
    const week = report.currentWeek.counts;
    return {
      exitCode: 0,
      summary: `carga masiva OK, current-week OK (${seconds} s). Conteos: ${counts}. Semana actual de 00001: `
        + `${week.completions} marcas, ${week.shoppingChecks} ítems de compra. ${SUCCESS_LINE}`,
    };
  } catch (error) {
    return { exitCode: 1, summary: `Seed FALLÓ: ${describeError(error)}` };
  } finally {
    await client?.close().catch(() => undefined);
  }
}

function createRealClient(env: Record<string, string | undefined>) {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  return {
    prisma,
    async close() {
      await prisma.$disconnect();
      await pool.end();
    },
  };
}

if (process.env.NODE_ENV !== 'test') {
  const env = { ...process.env };
  runSeed({
    env,
    createClient: () => createRealClient(env),
    now: () => new Date(),
    log: (line) => console.log(line),
    hashPassword: (plain) => bcrypt.hash(plain, 10),
  }).then(({ exitCode, summary }) => {
    (exitCode === 0 ? console.log : console.error)(summary);
    process.exitCode = exitCode;
  }).catch(() => {
    // runSeed no lanza por contrato; si algo escapa, no se imprime su texto (podría incluir credenciales).
    console.error('Seed FALLÓ: error inesperado.');
    process.exitCode = 1;
  });
}
