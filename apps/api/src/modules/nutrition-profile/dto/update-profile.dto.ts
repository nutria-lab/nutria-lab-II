import { IsEnum, IsArray, ArrayUnique, IsOptional } from 'class-validator';
import { NutritionGoal, Diet, DietaryRestriction, CookTimePreference } from '../../../generated/prisma/client';

export class UpdateProfileDto {
  @IsEnum(NutritionGoal)
  goal!: NutritionGoal;

  @IsEnum(Diet)
  diet!: Diet;

  @IsArray()
  @IsEnum(DietaryRestriction, { each: true })
  @ArrayUnique()
  @IsOptional()
  excludedIngredients!: DietaryRestriction[];

  @IsEnum(CookTimePreference)
  cookTimePreference!: CookTimePreference;
}
