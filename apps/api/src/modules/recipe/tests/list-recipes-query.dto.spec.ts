import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListRecipesQueryDto } from '../dto/list-recipes-query.dto';

async function invalidProperties(input: object): Promise<string[]> {
  const dto = plainToInstance(ListRecipesQueryDto, input);
  const errors = await validate(dto);
  return errors.map((error) => error.property);
}

describe('ListRecipesQueryDto', () => {
  it('applies pagination defaults and accepts valid optional filters', async () => {
    const dto = plainToInstance(ListRecipesQueryDto, {
      q: ' avena ',
      properties: ' Sin Gluten , Alto en Fibra ',
      maxPrepMinutes: '30',
      page: '2',
      pageSize: '8',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.q).toBe(' avena ');
    expect(dto.properties).toBe(' Sin Gluten , Alto en Fibra ');
    expect(dto.maxPrepMinutes).toBe(30);
    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(8);
  });

  it('defaults page and pageSize when they are omitted', async () => {
    const dto = plainToInstance(ListRecipesQueryDto, {});

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(12);
  });

  it('accepts inclusive numeric bounds and trims q only after validation', async () => {
    const dto = plainToInstance(ListRecipesQueryDto, {
      q: ` ${'x'.repeat(100)} `,
      maxPrepMinutes: '1440',
      page: '1',
      pageSize: '50',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.q).toBe(` ${'x'.repeat(100)} `);
    expect(dto.maxPrepMinutes).toBe(1440);
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(50);
  });

  it.each([
    [{ page: '0' }],
    [{ page: '1.5' }],
    [{ pageSize: '0' }],
    [{ pageSize: '51' }],
    [{ pageSize: '12.5' }],
    [{ maxPrepMinutes: '0' }],
    [{ maxPrepMinutes: '1441' }],
    [{ maxPrepMinutes: 'five' }],
  ])('rejects an out-of-range or non-integer numeric query: %o', async (input) => {
    expect(await invalidProperties(input)).not.toHaveLength(0);
  });

  it.each([
    [{ q: '   ' }],
    [{ q: 'x'.repeat(101) }],
    [{ properties: '' }],
    [{ properties: 'vegana,' }],
    [{ properties: ',sin gluten' }],
    [{ properties: 'vegana,,sin gluten' }],
    [{ properties: ['vegana', 'sin gluten'] }],
    [{ properties: Array.from({ length: 11 }, (_, index) => `propiedad ${index + 1}`).join(',') }],
    [{ q: ['avena', 'pan'] }],
    [{ maxPrepMinutes: ['20', '30'] }],
  ])('rejects malformed text, CSV, or repeated filters: %o', async (input) => {
    expect(await invalidProperties(input)).not.toHaveLength(0);
  });

  it('allows more than ten CSV segments when normalization deduplicates them to ten properties', async () => {
    const dto = plainToInstance(ListRecipesQueryDto, {
      properties: 'Vegana,Sin gluten,ALTO EN FIBRA,Proteica,Rápida,Económica,Sin lactosa,Integral,Vegetariana,Light,vegana',
    });

    expect(await validate(dto)).toHaveLength(0);
  });
});
