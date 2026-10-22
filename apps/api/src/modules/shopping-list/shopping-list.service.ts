import { Injectable } from '@nestjs/common';
import { ShoppingListRepository } from './shopping-list.repository';
import { transformShoppingList } from './shopping-list.transform';
import { ShoppingListResponse } from './shopping-list.types';

@Injectable()
export class ShoppingListService {
  constructor(private readonly repository: ShoppingListRepository) {}

  async getForWeek(userId: string, weekStart: string): Promise<ShoppingListResponse> {
    const plan = await this.repository.findCurrentPlan(userId, weekStart);
    return transformShoppingList(weekStart, plan);
  }
}
