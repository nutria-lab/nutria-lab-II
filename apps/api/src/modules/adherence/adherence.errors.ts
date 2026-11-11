import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

// Linear no define el literal del 404; mantener la decisión provisional en un solo lugar.
export const ADHERENCE_MEAL_NOT_FOUND_CODE = 'ADHERENCE_MEAL_NOT_FOUND';
export const ADHERENCE_STALE_CODE = 'ADHERENCE_STALE';
export const MEAL_IN_FUTURE_CODE = 'MEAL_IN_FUTURE';

export function adherenceMealNotFound(): NotFoundException {
  return new NotFoundException({
    statusCode: 404,
    error: 'Not Found',
    message: 'Planned meal not found',
    code: ADHERENCE_MEAL_NOT_FOUND_CODE,
  });
}

export function adherenceStale(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: 'The meal plan changed; reload it before trying again',
    code: ADHERENCE_STALE_CODE,
  });
}

export function mealInFuture(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: 'A future meal cannot be logged',
    code: MEAL_IN_FUTURE_CODE,
  });
}
