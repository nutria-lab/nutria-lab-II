// Contract under test (does not exist yet, red step):
// apps/api/src/modules/unsplash/unsplash-recovery.util.ts (design.md 12.6, plan.md 12.4).
//
// export async function recoverPendingAndFailedTracking(
//   prisma: { recipe: { findMany: Function; update: Function } },
//   unsplashService: { trackDownload: (persisted: PersistedRecipeImage) => Promise<PersistedRecipeImage> },
//   options?: { limit?: number },
// ): Promise<RecoverySummary>
//
// RecoverySummary = { found: number; succeeded: number; failed: Array<{ recipeId: string; providerPhotoId: string }> }
//
// Same pattern as seedBaseData/seed.spec.ts: a flat, hand-rolled `prisma` mock (findMany/update as
// jest.fn()), never a real PrismaClient, never real network. `unsplashService.trackDownload` is a
// plain jest.fn() standing in for UnsplashService - this spec never instantiates the real service.
import type { PersistedRecipeImage } from './recipe-image.types';

const UNSPLASH_RECOVERY_DEFAULT_LIMIT = 50;
const UNSPLASH_RECOVERY_MAX_CONCURRENT = 3;

function persistedImage(overrides: Partial<PersistedRecipeImage> = {}): PersistedRecipeImage {
  return {
    provider: 'UNSPLASH',
    providerPhotoId: 'LBI7cgq3pbM',
    imageUrl: 'https://images.unsplash.com/photo-123?ixid=abc',
    sourceUrl: 'https://unsplash.com/photos/LBI7cgq3pbM?utm_source=nutria&utm_medium=referral',
    photographer: 'Jane Doe',
    photographerUrl: 'https://unsplash.com/@janedoe?utm_source=nutria&utm_medium=referral',
    alt: 'Imagen ilustrativa de Pollo con Arroz',
    query: 'pollo con arroz food recipe',
    retrievedAt: '2026-09-30T12:00:00.000Z',
    tracking: {
      status: 'PENDING',
      lastAttemptAt: null,
      trackingUrl: 'https://api.unsplash.com/photos/LBI7cgq3pbM/download?ixid=abc',
    },
    ...overrides,
  };
}

function recipeRow(id: string, image: PersistedRecipeImage, createdAt = new Date('2026-09-01T00:00:00.000Z')) {
  return { id, image, createdAt };
}

function createPrismaMock(rows: ReturnType<typeof recipeRow>[]) {
  return {
    recipe: {
      findMany: jest.fn().mockResolvedValue(rows),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'updated', ...data })),
    },
  };
}

