// Recuperación manual de los registros de uso que quedaron PENDING o FAILED.
// Sólo se llama desde el script prisma/recover-unsplash-tracking.ts, nunca desde un endpoint.
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

// Vuelve a intentar el registro de uso de esas recetas y guarda el nuevo estado.
// Las SUCCEEDED nunca se reprocesan porque la consulta sólo trae PENDING y FAILED.
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

  // Recetas con el mismo trackingUrl son la misma asociación (ej.: una receta conservada en una
  // versión nueva del plan): se manda un solo evento y el resultado se escribe en todas.
  const rowsByTrackingUrl = new Map<string, Array<{ id: string; image: PersistedRecipeImage }>>();
  for (const recipe of candidates) {
    const rows = rowsByTrackingUrl.get(recipe.image.tracking.trackingUrl) ?? [];
    rows.push(recipe);
    rowsByTrackingUrl.set(recipe.image.tracking.trackingUrl, rows);
  }

  await resolveWithBoundedConcurrency(Array.from(rowsByTrackingUrl.values()), async (rows) => {
    const { tracking } = await unsplashService.trackDownload(rows[0].image);

    for (const recipe of rows) {
      await prisma.recipe.update({ where: { id: recipe.id }, data: { image: { ...recipe.image, tracking } } });

      if (tracking.status === 'SUCCEEDED') {
        summary.succeeded += 1;
      } else {
        summary.failed.push({ recipeId: recipe.id, providerPhotoId: recipe.image.providerPhotoId });
      }
    }
  });

  return summary;
}
