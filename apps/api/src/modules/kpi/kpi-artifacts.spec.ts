import { buildPublicationArtifacts } from './kpi-artifacts';

const currentIds = [
  'operations_count', 'error_rate', 'latency_p95_ms', 'health_status',
  'last_success_age_seconds', 'timeout_rate', 'dependency_error_rate', 'availability_rate',
  'initial_plans_count', 'manual_recipes_count', 'adherence_rate',
];

describe('KPI publication artifacts with adherence evidence', () => {
  it('round-trips eleven diagnostics and their PII-free adherence evidence without changing the external payload', () => {
    const evidence = {
      numerator: 32,
      denominator: 40,
      quality: 'observed',
      reason: null,
      collection_date: '2026-10-29',
      measured_at: '2026-10-29T03:00:00.000Z',
      environment: 'qa',
    };
    const diagnostics = currentIds.map(kpi_id => ({
      kpi_id,
      quality: kpi_id === 'adherence_rate' ? 'observed' : 'defaulted',
      sample_count: kpi_id === 'adherence_rate' ? 40 : 0,
      reason: kpi_id === 'adherence_rate' ? null : 'SOURCE_UNAVAILABLE',
      ...(kpi_id === 'adherence_rate' ? { evidence } : {}),
    }));
    const payload = Buffer.from(JSON.stringify(currentIds.map(kpi_id => ({
      kpi_id, date: '2026-10-29', env: 'qa', value: kpi_id === 'adherence_rate' ? 80 : 0, run_id: 'run-11',
    }))), 'utf8');

    const artifacts = buildPublicationArtifacts({
      frozenPayload: payload,
      runId: 'run-11', date: '2026-10-29', environment: 'qa',
      windowStart: '2026-10-29T03:00:00.000Z', windowEnd: '2026-10-30T00:00:00.000Z',
      payloadSha256: 'a'.repeat(64), diagnostics, postAccepted: false, status: 'failed',
      failureCode: 'REMOTE_POST_ERROR', retry: { retryChainId: 'chain-11', attempt: 1 }, httpStatus: 400,
    });
    const diagnosticsJson = JSON.parse(artifacts['diagnostics.json'].toString('utf8')) as {
      diagnostics: Array<Record<string, unknown>>;
    };
    const externalPayload = JSON.parse(artifacts['payload.json'].toString('utf8')) as Array<Record<string, unknown>>;

    expect(diagnosticsJson.diagnostics).toHaveLength(11);
    expect(diagnosticsJson.diagnostics.find(item => item.kpi_id === 'adherence_rate')).toMatchObject({
      sample_count: 40, quality: 'observed', evidence,
    });
    expect(externalPayload).toHaveLength(11);
    expect(externalPayload.find(item => item.kpi_id === 'adherence_rate')).toEqual({
      kpi_id: 'adherence_rate', date: '2026-10-29', env: 'qa', value: 80, run_id: 'run-11',
    });
    expect(artifacts['diagnostics.json'].toString('utf8')).not.toContain('user_id');
  });
});
