import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AccessModule } from './access.module';
import { ACCESS_GATE_COOKIE, AccessGateService } from './access-gate.service';
import { KpiTelemetryController } from '../kpi/kpi-telemetry.controller';
import { KpiCollectController } from '../kpi/kpi-collect.controller';
import { KpiPublicationController } from '../kpi/kpi-publication.controller';
import { KpiInternalAuthGuard } from '../kpi/kpi-internal-auth.guard';
import { CompositeKpiLogger } from '../kpi/composite-kpi.logger';
import { PrismaPublicationRepository } from '../kpi/prisma-publication.repository';
import { KPI_CONFIG, KPI_REPORTING_STORE } from '../kpi/kpi.tokens';

const INTERNAL_PATHS = [
  '/kpi/telemetry/sample', '/kpi/collect',
  '/kpi/publications/reserve', '/kpi/publications/get', '/kpi/publications/freeze',
  '/kpi/publications/claim-attempt', '/kpi/publications/mark-accepted',
  '/kpi/publications/mark-delivered', '/kpi/publications/mark-failed',
];

describe('Browser access gate and internal KPI authentication over HTTP', () => {
  const original = { password: process.env.APP_ACCESS_PASSWORD, token: process.env.KPI_INTERNAL_TOKEN };
  let app: INestApplication;
  let baseUrl: string;
  let browserCookie: string;

  beforeAll(async () => {
    process.env.APP_ACCESS_PASSWORD = 'test-browser-password';
    process.env.KPI_INTERNAL_TOKEN = 'test-machine-token';
    const module = await Test.createTestingModule({
      imports: [AccessModule],
      controllers: [KpiTelemetryController, KpiCollectController, KpiPublicationController],
      providers: [
        KpiInternalAuthGuard,
        { provide: KPI_CONFIG, useValue: { enabled: true, environment: 'dev', disabledReason: null } },
        // Malformed requests must be rejected before any persistence or collection call.
        { provide: KPI_REPORTING_STORE, useValue: {} },
        { provide: CompositeKpiLogger, useValue: {} },
        { provide: PrismaPublicationRepository, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.use(cookieParser());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    browserCookie = `${ACCESS_GATE_COOKIE}=${app.get(AccessGateService).createToken()}`;
  });

  afterAll(async () => {
    await app?.close();
    for (const [key, value] of Object.entries({ APP_ACCESS_PASSWORD: original.password, KPI_INTERNAL_TOKEN: original.token })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function post(path: string, authorization?: string, cookie?: string) {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST', body: '{}',
      headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}), ...(cookie ? { cookie } : {}) },
    });
  }

  it.each(INTERNAL_PATHS)('lets the valid bearer reach input validation at %s without a browser cookie', async path => {
    const response = await post(path, 'Bearer test-machine-token');
    expect(response.status).toBe(400);
    expect(await response.json()).not.toHaveProperty('code', 'ACCESS_GATE_REQUIRED');
  });

  it.each(INTERNAL_PATHS)('keeps bearer authentication mandatory at %s', async path => {
    const response = await post(path);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ message: 'KPI_INTERNAL_AUTH_REQUIRED' });
  });

  it.each([undefined, 'Bearer wrong', 'Bearer test-machine-token-extra'])('does not substitute a browser cookie for a valid internal token (%s)', async token => {
    const response = await post('/kpi/telemetry/sample', token, browserCookie);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ message: 'KPI_INTERNAL_AUTH_REQUIRED' });
  });

  it('fails closed when the internal token is not configured', async () => {
    delete process.env.KPI_INTERNAL_TOKEN;
    try {
      const response = await post('/kpi/telemetry/sample', 'Bearer test-machine-token');
      expect(response.status).toBe(401);
    } finally {
      process.env.KPI_INTERNAL_TOKEN = 'test-machine-token';
    }
  });

  it.each(['/recipes', '/kpi/future-route', '/kpi/telemetry/sample/extra'])('does not exempt other paths (%s) for internal bearers', async path => {
    const response = await post(path, 'Bearer test-machine-token');
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'ACCESS_GATE_REQUIRED' });
  });

  it('does not exempt other HTTP methods on KPI routes', async () => {
    const response = await fetch(`${baseUrl}/kpi/collect`, { headers: { authorization: 'Bearer test-machine-token' } });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'ACCESS_GATE_REQUIRED' });
  });

  it('allows an existing browser cookie to reach ordinary application routing', async () => {
    const response = await post('/unregistered-business-route', undefined, browserCookie);
    expect(response.status).toBe(404);
  });

  it('no longer exposes a telemetry finalize endpoint', async () => {
    const response = await post('/kpi/telemetry/finalize', 'Bearer test-machine-token', browserCookie);
    expect(response.status).toBe(404);
  });
});
