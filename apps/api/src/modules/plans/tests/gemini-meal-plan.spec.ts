import { GoogleGenerativeAIAbortError } from '@google/generative-ai';
import { InternalServerErrorException, RequestTimeoutException } from '@nestjs/common';
import { AiProviderUnavailableError, GeminiService } from '../gemini/gemini.service';

const profile = { diet: 'VEGAN', goal: 'MAINTAIN', excludedIngredients: ['NUTS'], cookTimePreference: 'QUICK' } as any;
const startDate = new Date('2026-09-14T00:00:00Z');

// GeminiService con el SDK reemplazado por un mock: nunca llama a Gemini de verdad.
function setup(generateContent: jest.Mock) {
  const service = new GeminiService({ get: () => 'fake-gemini-key' } as any);
  (service as any).genAI = { getGenerativeModel: jest.fn(() => ({ generateContent })) };
  return service;
}

describe('GeminiService.generateMealPlan (NUT-74: texto crudo, el servidor valida)', () => {
  afterEach(() => jest.useRealTimers());

  it('devuelve el texto crudo, sin parsearlo', async () => {
    const raw = '```json\n{"days":[]}\n```';
    const service = setup(jest.fn().mockResolvedValue({ response: { text: () => raw } }));

    await expect(service.generateMealPlan(profile, startDate)).resolves.toBe(raw);
  });

  it('una respuesta que no es JSON vuelve tal cual (no es un error del proveedor)', async () => {
    const service = setup(jest.fn().mockResolvedValue({ response: { text: () => 'no es json' } }));

    await expect(service.generateMealPlan(profile, startDate)).resolves.toBe('no es json');
  });

  it('si el SDK falla lanza AiProviderUnavailableError(AI_PROVIDER_ERROR), nunca un 500 genérico', async () => {
    const service = setup(jest.fn().mockRejectedValue(new Error('500 from provider')));

    const pending = service.generateMealPlan(profile, startDate);
    await expect(pending).rejects.toMatchObject({ name: 'AiProviderUnavailableError', reason: 'AI_PROVIDER_ERROR' });
    await expect(pending).rejects.not.toBeInstanceOf(InternalServerErrorException);
  });

  it('aborta a los 15 s y lanza AiProviderUnavailableError(AI_TIMEOUT), no un 408', async () => {
    jest.useFakeTimers();
    const generateContent = jest.fn((_request: unknown, options: any) => new Promise((_resolve, reject) => {
      // Como el SDK real (0.24.1): lee `signal` en el primer nivel de las opciones y, al abortar,
      // rechaza con GoogleGenerativeAIAbortError, cuyo name NO es 'AbortError'.
      options.signal.addEventListener('abort', () => reject(new GoogleGenerativeAIAbortError('Request aborted')));
    }));
    const service = setup(generateContent);

    const pending = service.generateMealPlan(profile, startDate);
    const assertion = expect(pending).rejects.toBeInstanceOf(AiProviderUnavailableError);
    await jest.advanceTimersByTimeAsync(15000);

    await assertion;
    await expect(pending).rejects.toMatchObject({ reason: 'AI_TIMEOUT' });
    await expect(pending).rejects.not.toBeInstanceOf(RequestTimeoutException);
  });
});

describe('GeminiService - opciones del SDK (NUT-74)', () => {
  it('pasa la señal de abort en el primer nivel de las opciones, como la lee el SDK', async () => {
    const generateContent = jest.fn().mockResolvedValue({ response: { text: () => '{}' } });
    const service = setup(generateContent);

    await service.generateMealPlan(profile, startDate);

    const options = generateContent.mock.calls[0][1];
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options).not.toHaveProperty('requestOptions');
  });
});
