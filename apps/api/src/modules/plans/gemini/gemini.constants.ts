export const GEMINI_PROVIDER = 'google-generative-ai';
export const GEMINI_MODEL_NAME = 'gemini-3.5-flash';
export const GEMINI_REQUEST_TIMEOUT_MS = 90_000;

export class AiProviderUnavailableError extends Error {
  constructor(readonly reason: 'AI_TIMEOUT' | 'AI_PROVIDER_ERROR') {
    super(`AI provider unavailable: ${reason}`);
    this.name = 'AiProviderUnavailableError';
  }
}
