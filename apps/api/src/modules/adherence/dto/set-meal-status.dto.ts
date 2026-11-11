import { IsEnum, IsUUID, Matches, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { MealCompletionStatus } from '@/generated/prisma/client';

@ValidatorConstraint({ name: 'isMealUpdatedAtUtcToken', async: false })
class IsMealUpdatedAtUtcTokenConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      && !Number.isNaN(Date.parse(value))
      && new Date(value).toISOString() === value;
  }

  defaultMessage(): string {
    return 'mealUpdatedAt must be the exact ISO UTC token returned by the meal plan';
  }
}

export class SetMealStatusDto {
  @IsUUID()
  planId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  @Validate(IsMealUpdatedAtUtcTokenConstraint)
  mealUpdatedAt!: string;

  @IsEnum(MealCompletionStatus)
  status!: MealCompletionStatus;
}
