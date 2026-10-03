/**
 * Contract under test (does not exist yet — this is the failing-red step of TDD):
 *
 *   apps/api/src/modules/plans/pexels/pexels.service.ts
 *
 * exports (per plan.md section 8 — the concurrency bound is a constant declared alongside
 * the PexelsService class, not an env var/config value):
 *   export const PEXELS_MAX_CONCURRENT_REQUESTS = 3;
 *   export function resolveWithBoundedConcurrency<T, R>(
 *     items: T[],
 *     resolveOne: (item: T) => Promise<R>
 *   ): Promise<R[]>;
 *
 * `pexels.service.ts` does not exist yet either, so this spec is expected to fail red with a
 * "Cannot find module" error, same as the other two pexels specs in this directory.
 *
 * Name chosen for the orchestrator (plan.md section 3 left the exact name open —
 * "resolveImagesForDays (o firma equivalente)" — and plan.md section 9 step 5 explicitly
 * separates "orquestador de batch" as its own piece tested with a fake injected `resolveOne`,
 * independent of the real HTTP adapter): `resolveWithBoundedConcurrency` is the generic,
 * dependency-free orchestration primitive (pure function over an injected `resolveOne`, no
 * Nest/Prisma/network of its own) that `PexelsService.resolveImagesForDays` would build on top
 * of to fan out `resolveImage` calls for a batch of recipe titles. Testing this primitive in
 * isolation (design.md AC15 / plan.md section 9 step 5) means never depending on the real
 * `fetch`-based `resolveImage`, only on a controlled fake `resolveOne`.
 *
 * Return shape decided here (documented because plan.md left the "forma exacta de retorno" to
 * the tester, per the task instructions): `resolveWithBoundedConcurrency` returns a
 * `Promise<R[]>` with exactly one entry per input item, in the SAME ORDER as the input `items`
 * array — regardless of the order in which individual `resolveOne` calls actually settle. This
 * mirrors `Promise.all`'s ordering guarantee, which is the most natural/least surprising shape
 * for callers (e.g. `resolveImagesForDays` mapping results back onto their originating recipe).
 *
 * Per design.md section 4, a single `resolveImage` call is designed to NEVER throw — it always
 * resolves to `RecipeImage | null`. The rejection-hardening case below is therefore explicitly
 * optional/non-blocking per the task instructions: it documents defense-in-depth against a
 * `resolveOne` that rejects due to a programming error, not a required behavior of design.md.
 */
import { PEXELS_MAX_CONCURRENT_REQUESTS, resolveWithBoundedConcurrency } from './pexels.service';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('resolveWithBoundedConcurrency', () => {
  it('never has more than PEXELS_MAX_CONCURRENT_REQUESTS resolveOne calls in flight at the same time', async () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    const deferreds = items.map(() => createDeferred<number>());
    let inFlight = 0;
    let maxObservedInFlight = 0;

    const resolveOne = jest.fn((item: number) => {
      inFlight++;
      maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
      const index = items.indexOf(item);
      return deferreds[index].promise.finally(() => {
        inFlight--;
      });
    });

    const resultPromise = resolveWithBoundedConcurrency(items, resolveOne);

    // Let the orchestrator's microtasks run so it has a chance to kick off its first batch.
    await Promise.resolve();
    await Promise.resolve();

    expect(inFlight).toBeLessThanOrEqual(PEXELS_MAX_CONCURRENT_REQUESTS);
    expect(resolveOne).toHaveBeenCalledTimes(PEXELS_MAX_CONCURRENT_REQUESTS);

    // Resolve the in-flight calls one at a time; concurrency must never exceed the bound,
    // even as completed slots free up capacity for the remaining queued items.
    for (let i = 0; i < deferreds.length; i++) {
      deferreds[i].resolve(items[i] * 10);
      await Promise.resolve();
      await Promise.resolve();
      expect(inFlight).toBeLessThanOrEqual(PEXELS_MAX_CONCURRENT_REQUESTS);
    }

    await resultPromise;

    expect(maxObservedInFlight).toBe(PEXELS_MAX_CONCURRENT_REQUESTS);
    expect(resolveOne).toHaveBeenCalledTimes(items.length);
  });

  it('resolves all items before returning, with one result entry per input item in input order (no promise is lost)', async () => {
    const items = ['first', 'second', 'third', 'fourth'];
    const deferreds = items.map(() => createDeferred<string>());

    const resolveOne = jest.fn((item: string) => {
      const index = items.indexOf(item);
      return deferreds[index].promise;
    });

    const resultPromise = resolveWithBoundedConcurrency(items, resolveOne);

    // Resolve out of completion order to prove results are mapped by input position, not by
    // settlement order.
    deferreds[3].resolve('fourth-resolved');
    deferreds[1].resolve('second-resolved');
    deferreds[0].resolve('first-resolved');
    deferreds[2].resolve('third-resolved');

    const result = await resultPromise;

    expect(result).toEqual(['first-resolved', 'second-resolved', 'third-resolved', 'fourth-resolved']);
  });

  it('never calls resolveOne for more items than were provided, and settles with an empty result for an empty input', async () => {
    const resolveOne = jest.fn(() => Promise.resolve('unused'));

    const result = await resolveWithBoundedConcurrency([], resolveOne);

    expect(result).toEqual([]);
    expect(resolveOne).not.toHaveBeenCalled();
  });

  // Optional/non-blocking (see header comment): design.md guarantees resolveImage itself never
  // throws, so this only documents defense-in-depth for a resolveOne that rejects due to a bug.
  it('does not let a single resolveOne rejection propagate out of the orchestrator as an unhandled rejection', async () => {
    const items = ['a', 'b', 'c'];

    const resolveOne = jest.fn((item: string) => {
      if (item === 'b') {
        return Promise.reject(new Error('unexpected programming error in resolveOne'));
      }
      return Promise.resolve(`${item}-ok`);
    });

    await expect(resolveWithBoundedConcurrency(items, resolveOne)).resolves.toBeDefined();
  });
});
