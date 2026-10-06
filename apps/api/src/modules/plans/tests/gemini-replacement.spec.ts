import { AiProviderUnavailableError, GeminiService } from '../gemini/gemini.service';

const profile = { diet: 'VEGETARIAN', goal: 'MAINTAIN', excludedIngredients: ['NUTS'], cookTimePreference: 'QUICK' } as any;
const criteria = { topic: 'cena liviana', categories: ['VEGETARIAN'], properties: [], maxPrepMinutes: 30 };

// GeminiService con el SDK reemplazado por un mock: nunca llama a Gemini de verdad.
function setup(generateContent: jest.Mock) {
  const service = new GeminiService({ get: () => 'fake-gemini-key' } as any);
  const getGenerativeModel = jest.fn(() => ({ generateContent }));
  (service as any).genAI = { getGenerativeModel };
  return { service, getGenerativeModel };
}

describe('GeminiService.generateReplacementMeal (NUT-77)', () => {
  afterEach(() => jest.useRealTimers());

  it('devuelve la comida parseada y manda en el prompt el tipo de comida, el perfil y los criterios', async () => {
    const meal = { title: 'Wok', nutritionalValues: {}, recipe: {} };
    const generateContent = jest.fn().mockResolvedValue({ response: { text: () => JSON.stringify(meal) } });
    const { service } = setup(generateContent);

    await expect(service.generateReplacementMeal(profile, 'DINNER' as any, criteria)).resolves.toEqual(meal);

    const prompt = generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(prompt).toContain('DINNER');
    expect(prompt).toContain('NUTS');
    expect(prompt).toContain('cena liviana');
    expect(prompt).toContain('30 minutos');
  });

  it('pide a Gemini que clasifique la receta en categories (del enum) y properties', async () => {
    const generateContent = jest.fn().mockResolvedValue({ response: { text: () => '{}' } });
    const { service, getGenerativeModel } = setup(generateContent);

    await service.generateReplacementMeal(profile, 'DINNER' as any, criteria);

    const schema: any = (getGenerativeModel.mock.calls[0] as any)[0].generationConfig.responseSchema;
    expect(schema.properties.recipe.properties.categories.items.enum).toEqual(expect.arrayContaining(['VEGAN', 'VEGETARIAN']));
    expect(schema.properties.recipe.properties.properties.type).toBe('array');
  });

  it('devuelve null si la respuesta no es JSON (el servicio lo rechaza con 422)', async () => {
    const generateContent = jest.fn().mockResolvedValue({ response: { text: () => 'no es json' } });
    const { service } = setup(generateContent);

    await expect(service.generateReplacementMeal(profile, 'DINNER' as any, criteria)).resolves.toBeNull();
  });

  it('lanza AiProviderUnavailableError(AI_PROVIDER_ERROR) si el SDK falla', async () => {
    const { service } = setup(jest.fn().mockRejectedValue(new Error('500 from provider')));

    await expect(service.generateReplacementMeal(profile, 'DINNER' as any, criteria)).rejects.toMatchObject({
      name: 'AiProviderUnavailableError',
      reason: 'AI_PROVIDER_ERROR',
    });
  });

  it('aborta a los 15 s y lanza AiProviderUnavailableError(AI_TIMEOUT)', async () => {
    jest.useFakeTimers();
    const generateContent = jest.fn((_request: unknown, options: any) => new Promise((_resolve, reject) => {
      options.requestOptions.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));
    const { service } = setup(generateContent);

    const pending = service.generateReplacementMeal(profile, 'DINNER' as any, criteria);
    const assertion = expect(pending).rejects.toBeInstanceOf(AiProviderUnavailableError);
    await jest.advanceTimersByTimeAsync(15000);

    await assertion;
    await expect(pending).rejects.toMatchObject({ reason: 'AI_TIMEOUT' });
  });
});
