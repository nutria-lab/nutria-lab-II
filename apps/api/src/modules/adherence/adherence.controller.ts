import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Put, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, AuthenticatedRequest } from '@/modules/auth/guards/jwt-auth.guard';
import { AdherenceService } from './adherence.service';
import { SetMealStatusDto } from './dto/set-meal-status.dto';

@Controller('adherence')
@UseGuards(JwtAuthGuard)
export class AdherenceController {
  constructor(private readonly service: AdherenceService) {}

  @Put('meals/:plannedMealId')
  @HttpCode(HttpStatus.OK)
  setMealStatus(
    @Param('plannedMealId', ParseUUIDPipe) plannedMealId: string,
    @Body() input: SetMealStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return this.service.setMealStatus(userId, plannedMealId, input);
  }
}
