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

  it('records each provider fallback attempt at the fetch boundary', async () => {
    const first = { ok: false, status: 429 };
    const second = { ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"days":[]}' }] }] }) };
    global.fetch = jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second) as any;
    const calls: string[] = [];
    const instrumentation = {
      run: async (dependency: string, call: () => Promise<unknown>, classify: (result: unknown) => string) => {
        calls.push(dependency);
        try {
          const value = await call();
          classify({ ok: true, value });
          return value;
        } catch (error) {
          classify({ ok: false, error });
          throw error;
        }
      },
    };
    const service = new OpenAIService({ get: () => 'test-key' } as any, instrumentation as any);

    await expect(service.generateMealPlan(profile, startDate)).resolves.toBe('{"days":[]}');
    expect(calls).toEqual(['openai', 'openai']);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
