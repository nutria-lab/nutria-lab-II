/**
 * NUT-114 — Synthetic credentials (Block 1, TDD red first). Uses real bcrypt.
 *
 * Expected API (see seed-synthetic.generate.spec.ts for the full generator contract):
 *   generate.ts: export const SYNTHETIC_NO_LOGIN_HASH = '!synthetic-no-login';
 *                export function generateSyntheticDataset(opts: { users; demoPasswordHash; now; catalog? }): SyntheticDataset;
 *   Only users[0] (demo.seed.00001) receives `demoPasswordHash` (computed once by the seeder from SEED_DEMO_PASSWORD);
 *   every other user gets SYNTHETIC_NO_LOGIN_HASH, which is not a bcrypt hash, so login answers 401.
 */
import * as bcrypt from 'bcrypt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '@/modules/auth/auth.service';
import {
  SYNTHETIC_NO_LOGIN_HASH,
  generateSyntheticDataset,
} from '../../../prisma/synthetic/generate';

const NOW = new Date('2026-11-11T15:00:00.000Z');
const DEMO_PASSWORD = 'demo-walkthrough-pass';
type SpecUser = { id: string; email: string; name: string; passwordHash: string };
const usersOf = (opts: { users: number; demoPasswordHash: string; now: Date }) =>
  (generateSyntheticDataset(opts) as { users: SpecUser[] }).users;
const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

describe('synthetic credentials', () => {
  let demoHash: string;

  beforeAll(async () => {
    demoHash = await bcrypt.hash(DEMO_PASSWORD, 4);
  });

  it('the no-login marker is the agreed literal and is not a bcrypt hash', () => {
    expect(SYNTHETIC_NO_LOGIN_HASH).toBe('!synthetic-no-login');
    expect(SYNTHETIC_NO_LOGIN_HASH).not.toMatch(BCRYPT_HASH);
  });

  it.each(['', 'anything', '!synthetic-no-login', DEMO_PASSWORD])(
    'bcrypt.compare(%p, SYNTHETIC_NO_LOGIN_HASH) resolves false',
    async (candidate) => {
      await expect(bcrypt.compare(candidate, SYNTHETIC_NO_LOGIN_HASH)).resolves.toBe(false);
    },
  );

  it('login with a synthetic no-login user answers 401 (UnauthorizedException)', async () => {
    const userRepository = {
      findByEmail: jest.fn().mockResolvedValue({
        id: '5eed0001-0000-4000-8000-000000000002',
        email: 'demo.seed.00002@nutria.test',
        name: 'Demo Sintético 00002',
        passwordHash: SYNTHETIC_NO_LOGIN_HASH,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    };
    const jwtService = { signAsync: jest.fn() };
    const service = new AuthService(userRepository as never, jwtService as never);

    await expect(
      service.login({ email: 'demo.seed.00002@nutria.test', password: 'anything' } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('only user 00001 gets the provided bcrypt hash; every other user gets the no-login marker', async () => {
    const users = usersOf({ users: 50, demoPasswordHash: demoHash, now: NOW });

    expect(users[0].email).toBe('demo.seed.00001@nutria.test');
    expect(users[0].passwordHash).toBe(demoHash);
    expect(users[0].passwordHash).toMatch(BCRYPT_HASH);
    await expect(bcrypt.compare(DEMO_PASSWORD, users[0].passwordHash)).resolves.toBe(true);

    const others = users.slice(1);
    expect(others).toHaveLength(49);
    for (const user of others) {
      expect(user.passwordHash).toBe(SYNTHETIC_NO_LOGIN_HASH);
    }
    expect(users.filter((user) => BCRYPT_HASH.test(user.passwordHash))).toHaveLength(1);
    await expect(bcrypt.compare(DEMO_PASSWORD, others[0].passwordHash)).resolves.toBe(false);
  });

  it('the generator never hashes nor stores the plaintext password', () => {
    const users = usersOf({ users: 5, demoPasswordHash: demoHash, now: NOW });
    expect(JSON.stringify(users)).not.toContain(DEMO_PASSWORD);
  });
});
