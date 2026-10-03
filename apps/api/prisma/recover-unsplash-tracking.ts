// Operational recovery script for recipes stuck with image.tracking.status PENDING/FAILED
// (design.md 12.6) - a process crash/restart between persisting the image and running its
// Unsplash download-tracking call leaves that gap. Run manually, like prisma/seed.ts; it is
// not a cron, not a hook, not an HTTP endpoint.
//
// How to run it:
//   pnpm --filter api unsplash:recover-tracking [-- --limit=100]
// or directly:
//   npx tsx prisma/recover-unsplash-tracking.ts [--limit=100]
//
// Required env vars: DATABASE_URL, UNSPLASH_ACCESS_KEY.
// Without UNSPLASH_ACCESS_KEY every candidate found is simply re-marked FAILED (same behavior
// as the rest of the Unsplash module when the key is missing - see unsplash.service.ts) rather
// than throwing, so it is safe to run without it, just not useful.
//
// Safe to run more than once: the query only ever selects PENDING/FAILED rows, so a row already
// SUCCEEDED (from this run or a previous one) is excluded from every subsequent run and never
// reprocessed.
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

// Minimal ConfigService stand-in (plain env lookup) - UnsplashService only ever calls
// `configService.get<string>(key)`, so a full Nest DI context isn't needed for a standalone
// script invoked outside the app.
function createMinimalConfigService() {
  return { get: (key: string) => process.env[key] } as unknown as import('@nestjs/config').ConfigService;
}

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
