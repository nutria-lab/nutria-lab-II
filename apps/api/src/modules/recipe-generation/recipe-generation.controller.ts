import { BadRequestException, Body, Controller, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { ConfirmGeneratedRecipesDto } from './dto/confirm-generated-recipes.dto';
import { PreviewGeneratedRecipesDto } from './dto/preview-generated-recipes.dto';
import { RecipeGenerationService } from './recipe-generation.service';

@UseGuards(JwtAuthGuard)
@Controller('ai/recipes')
export class RecipeGenerationController {
  constructor(private readonly service: RecipeGenerationService) {}

  @Post('preview')
  async preview(@Req() req: any, @Headers('idempotency-key') idempotencyKey: string | undefined, @Body() dto: PreviewGeneratedRecipesDto) {
    this.assertKey(idempotencyKey);
    return this.service.preview(req.user.sub, idempotencyKey!, dto);
  }

  @Post('confirm')
  @HttpCode(201)
  async confirm(@Req() req: any, @Headers('idempotency-key') idempotencyKey: string | undefined, @Body() dto: ConfirmGeneratedRecipesDto) {
    this.assertKey(idempotencyKey);
    return this.service.confirm(req.user.sub, idempotencyKey!, dto);
  }

  private assertKey(value: string | undefined): void {
    if (!value || !isUUID(value)) throw new BadRequestException('Idempotency-Key header must be a UUID');
  }
}
