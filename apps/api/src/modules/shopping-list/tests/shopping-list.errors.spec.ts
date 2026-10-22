import {
  SHOPPING_ITEM_NOT_FOUND_CODE,
  shoppingItemAbsentWithCurrentToken,
  shoppingItemNotFound,
  shoppingListStale,
} from '../shopping-list.errors';

// The only test that fixes the two human-pending choices. Once Linear clarifies
// absent-key precedence and the 404 literal, this is the assertion to update.
describe('Shopping-list provisional error policy', () => {
  it('uses a generic 404 for a missing or foreign plan without disclosing ownership', () => {
    const error = shoppingItemNotFound();
    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Shopping item not found',
      code: SHOPPING_ITEM_NOT_FOUND_CODE,
    });
    expect(SHOPPING_ITEM_NOT_FOUND_CODE).toBe('SHOPPING_ITEM_NOT_FOUND');
  });

  it('provisionally treats a missing key under a current plan and exact token as stale', () => {
    const error = shoppingItemAbsentWithCurrentToken();
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
      code: 'SHOPPING_LIST_STALE',
    });
  });

  it('uses the required stable code and full Nest envelope for an obsolete plan token', () => {
    const error = shoppingListStale();
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
      code: 'SHOPPING_LIST_STALE',
    });
  });
});
