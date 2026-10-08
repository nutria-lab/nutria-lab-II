import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@/prisma/prisma.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { RecipeModule } from '@/modules/recipe/recipe.module';
import { NutritionProfileModule } from '@/modules/nutrition-profile/nutrition-profile.module';
import { UnsplashModule } from '@/modules/unsplash/unsplash.module';
import { RecipeGenerationController } from './recipe-generation.controller';
import { RecipeGenerationRepository } from './recipe-generation.repository';
import { RecipeGenerationService } from './recipe-generation.service';
import { GeminiRecipeGenerationProvider, RECIPE_GENERATION_PROVIDER } from './recipe-generation.ports';

@Module({
  imports: [ConfigModule, PrismaModule, AuthModule, RecipeModule, NutritionProfileModule, UnsplashModule],
  controllers: [RecipeGenerationController],
  providers: [
    RecipeGenerationRepository,
    RecipeGenerationService,
    { provide: RECIPE_GENERATION_PROVIDER, useClass: GeminiRecipeGenerationProvider },
  ],
})
export class RecipeGenerationModule {}
