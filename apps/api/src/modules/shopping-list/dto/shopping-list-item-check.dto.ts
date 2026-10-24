import { IsBoolean, IsUUID, Matches, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

@ValidatorConstraint({ name: 'isShoppingListUtcToken', async: false })
class IsShoppingListUtcTokenConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      && !Number.isNaN(Date.parse(value))
      && new Date(value).toISOString() === value;
  }

  defaultMessage(): string {
    return 'planUpdatedAt must be the exact ISO UTC token returned by GET';
  }
}

export class ShoppingListItemCheckDto {
  @IsUUID()
  planId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  @Validate(IsShoppingListUtcTokenConstraint)
  planUpdatedAt!: string;

  @IsBoolean()
  checked!: boolean;
}
