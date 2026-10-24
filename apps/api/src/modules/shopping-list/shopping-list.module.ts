import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth/auth.module';
import { ShoppingListController } from './shopping-list.controller';
import { ShoppingListItemKeyPipe } from './shopping-list-item-key.pipe';
import { ShoppingListRepository } from './shopping-list.repository';
import { ShoppingListService } from './shopping-list.service';

@Module({
  imports: [AuthModule],
  controllers: [ShoppingListController],
  providers: [ShoppingListService, ShoppingListRepository, ShoppingListItemKeyPipe],
})
export class ShoppingListModule {}
