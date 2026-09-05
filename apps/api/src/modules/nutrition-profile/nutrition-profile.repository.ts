import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NutritionProfile } from '../../generated/prisma/client';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class NutritionProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string): Promise<NutritionProfile | null> {
    return this.prisma.nutritionProfile.findUnique({
      where: { userId },
    });
  }

  async upsert(userId: string, data: UpdateProfileDto): Promise<NutritionProfile> {
    return this.prisma.nutritionProfile.upsert({ // Metodo upsert (update + insert) nativo de nest. 
      where: { userId },
      update: {
        goal: data.goal,
        diet: data.diet,
        excludedIngredients: data.excludedIngredients || [],
        cookTimePreference: data.cookTimePreference,
      },
      create: {
        userId,
        goal: data.goal,
        diet: data.diet,
        excludedIngredients: data.excludedIngredients || [],
        cookTimePreference: data.cookTimePreference,
      },
    });
  }
}
