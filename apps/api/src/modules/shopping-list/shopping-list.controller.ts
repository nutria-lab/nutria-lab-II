import { Body, Controller, Get, Param, Patch, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { ShoppingListItemCheckDto } from './dto/shopping-list-item-check.dto';
import { ShoppingListQueryDto } from './dto/shopping-list-query.dto';
import { ShoppingListService } from './shopping-list.service';
import { ShoppingListItemKeyPipe } from './shopping-list-item-key.pipe';

@Controller('shopping-list')
@UseGuards(JwtAuthGuard)
export class ShoppingListController {
  constructor(private readonly shoppingListService: ShoppingListService) {}

  @Get()
  getShoppingList(@Req() request: AuthenticatedRequest, @Query() query: ShoppingListQueryDto) {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return this.shoppingListService.getForWeek(userId, query.weekStart);
  }

  @Patch('items/:itemKey')
  setChecked(
    @Req() request: AuthenticatedRequest,
    @Param('itemKey', ShoppingListItemKeyPipe) itemKey: string,
    @Body() input: ShoppingListItemCheckDto,
  ) {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return this.shoppingListService.setChecked(userId, itemKey, input);
  }
}
