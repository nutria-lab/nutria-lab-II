import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@/prisma/prisma.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { PlansModule } from './modules/plans/plans.module';
import { NutritionProfileModule } from '@/modules/nutrition-profile/nutrition-profile.module';
import { RecipeModule } from '@/modules/recipe/recipe.module';
import { IngredientModule } from '@/modules/ingredient/ingredient.module';
import { KpiModule } from '@/modules/kpi/kpi.module';
import { KpiPublisherModule } from '@/modules/kpi/kpi-publisher.module';
import { RecipeGenerationModule } from '@/modules/recipe-generation/recipe-generation.module';
import { AccessModule } from '@/modules/access/access.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    PlansModule,
    NutritionProfileModule,
    RecipeModule,
    IngredientModule,
    KpiModule,
    KpiPublisherModule,
    RecipeGenerationModule,
    AccessModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
