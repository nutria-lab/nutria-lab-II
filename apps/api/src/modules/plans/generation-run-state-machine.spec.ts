/**
 * Contract under test (does not exist yet — this is the failing-red step of TDD):
 *
 *   apps/api/src/modules/plans/generation-run-state-machine.ts
 *
 * exports:
 *   isValidTransition(from: GenerationStatus, to: GenerationStatus): boolean
 *
 * implementing EXACTLY the table in design.md section 7:
 *
 *   PENDING          -> READY_FOR_REVIEW | SUCCEEDED | REJECTED | FAILED
 *   READY_FOR_REVIEW -> CONFIRMED | EXPIRED | REJECTED
 *   CONFIRMED        -> (none, terminal)
 *   SUCCEEDED        -> (none, terminal)
 *   REJECTED         -> (none, terminal)
 *   FAILED           -> (none, terminal)
 *   EXPIRED          -> (none, terminal)
 *
 * `GenerationStatus` is sourced from `@/generated/prisma/client` when available.
 * As of this test's authoring, the `GenerationRun` Prisma model has not been created yet
 * (it is pending TL approval of the migration — see design.md section 5), so the generated
 * Prisma client does not export this enum. Until that model exists, this spec defines a
 * local temporary type with the same 7 values instead of importing from the generated client.
 * TODO: once `@/generated/prisma/client` exports `GenerationStatus`, switch this import back
 * to the generated enum and delete the local temporary type below.
 */
import { isValidTransition } from './generation-run-state-machine';

type GenerationStatus =
  | 'PENDING'
  | 'READY_FOR_REVIEW'
  | 'CONFIRMED'
  | 'SUCCEEDED'
  | 'REJECTED'
  | 'FAILED'
  | 'EXPIRED';

const ALL_STATUSES: GenerationStatus[] = [
  'PENDING',
  'READY_FOR_REVIEW',
  'CONFIRMED',
  'SUCCEEDED',
  'REJECTED',
  'FAILED',
  'EXPIRED'
];

const TERMINAL_STATUSES: GenerationStatus[] = ['CONFIRMED', 'SUCCEEDED', 'REJECTED', 'FAILED', 'EXPIRED'];

describe('generation-run-state-machine isValidTransition', () => {
  describe('PENDING as origin', () => {
    it.each<GenerationStatus>(['READY_FOR_REVIEW', 'SUCCEEDED', 'REJECTED', 'FAILED'])(
      'allows PENDING -> %s',
      (to) => {
        expect(isValidTransition('PENDING', to)).toBe(true);
      }
    );

    it.each<GenerationStatus>(['CONFIRMED', 'EXPIRED', 'PENDING'])('rejects PENDING -> %s', (to) => {
      expect(isValidTransition('PENDING', to)).toBe(false);
    });

    it('explicitly rejects PENDING -> CONFIRMED directly (design.md AC5 negative case)', () => {
      expect(isValidTransition('PENDING', 'CONFIRMED')).toBe(false);
    });
  });

  describe('READY_FOR_REVIEW as origin', () => {
    it.each<GenerationStatus>(['CONFIRMED', 'EXPIRED', 'REJECTED'])('allows READY_FOR_REVIEW -> %s', (to) => {
      expect(isValidTransition('READY_FOR_REVIEW', to)).toBe(true);
    });

    it.each<GenerationStatus>(['SUCCEEDED', 'FAILED', 'PENDING', 'READY_FOR_REVIEW'])(
      'rejects READY_FOR_REVIEW -> %s',
      (to) => {
        expect(isValidTransition('READY_FOR_REVIEW', to)).toBe(false);
      }
    );
  });

  describe('terminal states have no valid outgoing transitions', () => {
    for (const from of TERMINAL_STATUSES) {
      it.each(ALL_STATUSES)(`rejects ${from} -> %s, including back to PENDING`, (to) => {
        expect(isValidTransition(from, to)).toBe(false);
      });
    }

    it('explicitly rejects any exit from a terminal state back to PENDING (design.md AC5 negative case)', () => {
      for (const from of TERMINAL_STATUSES) {
        expect(isValidTransition(from, 'PENDING')).toBe(false);
      }
    });
  });
});
