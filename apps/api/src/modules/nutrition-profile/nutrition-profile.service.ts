import { Injectable, NotFoundException } from '@nestjs/common';
import { NutritionProfileRepository } from './nutrition-profile.repository';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class NutritionProfileService {
  constructor(private readonly repository: NutritionProfileRepository) {}

  async getProfile(userId: string) {
    const profile = await this.repository.findByUserId(userId);

    if (!profile) {
      throw new NotFoundException('Nutrition profile not found');
    }

    return {
      goal: profile.goal,
      diet: profile.diet,
      excludedIngredients: profile.excludedIngredients,
      cookTimePreference: profile.cookTimePreference,
    };
  }

  // UPDATE + INSERT
  async upsertProfile(userId: string, dto: UpdateProfileDto) {
    const profile = await this.repository.upsert(userId, dto);

    return {
      goal: profile.goal,
      diet: profile.diet,
      excludedIngredients: profile.excludedIngredients,
      cookTimePreference: profile.cookTimePreference,
    };
  }
}
