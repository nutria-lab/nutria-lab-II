import { 
  PrismaClient, 
  NutritionGoal, 
  Diet, 
  DietaryRestriction, 
  CookTimePreference, 
  DayOfWeek, 
  MealType,
  IngredientType
} from '../src/generated/prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString }); // Creamos un pool de conexiones, para que sea mas rapido
const adapter = new PrismaPg(pool); // Metodo en donde le paso el pool y prisma se puede conectar
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Iniciando el proceso de seeding...\n');

  // ---------------------------------------------------------------------------
  // 1. INGREDIENTES Y RECETAS (Datos base)
  // ---------------------------------------------------------------------------
  console.log('Procesando ingredientes y recetas base...');
  
  await prisma.ingredient.upsert({
    where: { name: 'Pechuga de Pollo' },
    update: {},
    create: {
      name: 'Pechuga de Pollo',
      type: IngredientType.MEAT,
      nutritionalValues: { calories: 165, protein: 31, carbs: 0, fat: 3.6 }
    }
  });

  await prisma.ingredient.upsert({
    where: { name: 'Arroz Integral' },
    update: {},
    create: {
      name: 'Arroz Integral',
      type: IngredientType.GRAIN,
      nutritionalValues: { calories: 111, protein: 2.6, carbs: 23, fat: 0.9 }
    }
  });

  // Fijamos un UUID inventado pero valido para nuestra receta de prueba
  const RECETA_POLLO_ID = '11111111-1111-1111-1111-111111111111';

  const recipePollo = await prisma.recipe.upsert({
    where: { id: RECETA_POLLO_ID },
    update: {
      title: 'Pollo con Arroz',
      description: 'Pechuga de pollo con arroz integral',
      prepMinutes: 10,
      cookMinutes: 20,
      ingredients: [
        { name: 'Pechuga de Pollo', quantity: 200, unit: 'g' },
        { name: 'Arroz Integral', quantity: 100, unit: 'g' },
      ],
      instructions: ['Cortar el pollo', 'Cocinar el pollo', 'Hervir el arroz'],
    },
    create: {
      id: RECETA_POLLO_ID,
      title: 'Pollo con Arroz',
      description: 'Pechuga de pollo con arroz integral',
      prepMinutes: 10,
      cookMinutes: 20,
      ingredients: [
        { name: 'Pechuga de Pollo', quantity: 200, unit: 'g' },
        { name: 'Arroz Integral', quantity: 100, unit: 'g' },
      ],
      instructions: ['Cortar el pollo', 'Cocinar el pollo', 'Hervir el arroz'],
    }
  });

  // ---------------------------------------------------------------------------
  // 2. CREACION DE USUARIOS
  // ---------------------------------------------------------------------------
  console.log('Procesando usuarios...');
  
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
    // 2.1 Usuario
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
    console.log(`Usuario asegurado: ${user.email}`);

    // 2.2 Perfil Nutricional
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

    // 2.3 Plan Alimentario (Semanal)
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    // En JS: Domingo = 0. Si es domingo (0), son 6 días atrás; si no, (day - 1) días atrás.
    const day = startDate.getDay();
    const diff = day === 0 ? 6 : day - 1;

    startDate.setDate(startDate.getDate() - diff);

    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);

    // Upsert de Plan
    const plan = await prisma.mealPlan.upsert({
      where: {
        userId_startDate: {
          userId: user.id,
          startDate: startDate
        }
      },
      update: { endDate },
      create: {
        userId: user.id,
        startDate,
        endDate
      }
    });

    // Dias y Comidas (Limpiamos y recreamos para evitar duplicados complejos de manejar en arrays)
    await prisma.mealPlanDay.deleteMany({ where: { mealPlanId: plan.id } });

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
      const currentDate = new Date(startDate);
      currentDate.setDate(startDate.getDate() + i);

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

  console.log('\nSeeding completado con exito.');
}

main()
  .catch((e) => {
    console.error('Ocurrio un error durante el seeding:\n', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
