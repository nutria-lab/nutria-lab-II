import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import cookieParser from 'cookie-parser';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ShoppingListController } from '../shopping-list.controller';
import { ShoppingListService } from '../shopping-list.service';

describe('Shopping list HTTP contract', () => {
  let app: INestApplication;
  let baseUrl: string;
  let service: { getForWeek: jest.Mock; setChecked: jest.Mock };

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
      setChecked: jest.fn(async (_userId: string, itemKey: string, input: { checked: boolean }) => ({
        itemKey,
        checked: input.checked,
      })),
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
    service.setChecked.mockClear();
  });

  async function get(path: string, token?: string) {
    return fetch(`${baseUrl}${path}`, {
      headers: token ? { cookie: `token=${token}` } : {},
    });
  }

  async function patch(itemKey: string, body: unknown, token?: string) {
    return fetch(`${baseUrl}/shopping-list/items/${itemKey}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...(token ? { cookie: `token=${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  const validPatch = {
    planId: '21e21580-6c87-4114-932d-669b39fb8384',
    planUpdatedAt: '2026-10-19T12:00:00.000Z',
    checked: true,
  };

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

  it('sets checked through authenticated PATCH using only the cookie-derived user identity', async () => {
    const response = await patch('item-key', validPatch, 'user-one-token');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ itemKey: 'item-key', checked: true });
    expect(service.setChecked).toHaveBeenCalledWith('user-one', 'item-key', validPatch);
  });

  it.each([undefined, 'invalid-token', 'expired-token'])('rejects PATCH without a valid session (%s)', async (token) => {
    const response = await patch('item-key', validPatch, token);

    expect(response.status).toBe(401);
    expect(service.setChecked).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...validPatch, planId: 'not-a-uuid' }, 'invalid planId'],
    [{ ...validPatch, planUpdatedAt: '2026-10-19T09:00:00-03:00' }, 'non-UTC token'],
    [{ ...validPatch, planUpdatedAt: '2026-02-30T12:00:00.000Z' }, 'invalid calendar token'],
    [{ ...validPatch, planUpdatedAt: '2026-10-19T12:00:00Zx' }, 'malformed token'],
    [{ ...validPatch, checked: 'true' }, 'string boolean'],
    [{ ...validPatch, userId: 'another-user' }, 'client supplied userId'],
    [{ ...validPatch, unrelated: 1 }, 'unknown field'],
    [{ planId: validPatch.planId, checked: true }, 'missing token'],
    [{ planId: validPatch.planId, planUpdatedAt: validPatch.planUpdatedAt }, 'missing checked'],
  ])('rejects PATCH %s (%s)', async (body, _description) => {
    const response = await patch('item-key', body, 'user-one-token');

    expect(response.status).toBe(400);
    expect(service.setChecked).not.toHaveBeenCalled();
  });

  it('passes false through as a set value instead of converting it to a toggle', async () => {
    const response = await patch('item-key', { ...validPatch, checked: false }, 'user-two-token');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ itemKey: 'item-key', checked: false });
    expect(service.setChecked).toHaveBeenCalledWith('user-two', 'item-key', {
      ...validPatch,
      checked: false,
    });
  });
});
