import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ConfirmGeneratedRecipesDto } from '../dto/confirm-generated-recipes.dto';
import { PreviewGeneratedRecipesDto } from '../dto/preview-generated-recipes.dto';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const preview = (body: unknown) => pipe.transform(body, { type: 'body', metatype: PreviewGeneratedRecipesDto });
const confirm = (body: unknown) => pipe.transform(body, { type: 'body', metatype: ConfirmGeneratedRecipesDto });

describe('NUT-73 request DTOs', () => {
  it.each([
    { mode: 'SINGLE', countMode: 'TOTAL_DESIRED', count: 1, description: 'Una cena vegana rápida y completa' },
    { mode: 'BATCH', countMode: 'NEW_ONLY', count: 3, topic: 'cenas rápidas', categories: ['VEGAN'], properties: ['sin gluten'], maxPrepMinutes: 30 },
  ])('accepts a valid preview request: %#', async body => {
    await expect(preview(body)).resolves.toBeInstanceOf(PreviewGeneratedRecipesDto);
  });

  it.each([
    ['count outside 1..10', { mode: 'BATCH', countMode: 'NEW_ONLY', count: 11, topic: 'cenas' }],
    ['SINGLE with a count other than one', { mode: 'SINGLE', countMode: 'TOTAL_DESIRED', count: 2, description: 'Una cena vegana rápida y completa' }],
    ['SINGLE without a trimmed description of at least ten characters', { mode: 'SINGLE', countMode: 'TOTAL_DESIRED', count: 1, description: ' corta ' }],
    ['BATCH without a trimmed topic of at least three characters', { mode: 'BATCH', countMode: 'NEW_ONLY', count: 1, topic: ' x ' }],
    ['duplicate categories', { mode: 'BATCH', countMode: 'NEW_ONLY', count: 1, topic: 'cenas', categories: ['VEGAN', 'VEGAN'] }],
    ['properties duplicated after normalization', { mode: 'BATCH', countMode: 'NEW_ONLY', count: 1, topic: 'cenas', properties: [' sin gluten ', 'SIN   GLUTEN'] }],
    ['invalid maxPrepMinutes', { mode: 'BATCH', countMode: 'NEW_ONLY', count: 1, topic: 'cenas', maxPrepMinutes: 1441 }],
    ['an unknown or profile-owned restriction', { mode: 'BATCH', countMode: 'NEW_ONLY', count: 1, topic: 'cenas', dietaryRestrictions: ['NUTS'] }],
  ])('rejects %s', async (_label, body) => {
    await expect(preview(body)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an empty or duplicate confirm draft list', async () => {
    await expect(confirm({ generationRunId: '11111111-1111-4111-8111-111111111111', draftIds: [] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(confirm({ generationRunId: '11111111-1111-4111-8111-111111111111', draftIds: ['22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222'] })).rejects.toBeInstanceOf(BadRequestException);
  });
});
