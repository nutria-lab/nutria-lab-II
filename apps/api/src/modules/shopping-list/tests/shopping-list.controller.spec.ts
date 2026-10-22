import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ShoppingListController } from '../shopping-list.controller';
import { ShoppingListService } from '../shopping-list.service';

describe('ShoppingListController', () => {
  const response = {
    weekStart: '2026-10-19',
    plan: null,
    items: [],
    summary: { totalItems: 0, checkedItems: 0 },
    warnings: [],
  };

  it('exposes only the authenticated GET /shopping-list route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ShoppingListController)).toBe('shopping-list');
    expect(['', '/']).toContain(Reflect.getMetadata(PATH_METADATA, ShoppingListController.prototype.getShoppingList));
    expect(Reflect.getMetadata(METHOD_METADATA, ShoppingListController.prototype.getShoppingList)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(GUARDS_METADATA, ShoppingListController)).toContain(JwtAuthGuard);
  });

  it('derives userId from the verified request session and delegates the requested calendar week', async () => {
    const service = { getForWeek: jest.fn().mockResolvedValue(response) } as unknown as jest.Mocked<ShoppingListService>;
    const controller = new ShoppingListController(service);
    const request = { user: { sub: 'session-user', email: 'session@example.test' } };

    await expect(controller.getShoppingList(request as never, {
      weekStart: '2026-10-19',
      userId: 'attacker-user',
    } as never)).resolves.toEqual(response);

    expect(service.getForWeek).toHaveBeenCalledTimes(1);
    expect(service.getForWeek).toHaveBeenCalledWith('session-user', '2026-10-19');
  });
});
