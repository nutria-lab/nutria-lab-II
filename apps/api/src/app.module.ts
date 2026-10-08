import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@/prisma/prisma.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { PlansModule } from './modules/plans/plans.module';
import { NutritionProfileModule } from '@/modules/nutrition-profile/nutrition-profile.module';
import { RecipeModule } from '@/modules/recipe/recipe.module';
import { IngredientModule } from '@/modules/ingredient/ingredient.module';
import { RecipeGenerationModule } from '@/modules/recipe-generation/recipe-generation.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    PlansModule,
    NutritionProfileModule,
    RecipeModule,
    IngredientModule,
    RecipeGenerationModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
