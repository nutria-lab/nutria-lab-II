import { ConflictException, NotFoundException } from '@nestjs/common';

export const SHOPPING_ITEM_NOT_FOUND_CODE = 'SHOPPING_ITEM_NOT_FOUND';
export const SHOPPING_LIST_STALE_CODE = 'SHOPPING_LIST_STALE';

export function shoppingItemNotFound(): NotFoundException {
  return new NotFoundException({
    statusCode: 404,
    error: 'Not Found',
    message: 'Shopping item not found',
    code: SHOPPING_ITEM_NOT_FOUND_CODE,
  });
}

export function shoppingListStale(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: 'Shopping list changed; reload it before trying again',
    code: SHOPPING_LIST_STALE_CODE,
  });
}

export function shoppingItemAbsentWithCurrentToken(): NotFoundException {
  // A valid key absent from the current aggregate with a current token is not found.
  return shoppingItemNotFound();
}
