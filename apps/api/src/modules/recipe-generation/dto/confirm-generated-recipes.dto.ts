import { ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class ConfirmGeneratedRecipesDto {
  @IsUUID()
  generationRunId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  draftIds!: string[];
}
