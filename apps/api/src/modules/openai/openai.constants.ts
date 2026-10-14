export const OPENAI_PROVIDER = 'openai';
export const OPENAI_MODEL_CHAIN = Object.freeze(['gpt-6-luna', 'gpt-5.4-nano', 'gpt-5.4-mini'] as const);
export const OPENAI_MODEL_NAME = OPENAI_MODEL_CHAIN[0];
export const OPENAI_REQUEST_TIMEOUT_MS = 360_000;
export const OPENAI_ATTEMPT_TIMEOUT_MS = 120_000;

export class AiProviderUnavailableError extends Error {
  constructor(
    readonly reason: 'AI_TIMEOUT' | 'AI_PROVIDER_ERROR',
    readonly code?: 'RATE_LIMITED',
  ) {
    super(`AI provider unavailable: ${reason}`);
    this.name = 'AiProviderUnavailableError';
  }
}
