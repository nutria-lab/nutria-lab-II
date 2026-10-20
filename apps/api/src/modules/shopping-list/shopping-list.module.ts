import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth/auth.module';
import { ShoppingListController } from './shopping-list.controller';
import { ShoppingListRepository } from './shopping-list.repository';
import { ShoppingListService } from './shopping-list.service';

@Module({
  imports: [AuthModule],
  controllers: [ShoppingListController],
  providers: [ShoppingListService, ShoppingListRepository],
})
export class ShoppingListModule {}
