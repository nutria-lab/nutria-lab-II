import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { RecipeController } from '@/modules/recipe/recipe.controller';
import { RecipeService } from '@/modules/recipe/recipe.service';
import { RecipeRepository } from './recipe.repository';
import { UnsplashModule } from '@/modules/unsplash/unsplash.module';
import { NutritionProfileModule } from '@/modules/nutrition-profile/nutrition-profile.module';
import { RecipeCoverageService } from './recipe-coverage.service';


@Module({
  imports: [PrismaModule, AuthModule, NutritionProfileModule, UnsplashModule],
  controllers: [RecipeController],
  providers: [RecipeService, RecipeRepository, RecipeCoverageService],
  exports: [RecipeService, RecipeRepository, RecipeCoverageService]
})
export class RecipeModule {}
