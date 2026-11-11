import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ShoppingListQueryDto } from '../dto/shopping-list-query.dto';

describe('ShoppingListQueryDto', () => {
  it('accepts a real Monday in the exact YYYY-MM-DD calendar format', async () => {
    const dto = plainToInstance(ShoppingListQueryDto, { weekStart: '2026-10-19' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.weekStart).toBe('2026-10-19');
  });

  it.each([
    {},
    { weekStart: '' },
    { weekStart: '2026-1-19' },
    { weekStart: '19-10-2026' },
    { weekStart: '2026-02-30' },
    { weekStart: '2026-10-20' },
    { weekStart: ['2026-10-19', '2026-10-26'] },
  ])('rejects missing, malformed, impossible, non-Monday, or repeated weekStart: %o', async (input) => {
    const dto = plainToInstance(ShoppingListQueryDto, input);

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it.each([
    ['a real Tuesday', '2026-10-20'],
    ['an impossible calendar date', '2026-02-30'],
    ['a malformed date', '2026-1-19'],
    ['a timestamp', '2026-10-19T00:00:00.000Z'],
  ])('rejects %s with HTTP 400 through the Nest validation pipe', async (_description, weekStart) => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });

    await expect(pipe.transform(
      { weekStart },
      { type: 'query', metatype: ShoppingListQueryDto },
    )).rejects.toMatchObject({ status: 400 });
  });

  it('rejects unknown query fields under the application validation policy', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });

    await expect(pipe.transform(
      { weekStart: '2026-10-19', userId: 'another-user' },
      { type: 'query', metatype: ShoppingListQueryDto },
    )).rejects.toMatchObject({ status: 400 });
  });
});
