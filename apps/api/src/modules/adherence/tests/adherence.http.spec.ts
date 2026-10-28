import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import cookieParser from 'cookie-parser';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdherenceController } from '../adherence.controller';
import { AdherenceService } from '../adherence.service';

jest.mock('../adherence.service', () => ({ AdherenceService: class AdherenceService {} }));

describe('Adherence HTTP contract (NUT-91 PUT and NUT-92 GET)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let service: { setMealStatus: jest.Mock; getForWeek: jest.Mock };

  const plannedMealId = '11111111-1111-4111-8111-111111111111';
  const body = {
    planId: '22222222-2222-4222-8222-222222222222',
    mealUpdatedAt: '2026-10-20T12:30:45.123Z',
    status: 'COMPLETED',
  };
  const result = {
    plannedMealId,
    status: 'COMPLETED',
    updatedAt: '2026-10-20T12:31:00.000Z',
  };
  const adherenceResult = {
    weekStart: '2026-10-19',
    timezone: 'America/Argentina/Buenos_Aires',
    today: '2026-10-20',
    plan: { id: '22222222-2222-4222-8222-222222222222', version: 3, updatedAt: '2026-10-19T12:00:00.000Z' },
    days: [{
      date: '2026-10-20',
      plannedMeals: 1,
      completedMeals: 1,
      skippedMeals: 0,
      notLoggedMeals: 0,
      adherencePercent: 100,
      meals: [{
        plannedMealId,
        mealUpdatedAt: '2026-10-20T12:30:45.123Z',
        recipeId: null,
        mealType: 'BREAKFAST',
        title: 'Avena con fruta',
        status: 'COMPLETED',
        canEdit: true,
      }],
    }],
    summary: {
      plannedMeals: 1,
      completedMeals: 1,
      skippedMeals: 0,
      notLoggedMeals: 0,
      adherencePercent: 100,
    },
  };

  beforeAll(async () => {
    service = {
      setMealStatus: jest.fn(async (_userId: string, id: string, input: { status: string }) => ({
        ...result,
        plannedMealId: id,
        status: input.status,
      })),
      getForWeek: jest.fn(async () => adherenceResult),
    };
    const jwtService = {
      verifyAsync: jest.fn(async (token: string) => {
        if (token === 'invalid-token' || token === 'expired-token') throw new Error('invalid or expired');
        return { sub: token === 'user-two-token' ? 'user-two' : 'user-one' };
      }),
    };
    const module = await Test.createTestingModule({
      controllers: [AdherenceController],
      providers: [
        { provide: AdherenceService, useValue: service },
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
    service.setMealStatus.mockClear();
    service.getForWeek.mockClear();
  });

  async function get(query: string, token?: string) {
    return fetch(`${baseUrl}/adherence?${query}`, {
      method: 'GET',
      headers: token ? { cookie: `token=${token}` } : {},
    });
  }

  async function put(id: string, value: unknown, token?: string) {
    return fetch(`${baseUrl}/adherence/meals/${id}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        ...(token ? { cookie: `token=${token}` } : {}),
      },
      body: JSON.stringify(value),
    });
  }

  it('exposes the authenticated PUT route and the NUT-92 GET route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdherenceController)).toBe('adherence');
    expect(Reflect.getMetadata(PATH_METADATA, AdherenceController.prototype.setMealStatus)).toBe('meals/:plannedMealId');
    expect(Reflect.getMetadata(METHOD_METADATA, AdherenceController.prototype.setMealStatus)).toBe(RequestMethod.PUT);
    const getAdherence = (AdherenceController.prototype as any).getAdherence;
    expect(getAdherence).toBeDefined();
    expect(Reflect.getMetadata(PATH_METADATA, getAdherence)).toBe('/');
    expect(Reflect.getMetadata(METHOD_METADATA, getAdherence)).toBe(RequestMethod.GET);
  });

  it('returns the exact GET response contract and derives identity only from the session', async () => {
    const response = await get('weekStart=2026-10-19', 'user-two-token');

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(adherenceResult);
    expect(Object.keys(payload).sort()).toEqual(['days', 'plan', 'summary', 'timezone', 'today', 'weekStart']);
    expect(Object.keys(payload.days[0]).sort()).toEqual([
      'adherencePercent', 'completedMeals', 'date', 'meals', 'notLoggedMeals', 'plannedMeals', 'skippedMeals',
    ]);
    expect(Object.keys(payload.days[0].meals[0]).sort()).toEqual([
      'canEdit', 'mealType', 'mealUpdatedAt', 'plannedMealId', 'recipeId', 'status', 'title',
    ]);
    expect(payload.days[0]).not.toHaveProperty('canEdit');
    expect(service.getForWeek).toHaveBeenCalledTimes(1);
    expect(service.getForWeek).toHaveBeenCalledWith('user-two', '2026-10-19');
  });

  it.each([undefined, 'invalid-token', 'expired-token'])('requires a valid cookie session for GET (%s)', async (token) => {
    const response = await get('weekStart=2026-10-19', token);

    expect(response.status).toBe(401);
    expect(service.getForWeek).not.toHaveBeenCalled();
  });

  it.each([
    ['missing weekStart', ''],
    ['malformed date', 'weekStart=2026-1-19'],
    ['impossible calendar date', 'weekStart=2026-02-30'],
    ['non-Monday date', 'weekStart=2026-10-20'],
    ['client supplied userId', 'weekStart=2026-10-19&userId=user-two'],
    ['unknown query field', 'weekStart=2026-10-19&unexpected=true'],
  ])('rejects %s with 400 before reading', async (_caseName, query) => {
    const response = await get(query, 'user-one-token');

    expect(response.status).toBe(400);
    expect(service.getForWeek).not.toHaveBeenCalled();
  });

  it('returns the empty response for a user without a current plan', async () => {
    const empty = {
      weekStart: '2026-10-19',
      timezone: 'America/Argentina/Buenos_Aires',
      today: '2026-10-24',
      plan: null,
      days: [],
      summary: {
        plannedMeals: 0,
        completedMeals: 0,
        skippedMeals: 0,
        notLoggedMeals: 0,
        adherencePercent: null,
      },
    };
    service.getForWeek.mockResolvedValueOnce(empty);

    const response = await get('weekStart=2026-10-19', 'user-one-token');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(empty);
    expect(service.getForWeek).toHaveBeenCalledWith('user-one', '2026-10-19');
  });

  it.each([undefined, 'invalid-token', 'expired-token'])('requires a valid cookie session (%s)', async (token) => {
    const response = await put(plannedMealId, body, token);

    expect(response.status).toBe(401);
    expect(service.setMealStatus).not.toHaveBeenCalled();
  });

  it.each(['COMPLETED', 'SKIPPED', 'NOT_LOGGED'])('passes only the session identity and valid DTO for %s', async (status) => {
    const response = await put(plannedMealId, { ...body, status }, 'user-two-token');

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual(['plannedMealId', 'status', 'updatedAt']);
    expect(payload).toEqual({ ...result, status });
    expect(service.setMealStatus).toHaveBeenCalledWith('user-two', plannedMealId, { ...body, status });
  });

  it.each([
    ['invalid path UUID', 'not-a-uuid', body],
    ['invalid plan UUID', plannedMealId, { ...body, planId: 'not-a-uuid' }],
    ['UTC offset instead of UTC Z token', plannedMealId, { ...body, mealUpdatedAt: '2026-10-20T09:30:45-03:00' }],
    ['impossible calendar date', plannedMealId, { ...body, mealUpdatedAt: '2026-02-30T12:30:45.000Z' }],
    ['malformed timestamp', plannedMealId, { ...body, mealUpdatedAt: '2026-10-20T12:30:45Zx' }],
    ['unknown status', plannedMealId, { ...body, status: 'PENDING' }],
    ['string status', plannedMealId, { ...body, status: 1 }],
    ['client supplied userId', plannedMealId, { ...body, userId: 'attacker' }],
    ['client supplied recipe snapshot', plannedMealId, { ...body, recipeIdSnapshot: 'recipe-from-client' }],
    ['unknown DTO field', plannedMealId, { ...body, unrelated: true }],
    ['missing planId', plannedMealId, { mealUpdatedAt: body.mealUpdatedAt, status: body.status }],
    ['missing mealUpdatedAt', plannedMealId, { planId: body.planId, status: body.status }],
    ['missing status', plannedMealId, { planId: body.planId, mealUpdatedAt: body.mealUpdatedAt }],
  ] as Array<[string, string, unknown]>)('rejects %s before calling the service', async (_caseName, id, value) => {
    const response = await put(id, value, 'user-one-token');

    expect(response.status).toBe(400);
    expect(service.setMealStatus).not.toHaveBeenCalled();
  });

  it('returns the stable future-meal domain code from the service', async () => {
    service.setMealStatus.mockRejectedValueOnce(new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: 'A future meal cannot be logged',
      code: 'MEAL_IN_FUTURE',
    }));

    const response = await put(plannedMealId, body, 'user-one-token');

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'MEAL_IN_FUTURE' });
  });

  it('keeps a missing or foreign meal indistinguishable at the HTTP boundary', async () => {
    const notFound = new NotFoundException({
      statusCode: 404,
      error: 'Not Found',
      message: 'Planned meal not found',
      code: 'ADHERENCE_MEAL_NOT_FOUND',
    });
    service.setMealStatus.mockRejectedValue(notFound);

    const missing = await put(plannedMealId, body, 'user-one-token');
    const foreign = await put('33333333-3333-4333-8333-333333333333', body, 'user-one-token');

    expect(missing.status).toBe(404);
    expect(foreign.status).toBe(404);
    const missingBody = await missing.json();
    const foreignBody = await foreign.json();
    expect(missingBody).toEqual(foreignBody);
    expect(JSON.stringify(missingBody)).not.toContain('user-two');
  });
});
