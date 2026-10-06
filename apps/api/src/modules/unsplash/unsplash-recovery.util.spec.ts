import type { PersistedRecipeImage } from './recipe-image.types';
import { pendingPersistedImage, unsplashPhoto } from './unsplash-search.fixture';

const UNSPLASH_RECOVERY_DEFAULT_LIMIT = 50;
const UNSPLASH_RECOVERY_MAX_CONCURRENT = 3;

// Cada foto tiene su propio download_location, como lo devuelve Unsplash.
function persistedImage(overrides: Partial<PersistedRecipeImage> = {}): PersistedRecipeImage {
  const photo = unsplashPhoto(overrides.providerPhotoId ?? 'LBI7cgq3pbM');
  const base = pendingPersistedImage({ providerPhotoId: photo.id, tracking: { trackingUrl: photo.links.download_location } });
  return { ...base, ...overrides };
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
  it('sends a single usage event for rows sharing a trackingUrl (a recipe preserved into a new plan version) and writes the result to each row', async () => {
    const original = persistedImage({ providerPhotoId: 'sharedPhoto1', alt: 'Versión original' });
    const copy = { ...original, alt: 'Copia en la versión nueva', tracking: { ...original.tracking, status: 'FAILED' as const } };
    const other = persistedImage({ providerPhotoId: 'otherPhoto02' });
    const prisma = createPrismaMock([recipeRow('recipe-old', original), recipeRow('recipe-new', copy), recipeRow('recipe-other', other)]);
    const unsplashService = createUnsplashServiceMock();
    unsplashService.trackDownload.mockImplementation((image: PersistedRecipeImage) =>
      Promise.resolve({ ...image, tracking: { ...image.tracking, status: 'SUCCEEDED', lastAttemptAt: '2026-10-03T12:00:00.000Z' } }),
    );
    const { recoverPendingAndFailedTracking } = await import('./unsplash-recovery.util');

    const summary = await recoverPendingAndFailedTracking(prisma as any, unsplashService as any);

    expect(unsplashService.trackDownload).toHaveBeenCalledTimes(2);
    expect(prisma.recipe.update).toHaveBeenCalledTimes(3);
    const written = Object.fromEntries(prisma.recipe.update.mock.calls.map(([args]: any) => [args.where.id, args.data.image]));
    expect(written['recipe-old'].tracking.status).toBe('SUCCEEDED');
    expect(written['recipe-new'].tracking.status).toBe('SUCCEEDED');
    // Cada fila conserva sus campos públicos; sólo se comparte el resultado del tracking.
    expect(written['recipe-new'].alt).toBe('Copia en la versión nueva');
    expect(summary).toEqual({ found: 3, succeeded: 3, failed: [] });
  });
});