function createUnsplashServiceMock() {
  return { trackDownload: jest.fn() };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('recoverPendingAndFailedTracking', () => {
  it('queries recipes whose image.tracking.status is PENDING or FAILED, with default limit and createdAt asc order', async () => {
    const prisma = createPrismaMock([]);
    const unsplashService = createUnsplashServiceMock();
    const { recoverPendingAndFailedTracking } = await import('./unsplash-recovery.util');

    await recoverPendingAndFailedTracking(prisma as any, unsplashService as any);

    expect(prisma.recipe.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.recipe.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { image: { path: ['tracking', 'status'], equals: 'PENDING' } },
          { image: { path: ['tracking', 'status'], equals: 'FAILED' } },
        ],
      },
      take: UNSPLASH_RECOVERY_DEFAULT_LIMIT,
      orderBy: { createdAt: 'asc' },
    });
  });

  it('uses options.limit for `take` instead of the default when provided', async () => {
    const prisma = createPrismaMock([]);
    const unsplashService = createUnsplashServiceMock();
    const { recoverPendingAndFailedTracking } = await import('./unsplash-recovery.util');

    await recoverPendingAndFailedTracking(prisma as any, unsplashService as any, { limit: 10 });

    expect(prisma.recipe.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
  });

  it('invokes trackDownload once per recipe found, passing that exact recipe image', async () => {
    const imageA = persistedImage({ providerPhotoId: 'aaa' });
    const imageB = persistedImage({ providerPhotoId: 'bbb', tracking: { status: 'FAILED', lastAttemptAt: '2026-09-30T00:00:00.000Z', trackingUrl: persistedImage().tracking.trackingUrl } });
    const rows = [recipeRow('recipe-a', imageA), recipeRow('recipe-b', imageB)];
    const prisma = createPrismaMock(rows);
    const unsplashService = createUnsplashServiceMock();
    unsplashService.trackDownload.mockImplementation((image: PersistedRecipeImage) => Promise.resolve(image));
    const { recoverPendingAndFailedTracking } = await import('./unsplash-recovery.util');

    await recoverPendingAndFailedTracking(prisma as any, unsplashService as any);

    expect(unsplashService.trackDownload).toHaveBeenCalledTimes(2);
    expect(unsplashService.trackDownload).toHaveBeenCalledWith(imageA);
    expect(unsplashService.trackDownload).toHaveBeenCalledWith(imageB);
  });

  it('persists a SUCCEEDED trackDownload result with prisma.recipe.update({ where: { id }, data: { image } })', async () => {
    const pending = persistedImage();
    const succeeded = persistedImage({
      tracking: { status: 'SUCCEEDED', lastAttemptAt: '2026-10-01T00:00:00.000Z', trackingUrl: pending.tracking.trackingUrl },
    });
    const rows = [recipeRow('recipe-1', pending)];
    const prisma = createPrismaMock(rows);
    const unsplashService = createUnsplashServiceMock();
    unsplashService.trackDownload.mockResolvedValue(succeeded);
    const { recoverPendingAndFailedTracking } = await import('./unsplash-recovery.util');

    await recoverPendingAndFailedTracking(prisma as any, unsplashService as any);

    expect(prisma.recipe.update).toHaveBeenCalledTimes(1);
    expect(prisma.recipe.update).toHaveBeenCalledWith({
      where: { id: 'recipe-1' },
      data: { image: succeeded },
    });
  });

  it('persists a FAILED trackDownload result the same way as a SUCCEEDED one', async () => {
    const pending = persistedImage();
    const failed = persistedImage({
      tracking: { status: 'FAILED', lastAttemptAt: '2026-10-01T00:00:00.000Z', trackingUrl: pending.tracking.trackingUrl },
    });
    const rows = [recipeRow('recipe-1', pending)];
    const prisma = createPrismaMock(rows);
    const unsplashService = createUnsplashServiceMock();
    unsplashService.trackDownload.mockResolvedValue(failed);
    const { recoverPendingAndFailedTracking } = await import('./unsplash-recovery.util');

    await recoverPendingAndFailedTracking(prisma as any, unsplashService as any);

    expect(prisma.recipe.update).toHaveBeenCalledTimes(1);
    expect(prisma.recipe.update).toHaveBeenCalledWith({
      where: { id: 'recipe-1' },
      data: { image: failed },
    });
  });

  it('never has more than 3 trackDownload calls in flight at the same time across a batch of 7 candidates', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => recipeRow(`recipe-${i}`, persistedImage({ providerPhotoId: `id-${i}` })));
    const prisma = createPrismaMock(rows);
    const unsplashService = createUnsplashServiceMock();

    const deferreds = rows.map(() => createDeferred<PersistedRecipeImage>());
    let inFlight = 0;
    let maxObservedInFlight = 0;
    unsplashService.trackDownload.mockImplementation((image: PersistedRecipeImage) => {
      inFlight++;
      maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
      const index = rows.findIndex((r) => r.image.providerPhotoId === image.providerPhotoId);
      return deferreds[index].promise.finally(() => {
        inFlight--;
      });
    });

    const { recoverPendingAndFailedTracking } = await import('./unsplash-recovery.util');
    const resultPromise = recoverPendingAndFailedTracking(prisma as any, unsplashService as any);

    await Promise.resolve();
    await Promise.resolve();
    expect(inFlight).toBeLessThanOrEqual(UNSPLASH_RECOVERY_MAX_CONCURRENT);
    expect(unsplashService.trackDownload).toHaveBeenCalledTimes(UNSPLASH_RECOVERY_MAX_CONCURRENT);

    for (let i = 0; i < deferreds.length; i++) {
      deferreds[i].resolve(persistedImage({ tracking: { status: 'SUCCEEDED', lastAttemptAt: 'x', trackingUrl: rows[i].image.tracking.trackingUrl } }));
      await Promise.resolve();
      await Promise.resolve();
      expect(inFlight).toBeLessThanOrEqual(UNSPLASH_RECOVERY_MAX_CONCURRENT);
    }

    await resultPromise;

    expect(maxObservedInFlight).toBe(UNSPLASH_RECOVERY_MAX_CONCURRENT);
    expect(unsplashService.trackDownload).toHaveBeenCalledTimes(rows.length);
  });

  it('returns a summary of how many were found, how many succeeded, and which failed (with their providerPhotoId and recipeId)', async () => {
    const succeededPending = persistedImage({ providerPhotoId: 'succeeded-1' });
    const failedPending = persistedImage({ providerPhotoId: 'failed-1' });
    const rows = [recipeRow('recipe-ok', succeededPending), recipeRow('recipe-bad', failedPending)];
    const prisma = createPrismaMock(rows);
    const unsplashService = createUnsplashServiceMock();
    unsplashService.trackDownload.mockImplementation((image: PersistedRecipeImage) => {
      const outcome = image.providerPhotoId === 'succeeded-1' ? 'SUCCEEDED' : 'FAILED';
      return Promise.resolve(persistedImage({ ...image, tracking: { status: outcome, lastAttemptAt: 'x', trackingUrl: image.tracking.trackingUrl } }));
    });
    const { recoverPendingAndFailedTracking } = await import('./unsplash-recovery.util');

    const summary = await recoverPendingAndFailedTracking(prisma as any, unsplashService as any);

    expect(summary.found).toBe(2);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]).toEqual(
      expect.objectContaining({ recipeId: 'recipe-bad', providerPhotoId: 'failed-1' }),
    );
  });

  it('calls neither trackDownload nor update, and returns a zeroed summary, when no PENDING/FAILED recipe is found', async () => {
    const prisma = createPrismaMock([]);
    const unsplashService = createUnsplashServiceMock();
    const { recoverPendingAndFailedTracking } = await import('./unsplash-recovery.util');

    const summary = await recoverPendingAndFailedTracking(prisma as any, unsplashService as any);

    expect(unsplashService.trackDownload).not.toHaveBeenCalled();
    expect(prisma.recipe.update).not.toHaveBeenCalled();
    expect(summary).toEqual({ found: 0, succeeded: 0, failed: [] });
  });
});
