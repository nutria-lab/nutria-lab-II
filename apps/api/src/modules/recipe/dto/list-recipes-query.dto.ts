import { Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  Max,
  Min,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import { normalizeProperties } from '@/utils/normalize-properties.util';

function IsNonBlankText(maxLength: number) {
  return ValidateBy({
    name: 'isNonBlankText',
    constraints: [maxLength],
    validator: {
      validate(value: unknown) {
        return (
          typeof value === 'string' &&
          value.trim().length > 0 &&
          value.trim().length <= maxLength
        );
      },
    },
  });
}

function IsPropertiesCsv() {
  return ValidateBy({
    name: 'isPropertiesCsv',
    validator: {
      validate(value: unknown) {
        if (typeof value !== 'string' || value.length === 0) {
          return false;
        }

        const entries = value.split(',');
        if (entries.some((entry) => entry.trim().length === 0)) {
          return false;
        }

        return normalizeProperties(entries).length <= 10;
      },
    },
  });
}

export class ListRecipesQueryDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNonBlankText(100)
  q?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsPropertiesCsv()
  properties?: string;

  @ValidateIf((_, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  maxPrepMinutes?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 12;
}
