import type { KpiEnvironment } from './kpi-contract';

export interface PublicationArtifactInput {
  frozenPayload: Buffer;
  runId: string;
  date: string;
  environment: KpiEnvironment;
  windowStart: string;
  windowEnd: string;
  payloadSha256: string;
  diagnostics: readonly { kpi_id: string; quality: string; sample_count: number; reason?: string | null }[];
  postAccepted: boolean;
  status: string;
  failureCode: string | null;
  retry: { retryChainId: string; attempt: number };
  httpStatus: number | null;
  retryable?: boolean;
  retryAfterMs?: number | null;
}

/** Builds only publish-safe evidence; caller-supplied extras cannot leak into it. */
export function buildPublicationArtifacts(input: PublicationArtifactInput & Record<string, unknown>): Record<string, Buffer> {
  const qualityCounts = input.diagnostics.reduce<Record<string, number>>((counts, diagnostic) => {
    counts[diagnostic.quality] = (counts[diagnostic.quality] ?? 0) + 1;
    return counts;
  }, {});
  const diagnostics = {
    run_id: input.runId,
    date: input.date,
    environment: input.environment,
    window_start: input.windowStart,
    window_end: input.windowEnd,
    payload_sha256: input.payloadSha256,
    diagnostics: input.diagnostics,
    sample_count: input.diagnostics.reduce((total, diagnostic) => total + diagnostic.sample_count, 0),
    quality_counts: qualityCounts,
    post_accepted: input.postAccepted,
    status: input.status,
    failure_code: input.failureCode,
    retry: { retry_chain_id: input.retry.retryChainId, attempt: input.retry.attempt },
    http_status: input.httpStatus,
    retryable: input.retryable ?? false,
    retry_after_ms: input.retryAfterMs ?? null,
  };
  return {
    'payload.json': Buffer.from(input.frozenPayload),
    'diagnostics.json': Buffer.from(JSON.stringify(diagnostics), 'utf8'),
  };
}
