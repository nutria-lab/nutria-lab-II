import { canonicalJson, computeIdempotencyKeyHash } from './idempotency-hash.util';

describe('canonicalJson utility', () => {
  it('should produce the same serialization regardless of object key order', () => {
    const a = { b: 2, a: 1, c: { z: 26, y: 25 } };
    const b = { a: 1, c: { y: 25, z: 26 }, b: 2 };

    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('should produce a deterministic string for the same input', () => {
    const value = { userId: 'user-1', kind: 'MEAL_PLAN_INITIAL', requestSnapshot: { weekStart: '2026-09-21' } };

    expect(canonicalJson(value)).toBe(canonicalJson(value));
  });
});

describe('computeIdempotencyKeyHash utility', () => {
  const baseInput = {
    userId: 'user-1',
    kind: 'MEAL_PLAN_INITIAL',
    requestSnapshot: {
      weekStart: '2026-09-21',
      promptVersion: '1.0.0',
      schemaVersion: '1.0.0'
    }
  };

  it('should return the same hash for the same input (determinism)', () => {
    const hash1 = computeIdempotencyKeyHash(baseInput);
    const hash2 = computeIdempotencyKeyHash(baseInput);

    expect(hash1).toBe(hash2);
  });

  it('should return the same hash regardless of requestSnapshot key order (canonical JSON)', () => {
    const inputWithReorderedSnapshot = {
      userId: 'user-1',
      kind: 'MEAL_PLAN_INITIAL',
      requestSnapshot: {
        schemaVersion: '1.0.0',
        weekStart: '2026-09-21',
        promptVersion: '1.0.0'
      }
    };

    const hash1 = computeIdempotencyKeyHash(baseInput);
    const hash2 = computeIdempotencyKeyHash(inputWithReorderedSnapshot);

    expect(hash1).toBe(hash2);
  });

  it('should return a different hash when any requestSnapshot field changes', () => {
    const changedInput = {
      ...baseInput,
      requestSnapshot: {
        ...baseInput.requestSnapshot,
        weekStart: '2026-09-28'
      }
    };

    const hash1 = computeIdempotencyKeyHash(baseInput);
    const hash2 = computeIdempotencyKeyHash(changedInput);

    expect(hash1).not.toBe(hash2);
  });

  it('should return a different hash for a different userId with the same requestSnapshot', () => {
    const otherUserInput = { ...baseInput, userId: 'user-2' };

    const hash1 = computeIdempotencyKeyHash(baseInput);
    const hash2 = computeIdempotencyKeyHash(otherUserInput);

    expect(hash1).not.toBe(hash2);
  });

  it('should return a different hash for a different kind with the same requestSnapshot', () => {
    const otherKindInput = { ...baseInput, kind: 'MEAL_PLAN_REGENERATION' };

    const hash1 = computeIdempotencyKeyHash(baseInput);
    const hash2 = computeIdempotencyKeyHash(otherKindInput);

    expect(hash1).not.toBe(hash2);
  });
});
