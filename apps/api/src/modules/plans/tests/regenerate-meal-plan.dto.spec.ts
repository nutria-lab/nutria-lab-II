import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RegenerateMealPlanDto, RegenerationReason } from '../dto';

// Mismas opciones que el ValidationPipe global de main.ts.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = (body: unknown) => pipe.transform(body, { type: 'body', metatype: RegenerateMealPlanDto });

describe('RegenerateMealPlanDto (NUT-78)', () => {
  it('acepta reason USER_REQUESTED', async () => {
    await expect(validate({ reason: 'USER_REQUESTED' })).resolves.toEqual(
      expect.objectContaining({ reason: RegenerationReason.USER_REQUESTED }),
    );
  });

  it.each([
    ['sin reason', {}],
    ['un reason fuera del enum', { reason: 'BORED' }],
    ['reason en minúsculas', { reason: 'user_requested' }],
    ['un campo desconocido', { reason: 'USER_REQUESTED', keepMeals: true }],
  ])('responde 400 con %s', async (_label, body) => {
    await expect(validate(body)).rejects.toBeInstanceOf(BadRequestException);
  });
});
