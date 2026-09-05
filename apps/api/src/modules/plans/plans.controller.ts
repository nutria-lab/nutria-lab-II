import { Controller, Post, Get, Body, Query, Req, UseGuards, HttpCode } from '@nestjs/common';
import { PlansService } from './plans.service';
import { PlanDto } from './dto/plan.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('meal-plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Post('generate')
  @HttpCode(201)
  async generatePlan(@Req() req: any, @Body() dto: PlanDto) {
    const userId = req.user.id;
    return this.plansService.generateAndPersistPlan(userId, new Date(dto.weekStart));
  }

  @Get('current')
  async getCurrentPlan(@Req() req: any, @Body() dto: PlanDto) {
    const userId = req.user.id;
    return this.plansService.getPlanByWeek(userId, new Date(dto.weekStart));
  }
}
