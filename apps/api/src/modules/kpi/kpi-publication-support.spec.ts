import { buildPublicationArtifacts } from './kpi-artifacts';
import { classifyPublicationError, parseRetryAfter, StructuralKpiError } from './kpi-publisher';

describe('publication error classification', () => {
  it.each([400, 401, 403, 409])('classifies HTTP %i as definitive', (status) => {
    expect(classifyPublicationError({ status })).toMatchObject({ retryable: false });
  });

  it.each([408, 429, 500, 503])('classifies HTTP %i as retryable', (status) => {
    expect(classifyPublicationError({ status })).toMatchObject({ retryable: true });
  });

  it('classifies network, timeout and structural/conflict failures without treating them alike', () => {
    expect(classifyPublicationError({ kind: 'network' })).toMatchObject({ retryable: true });
    expect(classifyPublicationError({ kind: 'timeout' })).toMatchObject({ retryable: true });
    expect(classifyPublicationError({ code: 'REMOTE_VALUE_CONFLICT' })).toMatchObject({ retryable: false });
    expect(classifyPublicationError({ code: 'CATALOG_CONFLICT' })).toMatchObject({ retryable: false });
    expect(classifyPublicationError(new StructuralKpiError('invalid result'))).toMatchObject({ retryable: false });
  });

  it('parses Retry-After seconds and reasonable HTTP dates without sleeping', () => {
    const now = new Date('2026-10-10T00:00:00.000Z');
    expect(parseRetryAfter('30', now)).toBe(30_000);
    expect(parseRetryAfter('Fri, 10 Oct 2026 00:02:00 GMT', now)).toBe(120_000);
    expect(parseRetryAfter('invalid', now)).toBeNull();
  });
});

describe('publication artifacts', () => {
  it('writes the exact frozen payload and sanitized diagnostics without fixture secrets', () => {
    const payload = Buffer.from('[{"kpi_id":"operations_count","value":0}]', 'utf8');
    const artifacts = buildPublicationArtifacts({
      frozenPayload: payload,
      runId: 'run-86', date: '2026-10-09', environment: 'prod', payloadSha256: 'a'.repeat(64),
      diagnostics: [{ kpi_id: 'operations_count', quality: 'observed', reason: null, sample_count: 0 }],
      postAccepted: true, status: 'verify_pending', failureCode: null,
      retry: { retryChainId: 'f049dc13-8d9f-4c23-9f55-0f1a4d676fe4', attempt: 1 },
      httpStatus: 202,
      Authorization: 'Bearer fixture-token', PROJECT_KEY: 'fixture-project-key', token: 'fixture-token',
    });

    expect(artifacts['payload.json']).toEqual(payload);
    const diagnostics = artifacts['diagnostics.json'].toString('utf8');
    expect(diagnostics).toContain('"post_accepted":true');
    expect(diagnostics).not.toMatch(/PROJECT_KEY|Authorization|fixture-token|fixture-project-key/i);
  });
});
