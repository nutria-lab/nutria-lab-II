import { Controller, Get, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { ShoppingListQueryDto } from './dto/shopping-list-query.dto';
import { ShoppingListService } from './shopping-list.service';

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
}
