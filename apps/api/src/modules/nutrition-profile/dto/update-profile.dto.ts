import { IsEnum, IsArray, ArrayUnique } from 'class-validator';
import { NutritionGoal, Diet, DietaryRestriction, CookTimePreference } from '../../../generated/prisma/client';

export class UpdateProfileDto {
  @IsEnum(NutritionGoal)
  goal!: NutritionGoal;

  @IsEnum(Diet)
  diet!: Diet;

  @IsArray()
  @IsEnum(DietaryRestriction, { each: true })
  @ArrayUnique()
  excludedIngredients!: DietaryRestriction[];

  @IsEnum(CookTimePreference)
  cookTimePreference!: CookTimePreference;
}
