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

@Module({
  imports: [PrismaModule, ConfigModule, AuthModule, RecipeModule],
  controllers: [PlansController],
  providers: [PlansService, GeminiService, PlansRepository, MealReplacementService],
  exports: [PlansService, PlansRepository]
})
export class PlansModule {}
