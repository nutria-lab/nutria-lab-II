// `resolveWithBoundedConcurrency` is a generic pool primitive with no provider knowledge
// (design.md D3) — unchanged by the Pexels -> Unsplash swap. Only the constant name/import
// path change (plan.md 11.2: UNSPLASH_MAX_CONCURRENT_REQUESTS, value still 3).
import { UNSPLASH_MAX_CONCURRENT_REQUESTS, resolveWithBoundedConcurrency } from './unsplash.service';

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
  it('never has more than UNSPLASH_MAX_CONCURRENT_REQUESTS resolveOne calls in flight at the same time', async () => {
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

    await Promise.resolve();
    await Promise.resolve();

    expect(inFlight).toBeLessThanOrEqual(UNSPLASH_MAX_CONCURRENT_REQUESTS);
    expect(resolveOne).toHaveBeenCalledTimes(UNSPLASH_MAX_CONCURRENT_REQUESTS);

    for (let i = 0; i < deferreds.length; i++) {
      deferreds[i].resolve(items[i] * 10);
      await Promise.resolve();
      await Promise.resolve();
      expect(inFlight).toBeLessThanOrEqual(UNSPLASH_MAX_CONCURRENT_REQUESTS);
    }

    await resultPromise;

    expect(maxObservedInFlight).toBe(UNSPLASH_MAX_CONCURRENT_REQUESTS);
    expect(resolveOne).toHaveBeenCalledTimes(items.length);
  });

  it('resolves all items before returning, with one result entry per input item in input order', async () => {
    const items = ['first', 'second', 'third', 'fourth'];
    const deferreds = items.map(() => createDeferred<string>());

    const resolveOne = jest.fn((item: string) => {
      const index = items.indexOf(item);
      return deferreds[index].promise;
    });

    const resultPromise = resolveWithBoundedConcurrency(items, resolveOne);

    // Resolve out of completion order to prove results are mapped by input position.
    deferreds[3].resolve('fourth-resolved');
    deferreds[1].resolve('second-resolved');
    deferreds[0].resolve('first-resolved');
    deferreds[2].resolve('third-resolved');

    const result = await resultPromise;

    expect(result).toEqual(['first-resolved', 'second-resolved', 'third-resolved', 'fourth-resolved']);
  });

  it('never calls resolveOne for an empty input, and settles with an empty result', async () => {
    const resolveOne = jest.fn(() => Promise.resolve('unused'));

    const result = await resolveWithBoundedConcurrency([], resolveOne);

    expect(result).toEqual([]);
    expect(resolveOne).not.toHaveBeenCalled();
  });

  // Defense-in-depth: design.md guarantees resolveImage itself never throws, so this only
  // covers a resolveOne that rejects due to a programming error.
  it('does not let a single resolveOne rejection propagate out of the orchestrator', async () => {
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
