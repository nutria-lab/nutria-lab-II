import { Module } from '@nestjs/common';
import { NutritionProfileController } from '@/modules/nutrition-profile/nutrition-profile.controller';
import { NutritionProfileService } from '@/modules/nutrition-profile/nutrition-profile.service';
import { NutritionProfileRepository } from '@/modules/nutrition-profile/nutrition-profile.repository';
import { PrismaModule } from '@/prisma/prisma.module';
import { AuthModule } from '@/modules/auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [NutritionProfileController],
  providers: [NutritionProfileService, NutritionProfileRepository],
  exports: [NutritionProfileService, NutritionProfileRepository]
})
export class NutritionProfileModule {}
