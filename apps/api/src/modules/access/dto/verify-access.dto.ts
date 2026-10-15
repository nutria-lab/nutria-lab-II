import { IsString, MinLength } from 'class-validator';

export class VerifyAccessDto {
  @IsString()
  @MinLength(1)
  password!: string;
}