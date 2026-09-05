import { Module } from '@nestjs/common';
import { NutritionProfileController } from './nutrition-profile.controller';
import { NutritionProfileService } from './nutrition-profile.service';
import { NutritionProfileRepository } from './nutrition-profile.repository';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [NutritionProfileController],
  providers: [NutritionProfileService, NutritionProfileRepository],
  exports: [NutritionProfileService, NutritionProfileRepository]
})
export class NutritionProfileModule {}
