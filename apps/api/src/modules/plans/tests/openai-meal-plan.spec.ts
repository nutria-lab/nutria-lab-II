import { OpenAIService } from '../../openai/openai.service';

const profile = { diet: 'VEGAN', goal: 'MAINTAIN', excludedIngredients: ['NUTS'], cookTimePreference: 'QUICK' } as any;
const startDate = new Date('2026-09-14T00:00:00Z');

describe('OpenAIService.generateMealPlan', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); jest.restoreAllMocks(); });

  it('returns structured output and starts with GPT-6 Luna without reasoning', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"days":[]}' }] }] }) }) as any;
    const service = new OpenAIService({ get: () => 'test-key' } as any);

    await expect(service.generateMealPlan(profile, startDate)).resolves.toBe('{"days":[]}');
    const request = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(request.model).toBe('gpt-6-luna');
    expect(request.reasoning.effort).toBe('none');
    expect(request.text.format.strict).toBe(true);
  });
});
