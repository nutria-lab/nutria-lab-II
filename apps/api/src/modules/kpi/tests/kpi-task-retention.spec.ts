import { Test } from '@nestjs/testing';
import { waitUntil } from '@vercel/functions';
import { randomUUID } from 'node:crypto';
import { createKpiPrismaClient, disposeKpiPrismaClient } from '../db/kpi-prisma';
import type { KpiPrismaHandle } from '../db/kpi-prisma';
import type { KpiEventWriter } from '../events/kpi-event-writer';
import { KpiModule } from '../kpi.module';
import { DB_HEALTH_PROBE, KPI_EVENT_WRITER, KPI_REPORTING_STORE } from '../kpi.tokens';

jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }));
jest.mock('../db/kpi-prisma', () => ({
  createKpiPrismaClient: jest.fn(),
  disposeKpiPrismaClient: jest.fn(async () => undefined),
}));

it('application assembly retains telemetry writes with Vercel waitUntil', async () => {
  const saved = { DATABASE_URL: process.env.DATABASE_URL, KPI_ENV: process.env.KPI_ENV,
    KPI_INSTRUMENTATION_ENABLED: process.env.KPI_INSTRUMENTATION_ENABLED };
  process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
  process.env.KPI_ENV = 'dev';
  process.env.KPI_INSTRUMENTATION_ENABLED = 'true';
  const handle = {
    prisma: {
      $executeRaw: () => Promise.resolve(1),
      $executeRawUnsafe: () => Promise.resolve(0),
      $transaction: (batch: Promise<number>[]) => Promise.all(batch),
    },
  } as unknown as KpiPrismaHandle;
  jest.mocked(createKpiPrismaClient).mockReturnValue(handle);

  const app = await Test.createTestingModule({ imports: [KpiModule] })
    .overrideProvider(DB_HEALTH_PROBE).useValue({ ping: async () => undefined })
    .overrideProvider(KPI_REPORTING_STORE).useValue({ close: async () => undefined })
    .compile();
  try {
    const writer = app.get<KpiEventWriter>(KPI_EVENT_WRITER);
    await writer.insertHttpPending({ id: randomUUID(), environment: 'dev', operation: 'UNRESOLVED', startedAt: new Date() });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
    await expect(jest.mocked(waitUntil).mock.calls[0][0]).resolves.toBeUndefined();
  } finally {
    await app.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    expect(disposeKpiPrismaClient).toHaveBeenCalledWith(handle);
    jest.clearAllMocks();
  }
});
