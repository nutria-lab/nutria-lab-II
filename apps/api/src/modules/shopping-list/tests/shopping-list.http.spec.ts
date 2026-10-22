import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import cookieParser from 'cookie-parser';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ShoppingListController } from '../shopping-list.controller';
import { ShoppingListService } from '../shopping-list.service';

describe('GET /shopping-list HTTP contract', () => {
  let app: INestApplication;
  let baseUrl: string;
  let service: { getForWeek: jest.Mock };

  const emptyResponse = (weekStart: string) => ({
    weekStart,
    plan: null,
    items: [],
    summary: { totalItems: 0, checkedItems: 0 },
    warnings: [],
  });

  const populatedResponse = (userId: string, weekStart: string) => ({
    weekStart,
    plan: { id: `plan-${userId}`, version: 2, updatedAt: '2026-10-19T12:00:00.000Z' },
    items: [{
      key: `opaque-${userId}`,
      name: `ingredient-${userId}`,
      quantity: 250,
      unit: 'g',
      checked: false,
      sources: [{
        plannedMealId: `meal-${userId}`,
        recipeId: `recipe-${userId}`,
        ingredientIndex: 0,
        quantity: 250,
        unit: 'g',
      }],
    }],
    summary: { totalItems: 1, checkedItems: 0 },
    warnings: [],
  });

  beforeAll(async () => {
    service = {
      getForWeek: jest.fn(async (userId: string, weekStart: string) =>
        userId === 'user-empty' ? emptyResponse(weekStart) : populatedResponse(userId, weekStart)),
    };
    const jwtService = {
      verifyAsync: jest.fn(async (token: string) => {
        if (token === 'invalid-token' || token === 'expired-token') throw new Error('invalid or expired');
        const sub = token === 'user-one-token' ? 'user-one' : token === 'user-two-token' ? 'user-two' : 'user-empty';
        return { sub, email: `${sub}@example.test` };
      }),
    };
    const module = await Test.createTestingModule({
      controllers: [ShoppingListController],
      providers: [
        { provide: ShoppingListService, useValue: service },
        { provide: JwtService, useValue: jwtService },
        JwtAuthGuard,
      ],
    }).compile();

    app = module.createNestApplication({ logger: false });
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    service.getForWeek.mockClear();
  });

  async function get(path: string, token?: string) {
    return fetch(`${baseUrl}${path}`, {
      headers: token ? { cookie: `token=${token}` } : {},
    });
  }

  it.each([undefined, 'invalid-token', 'expired-token'])('returns 401 when the session cookie is absent, invalid, or expired (%s)', async (token) => {
    const response = await get('/shopping-list?weekStart=2026-10-19', token);

    expect(response.status).toBe(401);
    expect(service.getForWeek).not.toHaveBeenCalled();
  });

  it('returns the populated contract and passes only the cookie-derived user ID to the service', async () => {
    const response = await get('/shopping-list?weekStart=2026-10-19', 'user-one-token');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(populatedResponse('user-one', '2026-10-19'));
    expect(service.getForWeek).toHaveBeenCalledWith('user-one', '2026-10-19');
  });

  it('returns a successful empty response when the authenticated user has no current plan', async () => {
    const response = await get('/shopping-list?weekStart=2026-10-19', 'user-empty-token');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(emptyResponse('2026-10-19'));
    expect(service.getForWeek).toHaveBeenCalledWith('user-empty', '2026-10-19');
  });

  it.each([
    '',
    '?weekStart=2026-02-30',
    '?weekStart=2026-10-20',
    '?weekStart=2026-10-19&userId=someone-else',
    '?weekStart=2026-10-19&weekStart=2026-10-26',
  ])('returns 400 for invalid weekStart or additional query data (%s)', async (query) => {
    const response = await get(`/shopping-list${query}`, 'user-one-token');

    expect(response.status).toBe(400);
  });

  it('isolates same-week responses between two authenticated users', async () => {
    const first = await get('/shopping-list?weekStart=2026-10-19', 'user-one-token');
    const second = await get('/shopping-list?weekStart=2026-10-19', 'user-two-token');

    expect((await first.json()).items[0].name).toBe('ingredient-user-one');
    expect((await second.json()).items[0].name).toBe('ingredient-user-two');
    expect(service.getForWeek.mock.calls.slice(-2)).toEqual([
      ['user-one', '2026-10-19'],
      ['user-two', '2026-10-19'],
    ]);
  });

  it('does not expose PATCH/check persistence as part of NUT-87', async () => {
    const response = await fetch(`${baseUrl}/shopping-list/items/item-key`, {
      method: 'PATCH',
      headers: { cookie: 'token=user-one-token', 'content-type': 'application/json' },
      body: JSON.stringify({ checked: true }),
    });

    expect(response.status).toBe(404);
  });
});
