import { ConflictException, NotFoundException } from '@nestjs/common';

// The absent-key precedence and 404 literal await the contract clarification.
// Keep both decisions here so the transaction and persistence remain unchanged.
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

export function shoppingItemAbsentWithCurrentToken(): ConflictException {
  // Provisional: an opaque key may be fabricated or stale after a recipe edit
  // that did not update MealPlan.updatedAt. Treat it as stale for now.
  return shoppingListStale();
}
