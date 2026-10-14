import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { RecipeCategory } from '@/generated/prisma/client';
import { normalizeProperties } from '@/utils/normalize-properties.util';

export enum GeneratedRecipeMode {
  SINGLE = 'SINGLE',
  BATCH = 'BATCH',
}

export enum GeneratedRecipeCountMode {
  TOTAL_DESIRED = 'TOTAL_DESIRED',
  NEW_ONLY = 'NEW_ONLY',
}

@ValidatorConstraint({ name: 'previewGeneratedRecipeShape', async: false })
class PreviewGeneratedRecipeShape implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const value = args.object as PreviewGeneratedRecipesDto;
    if (value.mode === GeneratedRecipeMode.SINGLE) {
      return value.count === 1 && typeof value.description === 'string' && value.description.trim().length >= 10 && value.description.trim().length <= 1000 && value.topic === undefined;
    }
    return value.mode === GeneratedRecipeMode.BATCH && typeof value.topic === 'string' && value.topic.trim().length >= 3 && value.topic.trim().length <= 200 && value.description === undefined;
  }

  defaultMessage(): string {
    return 'SINGLE requires count 1 and a description; BATCH requires a topic';
  }
}

@ValidatorConstraint({ name: 'normalizedProperties', async: false })
class NormalizedProperties implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined) return true;
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) return false;
    return normalizeProperties(value).length === value.length;
  }
}

export class PreviewGeneratedRecipesDto {
  @IsEnum(GeneratedRecipeMode)
  mode!: 'SINGLE' | 'BATCH';

  @IsEnum(GeneratedRecipeCountMode)
  countMode!: 'TOTAL_DESIRED' | 'NEW_ONLY';

  @IsInt()
  @Min(1)
  @Max(10)
  count!: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  topic?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsEnum(RecipeCategory, { each: true })
  categories?: RecipeCategory[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @Validate(NormalizedProperties)
  properties?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  maxPrepMinutes?: number;

  @Validate(PreviewGeneratedRecipeShape)
  private readonly requestShape?: true;
}
