import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ReplaceMealDto } from '../dto';

// Mismas opciones que el ValidationPipe global de main.ts.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = (body: unknown) => pipe.transform(body, { type: 'body', metatype: ReplaceMealDto });

describe('ReplaceMealDto', () => {
  it('acepta un body vacío', async () => {
    await expect(validate({})).resolves.toBeInstanceOf(ReplaceMealDto);
  });

  it('acepta el body completo del ticket', async () => {
    await expect(
      validate({ topic: 'cena liviana', categories: ['VEGETARIAN'], properties: [], maxPrepMinutes: 30 }),
    ).resolves.toBeInstanceOf(ReplaceMealDto);
  });

  it.each([
    ['una categoría inexistente', { categories: ['PIZZA'] }],
    ['maxPrepMinutes en 0', { maxPrepMinutes: 0 }],
    ['maxPrepMinutes con decimales', { maxPrepMinutes: 10.5 }],
    ['properties que no son strings', { properties: [1, 2] }],
    ['un campo desconocido', { relaxRestrictions: true }],
  ])('responde 400 con %s', async (_label, body) => {
    await expect(validate(body)).rejects.toBeInstanceOf(BadRequestException);
  });
});
