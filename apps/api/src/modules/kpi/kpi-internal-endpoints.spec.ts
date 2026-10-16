import { BadRequestException, InternalServerErrorException } from '@nestjs/common';

import { TELEMETRY_KPI_IDS } from './calc/telemetry-formulas';
import type { KpiConfig } from './config/kpi-config';
import type { TelemetryCliStore } from './db/kpi-reporting-store';
import type { CollectionContext, KpiEnvironment, KpiId, KpiResult } from './kpi-contract';
import { KpiCollectController } from './kpi-collect.controller';
import { KpiTelemetryController } from './kpi-telemetry.controller';
import { resolveFinalizeDate, scheduledBucket } from './window/kpi-window';
import { FakeSnapshotStore, sampleAggregates } from './tests/telemetry-fakes.fixture';

const context: CollectionContext = {
  contract_version: '1',
  date: '2026-10-09',
  environment: 'dev',
  window_start: '2026-10-09T03:00:00.000Z',
  window_end: '2026-10-10T00:00:00.000Z',
  run_id: 'cbd79c1e-0f46-4e5a-b86b-02d354277791',
};

const ALL_IDS: readonly KpiId[] = [
  ...TELEMETRY_KPI_IDS,
  'initial_plans_count',
  'manual_recipes_count',
];

function telemetryResults(): KpiResult[] {
  return TELEMETRY_KPI_IDS.map(kpi_id => ({
    kpi_id,
    value: 0,
    quality: 'observed',
    reason: null,
    sample_count: 1,
    measured_at: context.window_end,
  }));
}

function allResults(): KpiResult[] {
  return ALL_IDS.map(kpi_id => ({
    kpi_id, value: 0, quality: 'observed', reason: null,
    sample_count: 1, measured_at: context.window_end,
  }));
}

class FakeTelemetryStore extends FakeSnapshotStore implements TelemetryCliStore {
  readonly insertHealthSample = jest.fn(async (_sample: Parameters<TelemetryCliStore['insertHealthSample']>[0]) => true);
  readonly purgeBatch = jest.fn(async (_table: never, _environment: KpiEnvironment, _cutoff: never, _limit: number) => 0);
  readonly close = jest.fn(async () => undefined);

  constructor() {
    super((_environment, window) => sampleAggregates(window.end));
  }
}

const config: KpiConfig = { enabled: true, environment: 'dev', disabledReason: null };

describe('KPI internal collection endpoints', () => {
  it('accepts a complete collection context and returns the composite results', async () => {
    const results = allResults();
    const logger = { collect: jest.fn(async (_value: CollectionContext) => results) };
    const controller = new KpiCollectController(logger as never, config);

    await expect(controller.collect(context)).resolves.toEqual(results);
    expect(logger.collect).toHaveBeenCalledWith(context);
  });

  it('rejects a malformed collection context before invoking the logger', async () => {
    const logger = { collect: jest.fn() };
    const controller = new KpiCollectController(logger as never, config);

    await expect(controller.collect({ ...context, window_start: 'not-a-date' })).rejects.toThrow(BadRequestException);
    expect(logger.collect).not.toHaveBeenCalled();
  });

  it('stores one real health sample and materializes the preview through the backend store', async () => {
    const store = new FakeTelemetryStore();
    const controller = new KpiTelemetryController(config, store);
    const measuredAt = new Date();

    const response = await controller.sample({
      scheduled_for: scheduledBucket(measuredAt).toISOString(),
      measured_at: measuredAt.toISOString(),
      api_ok: true,
      database_ok: true,
      reason: null,
    });

    expect(store.insertHealthSample).toHaveBeenCalledTimes(1);
    expect(store.insertHealthSample.mock.calls[0][0]).toMatchObject({
      environment: 'dev', measuredAt, apiOk: true, databaseOk: true, outcome: 'healthy',
    });
    expect(response.sample).toMatchObject({ outcome: 'healthy', inserted: true });
    expect(response.preview).toMatchObject({ executed: true });
    expect(response.preview.results).toHaveLength(8);
  });

  it('does not synthesize health or preview results when persisting a sample fails', async () => {
    const store = new FakeTelemetryStore();
    store.insertHealthSample.mockRejectedValue(new Error('database unavailable'));
    const controller = new KpiTelemetryController(config, store);
    const measuredAt = new Date();

    await expect(controller.sample({
      scheduled_for: scheduledBucket(measuredAt).toISOString(),
      measured_at: measuredAt.toISOString(),
      api_ok: true,
      database_ok: true,
      reason: null,
    })).rejects.toThrow(InternalServerErrorException);

    expect(store.calls.upsertPreviews).not.toHaveBeenCalled();
  });

  it('finalizes only an already elapsed fixed cut and never samples health here', async () => {
    const store = new FakeTelemetryStore();
    const controller = new KpiTelemetryController(config, store);
    const date = resolveFinalizeDate(new Date()).date;

    const response = await controller.finalize({ date, environment: 'dev' });

    expect(response.results).toHaveLength(8);
    expect(store.isolations).toEqual(['RepeatableRead']);
    expect(store.insertHealthSample).not.toHaveBeenCalled();
  });
});
