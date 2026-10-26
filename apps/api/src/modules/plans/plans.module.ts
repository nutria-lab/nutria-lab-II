import { Module } from '@nestjs/common';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { PlansRepository } from './plans.repository';
import { OpenAIModule } from '../openai/openai.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { RecipeModule } from '../recipe/recipe.module';
import { RecipeGenerationModule } from '../recipe-generation/recipe-generation.module';
import { MealReplacementService } from './meal-replacement.service';
import { RecipeValidationService } from './recipe-validation.service';
import { MealPlanRegenerationService } from './meal-plan-regeneration.service';
import { RecipeImagesService } from './recipe-images.service';
import { noClassifiedWeeklyRecipe, OpenAIWeeklyProposalComposer, WeeklyProposalComposer, WEEKLY_RECIPE_ELIGIBILITY_POLICY } from './weekly-proposal.composer';
import { UnsplashModule } from '@/modules/unsplash/unsplash.module';

@Module({
  imports: [PrismaModule, ConfigModule, AuthModule, RecipeModule, RecipeGenerationModule, UnsplashModule, OpenAIModule],
  controllers: [PlansController],
  providers: [PlansService, PlansRepository, MealReplacementService, RecipeValidationService, MealPlanRegenerationService, RecipeImagesService,
    // NUT-76 puede reemplazar la composición registrando otra implementación acá.
    { provide: WeeklyProposalComposer, useClass: OpenAIWeeklyProposalComposer },
    { provide: WEEKLY_RECIPE_ELIGIBILITY_POLICY, useValue: noClassifiedWeeklyRecipe },
  ],
  exports: [PlansService, PlansRepository]
})
export class PlansModule {}
