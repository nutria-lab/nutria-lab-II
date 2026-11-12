/**
 * NUT-114 — Synthetic users carry no role/permission fields (Block 1, TDD red first).
 *
 * Expected API: generate.ts `generateSyntheticDataset(opts)` returns `users` whose objects have EXACTLY the keys
 * id, email, name, passwordHash. If the schema ever gains a role/permission column, the seeder must not set it
 * (DB default applies) and this test fails on any extra key.
 */
import { generateSyntheticDataset } from '../../../prisma/synthetic/generate';

const NOW = new Date('2026-11-11T15:00:00.000Z');
const DEMO_HASH = '$2b$04$QL597mIXc6JauPDhUTUPR.uUjvBlSb9NxRWu5xn4egJ78KrMILTNK';

describe('synthetic users — permissions', () => {
  it('every generated user has exactly id, email, name, passwordHash', () => {
    const { users } = generateSyntheticDataset({ users: 200, demoPasswordHash: DEMO_HASH, now: NOW });
    expect(users).toHaveLength(200);
    for (const user of users) {
      expect(Object.keys(user).sort()).toEqual(['email', 'id', 'name', 'passwordHash']);
    }
  });
});
