import { Inject, Injectable } from '@nestjs/common';
import { ADHERENCE_CLOCK, AdherenceRepository, dateInBuenosAires } from './adherence.repository';
import { transformAdherence } from './adherence.transform';
import { AdherenceSnapshot } from './adherence.types';
import { SetMealStatusDto } from './dto/set-meal-status.dto';

@Injectable()
export class AdherenceService {
  constructor(
    private readonly repository: AdherenceRepository,
    @Inject(ADHERENCE_CLOCK) private readonly clock: () => Date = () => new Date(),
  ) {}

  async getForWeek(userId: string, weekStart: string) {
    const today = dateInBuenosAires(this.clock());
    const snapshot: AdherenceSnapshot = await this.repository.getCurrentSnapshot(userId, weekStart);
    return transformAdherence(weekStart, snapshot, today);
  }

  async setMealStatus(userId: string, plannedMealId: string, input: SetMealStatusDto) {
    const completion = await this.repository.setMealStatus(userId, plannedMealId, input);
    return {
      plannedMealId: completion.plannedMealId,
      status: completion.status,
      updatedAt: completion.updatedAt.toISOString(),
    };
  }
}
