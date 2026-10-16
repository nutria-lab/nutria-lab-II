import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEPENDENCY_INSTRUMENTATION } from '../kpi/kpi.tokens';
import { NOOP_DEPENDENCY_INSTRUMENTATION } from '../kpi/dependencies/dependency-instrumentation';
import type { DependencyInstrumentation } from '../kpi/dependencies/dependency-instrumentation';
import { AiProviderUnavailableError, OPENAI_ATTEMPT_TIMEOUT_MS, OPENAI_MODEL_CHAIN, OPENAI_PROVIDER, OPENAI_REQUEST_TIMEOUT_MS } from './openai.constants';
import { JsonSchema, toStrictJsonSchema } from './openai-schema';
import { CURRENT_PROMPT_VERSION, REPLACEMENT_PROMPT_VERSION, ReplacementPromptCriteria } from '../plans/openai/prompts';

export { AiProviderUnavailableError, OPENAI_MODEL_CHAIN, OPENAI_MODEL_NAME, OPENAI_PROVIDER } from './openai.constants';

interface OpenAIResponse {
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
}

interface OpenAIRequestError extends Error {
  status?: number;
  code?: string;
}

@Injectable()
export class OpenAIService {
  private readonly logger = new Logger(OpenAIService.name);
  private readonly apiKey: string;
  private readonly instrumentation: DependencyInstrumentation;

  constructor(
    config: ConfigService,
    @Optional() @Inject(DEPENDENCY_INSTRUMENTATION) instrumentation?: DependencyInstrumentation,
  ) {
    const apiKey = config.get<string>('OPENAI_API_KEY');
    if (!apiKey) throw new Error('OPENAI_API_KEY is missing');
    this.apiKey = apiKey;
    this.instrumentation = instrumentation ?? NOOP_DEPENDENCY_INSTRUMENTATION;
  }

  generateMealPlan(profile: unknown, weekStart: Date, onModelSelected?: (model: string) => void | Promise<void>): Promise<string> {
    return this.generateJson(
      CURRENT_PROMPT_VERSION.getPrompt(profile, weekStart.toISOString().slice(0, 10)),
      CURRENT_PROMPT_VERSION.getSchema(),
      'weekly_meal_plan',
      onModelSelected,
    );
  }

  generateReplacementMeal(
    profile: unknown,
    mealType: string,
    criteria: ReplacementPromptCriteria,
    onModelSelected?: (model: string) => void | Promise<void>,
  ): Promise<string> {
    return this.generateJson(
      REPLACEMENT_PROMPT_VERSION.getPrompt(profile, mealType, criteria),
      REPLACEMENT_PROMPT_VERSION.getSchema(),
      'replacement_meal',
      onModelSelected,
    );
  }

  async generateJson(
    prompt: string,
    schema: JsonSchema,
    schemaName: string,
    onModelSelected?: (model: string) => void | Promise<void>,
  ): Promise<string> {
    const deadline = Date.now() + OPENAI_REQUEST_TIMEOUT_MS;
    let finalReason: 'AI_TIMEOUT' | 'AI_PROVIDER_ERROR' = 'AI_PROVIDER_ERROR';
    let rateLimited = false;

    for (let index = 0; index < OPENAI_MODEL_CHAIN.length; index += 1) {
      const model = OPENAI_MODEL_CHAIN[index];
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        finalReason = 'AI_TIMEOUT';
        break;
      }

      const attempt = index + 1;
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeoutMs = Math.min(OPENAI_ATTEMPT_TIMEOUT_MS, remainingMs);
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      let output: string | undefined;
      this.logger.log({ event: 'openai_attempt_started', provider: OPENAI_PROVIDER, model, attempt });

      try {
        const result = await this.instrumentation.run(
          'openai',
          async () => {
            const response = await fetch('https://api.openai.com/v1/responses', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model,
                input: prompt,
                store: false,
                reasoning: { effort: 'none' },
                max_output_tokens: 32_000,
                text: {
                  verbosity: 'medium',
                  format: {
                    type: 'json_schema',
                    name: schemaName,
                    strict: true,
                    schema: toStrictJsonSchema(schema),
                  },
                },
              }),
              signal: controller.signal,
            });
            if (!response.ok) {
              const error: OpenAIRequestError = new Error('OpenAI request failed');
              error.status = response.status;
              error.code = response.status === 429 ? 'RATE_LIMITED' : undefined;
              throw error;
            }
            return await response.json() as OpenAIResponse;
          },
          result => result.ok ? 'success' : controller.signal.aborted ? 'timeout' : 'error',
        );
        output = (result.output ?? [])
          .filter(item => item.type === 'message')
          .flatMap(item => item.content ?? [])
          .filter(item => item.type === 'output_text' && typeof item.text === 'string')
          .map(item => item.text as string)
          .join('');

      } catch (error) {
        const status = (error as OpenAIRequestError | null)?.status;
        const timedOut = controller.signal.aborted;
        const retryable = timedOut || isRetryable(error, status);
        finalReason = timedOut ? 'AI_TIMEOUT' : 'AI_PROVIDER_ERROR';
        rateLimited = rateLimited || (error as OpenAIRequestError | null)?.code === 'RATE_LIMITED';
        const willFallback = retryable && index < OPENAI_MODEL_CHAIN.length - 1 && Date.now() < deadline;
        this.logger.warn({
          event: 'openai_attempt_failed', provider: OPENAI_PROVIDER, model, attempt,
          elapsedMs: Date.now() - startedAt, status,
          outcome: timedOut ? 'timeout' : retryable ? 'retryable_provider_error' : 'terminal_provider_error',
          willFallback,
        });
        if (!willFallback) break;
      } finally {
        clearTimeout(timeoutId);
      }

      if (output !== undefined) {
        await onModelSelected?.(model);
        this.logger.log({ event: 'openai_attempt_succeeded', provider: OPENAI_PROVIDER, model, attempt, elapsedMs: Date.now() - startedAt });
        return output;
      }
    }

    throw new AiProviderUnavailableError(Date.now() >= deadline ? 'AI_TIMEOUT' : finalReason, rateLimited ? 'RATE_LIMITED' : undefined);
  }
}

function isRetryable(error: unknown, status?: number): boolean {
  if (status === 400 || status === 404 || status === 408 || status === 409 || status === 429) return true;
  if (status !== undefined) return status >= 500 && status <= 599;
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: unknown; cause?: unknown };
  if (candidate.name === 'TypeError' || candidate.name === 'FetchError') return true;
  return hasKnownTransportCode(candidate.cause);
}

function hasKnownTransportCode(cause: unknown, depth = 0): boolean {
  if (depth > 3 || typeof cause !== 'object' || cause === null) return false;
  const item = cause as { code?: unknown; cause?: unknown };
  const codes = [
    'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'EPIPE',
    'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_ABORTED',
  ];
  return codes.includes(String(item.code ?? '')) || hasKnownTransportCode(item.cause, depth + 1);
}
