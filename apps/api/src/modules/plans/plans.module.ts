import { Module } from '@nestjs/common';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { PlansRepository } from './plans.repository';
import { GeminiService } from './gemini/gemini.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { RecipeModule } from '../recipe/recipe.module';
import { MealReplacementService } from './meal-replacement.service';
import { RecipeValidationService } from './recipe-validation.service';
import { UnsplashModule } from '@/modules/unsplash/unsplash.module';

@Module({
  imports: [PrismaModule, ConfigModule, AuthModule, RecipeModule, UnsplashModule],
  controllers: [PlansController],
  providers: [PlansService, GeminiService, PlansRepository, MealReplacementService, RecipeValidationService],
  exports: [PlansService, PlansRepository]
})
export class PlansModule {}
