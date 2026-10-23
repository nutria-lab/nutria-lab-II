import { Injectable } from '@nestjs/common';
import { AdherenceRepository } from './adherence.repository';
import { SetMealStatusDto } from './dto/set-meal-status.dto';

@Injectable()
export class AdherenceService {
  constructor(private readonly repository: AdherenceRepository) {}

  async setMealStatus(userId: string, plannedMealId: string, input: SetMealStatusDto) {
    const completion = await this.repository.setMealStatus(userId, plannedMealId, input);
    return {
      plannedMealId: completion.plannedMealId,
      status: completion.status,
      updatedAt: completion.updatedAt.toISOString(),
    };
  }
}
