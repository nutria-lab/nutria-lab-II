import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Put, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, AuthenticatedRequest } from '@/modules/auth/guards/jwt-auth.guard';
import { AdherenceService } from './adherence.service';
import { AdherenceWeekQueryDto } from './dto/adherence-week-query.dto';
import { SetMealStatusDto } from './dto/set-meal-status.dto';

@Controller('adherence')
@UseGuards(JwtAuthGuard)
export class AdherenceController {
  constructor(private readonly service: AdherenceService) {}

  @Get()
  getAdherence(@Query() query: AdherenceWeekQueryDto, @Req() request: AuthenticatedRequest) {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return this.service.getForWeek(userId, query.weekStart);
  }

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
