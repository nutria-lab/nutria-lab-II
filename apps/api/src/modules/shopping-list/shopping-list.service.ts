import { Injectable } from '@nestjs/common';
import { ShoppingListRepository } from './shopping-list.repository';
import { transformShoppingList } from './shopping-list.transform';
import { ShoppingListResponse } from './shopping-list.types';
import { ShoppingListItemCheckDto } from './dto/shopping-list-item-check.dto';

@Injectable()
export class ShoppingListService {
  constructor(private readonly repository: ShoppingListRepository) {}

  async getForWeek(userId: string, weekStart: string): Promise<ShoppingListResponse> {
    const { plan, checks } = await this.repository.getCurrentSnapshot(userId, weekStart);
    const response = transformShoppingList(weekStart, plan);
    const checkedByKey = new Map(checks.map(({ itemKey, checked }) => [itemKey, checked]));
    for (const item of response.items) item.checked = checkedByKey.get(item.key) === true;
    response.summary.checkedItems = response.items.filter((item) => item.checked).length;
    return response;
  }

  async setChecked(userId: string, itemKey: string, input: ShoppingListItemCheckDto): Promise<{ itemKey: string; checked: boolean }> {
    await this.repository.setChecked(userId, itemKey, input);
    return { itemKey, checked: input.checked };
  }
}
