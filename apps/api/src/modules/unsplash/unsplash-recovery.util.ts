// Recovery mechanism for recipes whose Unsplash download-tracking call never completed
// (design.md 12.6): a process crash/restart between persisting a PENDING image and running its
// trackDownload leaves the row stuck. This is invoked from a standalone script
// (prisma/recover-unsplash-tracking.ts), never from an HTTP path - see design.md 12.6 for why an
// admin endpoint was rejected in favor of the prisma/seed.ts script pattern.
import type { PersistedRecipeImage } from './recipe-image.types';
import { resolveWithBoundedConcurrency } from './unsplash.service';

const UNSPLASH_RECOVERY_DEFAULT_LIMIT = 50;

export type RecoverySummary = {
  found: number;
  succeeded: number;
  failed: Array<{ recipeId: string; providerPhotoId: string }>;
};

type RecoveryPrismaClient = {
  recipe: {
    findMany: (args: unknown) => Promise<Array<{ id: string; image: PersistedRecipeImage }>>;
    update: (args: unknown) => Promise<unknown>;
  };
};

type RecoveryUnsplashService = {
  trackDownload: (persisted: PersistedRecipeImage) => Promise<PersistedRecipeImage>;
};

export async function recoverPendingAndFailedTracking(
  prisma: RecoveryPrismaClient,
  unsplashService: RecoveryUnsplashService,
  options?: { limit?: number },
): Promise<RecoverySummary> {
  const candidates = await prisma.recipe.findMany({
    where: {
      OR: [
        { image: { path: ['tracking', 'status'], equals: 'PENDING' } },
        { image: { path: ['tracking', 'status'], equals: 'FAILED' } },
      ],
    },
    take: options?.limit ?? UNSPLASH_RECOVERY_DEFAULT_LIMIT,
    orderBy: { createdAt: 'asc' },
  });

  const summary: RecoverySummary = { found: candidates.length, succeeded: 0, failed: [] };

  if (candidates.length === 0) {
    return summary;
  }

  // Bounded concurrency (3) reused as-is from unsplash.service.ts - same cap as every other
  // provider-facing batch in this module (design.md 12.6 step 2).
  await resolveWithBoundedConcurrency(candidates, async (recipe) => {
    const result = await unsplashService.trackDownload(recipe.image);
    await prisma.recipe.update({ where: { id: recipe.id }, data: { image: result } });

    if (result.tracking.status === 'SUCCEEDED') {
      summary.succeeded += 1;
    } else {
      summary.failed.push({ recipeId: recipe.id, providerPhotoId: result.providerPhotoId });
    }
  });

  return summary;
}
