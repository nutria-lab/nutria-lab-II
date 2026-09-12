import { Module } from '@nestjs/common';
import { IngredientService } from './ingredient.service';
import { IngredientController } from './ingredient.controller';
import { IngredientRepository } from './ingredient.repository';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [IngredientController],
  providers: [IngredientService, IngredientRepository],
  exports: [IngredientService, IngredientRepository],
})
export class IngredientModule {}
