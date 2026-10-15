import { OpenAIService } from '../../openai/openai.service';

const profile = { diet: 'VEGETARIAN', goal: 'MAINTAIN', excludedIngredients: ['NUTS'], cookTimePreference: 'QUICK' } as any;
const criteria = { topic: 'cena liviana', categories: ['VEGETARIAN'], properties: [], maxPrepMinutes: 30 };

describe('OpenAIService.generateReplacementMeal', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

  it('sends the replacement context using the strict structured output contract', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"title":"Wok"}' }] }] }) }) as any;
    const service = new OpenAIService({ get: () => 'test-key' } as any);

    await expect(service.generateReplacementMeal(profile, 'DINNER', criteria)).resolves.toBe('{"title":"Wok"}');
    const request = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(request.input).toContain('DINNER');
    expect(request.input).toContain('NUTS');
    expect(request.input).toContain('cena liviana');
    expect(request.text.format.strict).toBe(true);
  });
});
