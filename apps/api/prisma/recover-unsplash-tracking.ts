// Script manual para reintentar los registros de uso de Unsplash que quedaron PENDING/FAILED.
// Uso: pnpm --filter api unsplash:recover-tracking [-- --limit=N]
// Necesita DATABASE_URL y UNSPLASH_ACCESS_KEY. Se puede correr varias veces sin problema.
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { UnsplashService } from '../src/modules/unsplash/unsplash.service';
import { recoverPendingAndFailedTracking } from '../src/modules/unsplash/unsplash-recovery.util';

dotenv.config();

function getPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  return { prisma, pool };
}

// UnsplashService sólo usa configService.get(), así que alcanza con leer las variables de entorno.
function createMinimalConfigService() {
  return { get: (key: string) => process.env[key] } as unknown as import('@nestjs/config').ConfigService;
}

// Lee el --limit=N opcional (cuántas recetas procesar por corrida).
function parseLimitArg(): number | undefined {
  const arg = process.argv.find((a) => a.startsWith('--limit='));
  if (!arg) {
    return undefined;
  }
  const value = Number.parseInt(arg.split('=')[1], 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

async function main() {
  console.log('Iniciando recuperación de tracking de imágenes de Unsplash...\n');
  const { prisma, pool } = getPrismaClient();
  const unsplashService = new UnsplashService(createMinimalConfigService());

  try {
    const limit = parseLimitArg();
    const summary = await recoverPendingAndFailedTracking(prisma, unsplashService, limit ? { limit } : undefined);

    console.log(`Recetas encontradas (PENDING/FAILED): ${summary.found}`);
    console.log(`Recuperadas (SUCCEEDED en esta corrida): ${summary.succeeded}`);
    console.log(`Siguen FAILED: ${summary.failed.length}`);
    for (const { recipeId, providerPhotoId } of summary.failed) {
      console.log(`  - recipeId=${recipeId} providerPhotoId=${providerPhotoId}`);
    }

    console.log('\nRecuperación completada.');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (process.env.NODE_ENV !== 'test') {
  main().catch((e) => {
    console.error('Ocurrió un error durante la recuperación:\n', e);
    process.exit(1);
  });
}
