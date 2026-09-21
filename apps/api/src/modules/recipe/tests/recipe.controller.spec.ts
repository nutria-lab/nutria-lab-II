import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RecipeController } from '../recipe.controller';
import { RecipeService } from '../recipe.service';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';

interface RecipeListCriteria {
  q?: string;
  properties?: string;
  maxPrepMinutes?: number;
  page?: number;
  pageSize?: number;
}

type FindAllWithQuery = (query: RecipeListCriteria) => Promise<unknown>;

describe('RecipeController.findAll', () => {
  let controller: RecipeController;
  let service: jest.Mocked<Pick<RecipeService, 'findAll'>>;
  let findAll: jest.Mock<Promise<unknown>, [RecipeListCriteria]>;

  beforeEach(() => {
    findAll = jest.fn<Promise<unknown>, [RecipeListCriteria]>();
    service = { findAll } as unknown as jest.Mocked<Pick<RecipeService, 'findAll'>>;
    controller = new RecipeController(service as unknown as RecipeService);
  });

  it('keeps the recipes listing behind the existing JWT guard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, RecipeController) as unknown[];

    expect(guards).toContain(JwtAuthGuard);
  });

  it('delegates the validated query exactly once and returns its paginated response unchanged', async () => {
    const query: RecipeListCriteria = {
      q: 'avena',
      properties: 'sin gluten',
      maxPrepMinutes: 30,
      page: 2,
      pageSize: 8,
    };
    const page = { items: [{ id: 'recipe-1', properties: ['Sin Gluten'] }], page: 2, pageSize: 8, total: 9 };
    findAll.mockResolvedValue(page);

    const result = await (controller.findAll as unknown as FindAllWithQuery)(query);

    expect(result).toEqual(page);
    expect(findAll).toHaveBeenCalledTimes(1);
    expect(findAll).toHaveBeenCalledWith(query);
  });

  it('uses the global closed-query validation convention before the service is called', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

    await expect(
      pipe.transform(
        { page: '0', unexpected: 'value' },
        { type: 'query', metatype: (await import('../dto/list-recipes-query.dto')).ListRecipesQueryDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(findAll).not.toHaveBeenCalled();
  });
});
