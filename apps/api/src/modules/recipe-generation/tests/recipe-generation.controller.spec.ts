import { BadRequestException } from '@nestjs/common';
import { RecipeGenerationController } from '../recipe-generation.controller';
import { RecipeGenerationService } from '../recipe-generation.service';

describe('RecipeGenerationController (NUT-73 transport contract)', () => {
  let controller: RecipeGenerationController;
  let service: jest.Mocked<Pick<RecipeGenerationService, 'preview' | 'confirm'>>;

  beforeEach(() => {
    service = { preview: jest.fn(), confirm: jest.fn() };
    controller = new RecipeGenerationController(service as unknown as RecipeGenerationService);
  });

  it.each([undefined, '', 'not-a-uuid'])('rejects an invalid Idempotency-Key before preview service I/O: %p', async idempotencyKey => {
    await expect(controller.preview({ user: { sub: 'user-1' } }, idempotencyKey as any, {} as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(service.preview).not.toHaveBeenCalled();
  });

  it('takes the identity only from JWT and delegates a valid preview header/body unchanged', async () => {
    const idempotencyKey = '11111111-1111-4111-8111-111111111111';
    const dto = { mode: 'SINGLE', countMode: 'NEW_ONLY', count: 1, description: 'Una cena vegana rápida y completa' } as any;
    service.preview.mockResolvedValue({ generationRunId: 'run-1' } as any);

    await controller.preview({ user: { sub: 'jwt-user' } }, idempotencyKey, dto);

    expect(service.preview).toHaveBeenCalledWith('jwt-user', idempotencyKey, dto);
  });

  it('delegates confirm with the JWT identity and preserves 201 semantics', async () => {
    const idempotencyKey = '11111111-1111-4111-8111-111111111111';
    const dto = { generationRunId: '22222222-2222-4222-8222-222222222222', draftIds: ['33333333-3333-4333-8333-333333333333'] } as any;
    service.confirm.mockResolvedValue({ generationRunId: dto.generationRunId, items: [] } as any);

    const result = await controller.confirm({ user: { sub: 'jwt-user' } }, idempotencyKey, dto);

    expect(result).toEqual({ generationRunId: dto.generationRunId, items: [] });
    expect(service.confirm).toHaveBeenCalledWith('jwt-user', idempotencyKey, dto);
  });
});
