import 'reflect-metadata';
import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { MealType } from '../../../generated/prisma/client';
import { AiProviderUnavailableError } from '../../openai/openai.service';
import { RecipeMealTypeClassifierService } from '../recipe-mealtype-classifier.service';

const response = (classifications: unknown) => JSON.stringify({ classifications });

describe('RecipeMealTypeClassifierService (NUT-76)', () => {
  const inputs = [
    { title: 'Avena con fruta', ingredients: [{ name: 'Avena', quantity: 40, unit: 'g' }] },
    { title: 'Ensalada tibia', ingredients: [{ name: 'Lentejas', quantity: 100, unit: 'g' }] },
  ];

  function create(raw: unknown = response([['SNACK', 'BREAKFAST'], []])) {
    const provider = { classify: jest.fn().mockResolvedValue(raw) };
    const service = new RecipeMealTypeClassifierService(provider as any);
    return { service, provider };
  }

  it('accepts multiple canonical meal types and an explicit empty set, preserving positional order', async () => {
    const { service, provider } = create(response([['SNACK', 'BREAKFAST'], []]));

    await expect(service.classify(inputs)).resolves.toEqual([
      [MealType.BREAKFAST, MealType.SNACK],
      [],
    ]);
    expect(provider.classify).toHaveBeenCalledTimes(1);
    expect(provider.classify).toHaveBeenCalledWith(inputs, expect.any(Function));
  });

  it.each([
    ['invalid JSON', 'not json'],
    ['missing output', ''],
    ['provider refusal', JSON.stringify({ refusal: 'I cannot classify these ingredients' })],
    ['missing classifications', JSON.stringify({})],
    ['extra response key', JSON.stringify({ classifications: [['BREAKFAST'], []], trace: 'unexpected' })],
    ['too few positional results', response([['BREAKFAST']])],
    ['too many positional results', response([['BREAKFAST'], [], ['DINNER']])],
    ['unknown MealType', response([['BRUNCH'], []])],
    ['duplicate MealType in one result', response([['LUNCH', 'LUNCH'], []])],
    ['non-array result', response(['DINNER', []])],
  ])('rejects %s as a recoverable invalid-AI response', async (_case, raw) => {
    const { service } = create(raw);

    await expect(service.classify(inputs)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('maps provider unavailability to the existing recoverable 503 boundary', async () => {
    const { service, provider } = create();
    provider.classify.mockRejectedValueOnce(new AiProviderUnavailableError('AI_TIMEOUT'));

    await expect(service.classify(inputs)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('does not add positional indexes or recipe identifiers to the classifier inputs', async () => {
    const restrictedInputs = inputs.map((item, index) => ({
      ...item,
      id: `private-recipe-${index}`,
      categories: ['HIGH_PROTEIN'],
      properties: ['KETO'],
      profile: { excludedIngredients: ['DAIRY'] },
    }));
    const { service, provider } = create(response([['BREAKFAST'], []]));

    await service.classify(restrictedInputs as any);

    expect(provider.classify).toHaveBeenCalledTimes(1);
    const sent = provider.classify.mock.calls[0][0];
    expect(sent).toEqual(inputs);
    expect(JSON.stringify(sent)).not.toMatch(/private-recipe|categories|properties|profile|excludedIngredients|index/i);
  });
});
