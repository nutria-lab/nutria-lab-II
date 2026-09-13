import { Module } from '@nestjs/common'; 
import { PrismaModule } from '@/prisma/prisma.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { RecipeController } from '@/modules/recipe/recipe.controller';
import { RecipeService } from '@/modules/recipe/recipe.service';
import { RecipeRepository } from './recipe.repository';


@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [RecipeController],
  providers: [RecipeService, RecipeRepository],
  exports: [RecipeService, RecipeRepository]
})
export class RecipeModule {}
