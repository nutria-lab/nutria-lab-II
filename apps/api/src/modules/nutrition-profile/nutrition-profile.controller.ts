import { Controller, Get, Put, Body, Req, UseGuards, HttpCode } from '@nestjs/common';
import { NutritionProfileService } from '@/modules/nutrition-profile/nutrition-profile.service';
import { UpdateProfileDto } from '@/modules/nutrition-profile/dto/update-profile.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('nutrition-profile')
export class NutritionProfileController {
  constructor(private readonly profileService: NutritionProfileService) {}

  @Get()
  async getProfile(@Req() req: any) {
    const userId = req.user.sub;
    return this.profileService.getProfile(userId);
  }

  @Put()
  @HttpCode(200)
  async updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    const userId = req.user.sub;
    return this.profileService.upsertProfile(userId, dto);
  }
}
