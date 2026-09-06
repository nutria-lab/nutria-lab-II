import { Controller, Post, Get, Put, Delete, Body, Query, Req, UseGuards, HttpCode } from '@nestjs/common';
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
    const userId = req.user.sub;
    return this.plansService.generateAndPersistPlan(userId, new Date(dto.weekStart));
  }

  @Post('generate-predefined')
  @HttpCode(201)
  async generatePredefinedPlan(@Req() req: any, @Body() dto: PlanDto) {
    const userId = req.user.sub;
    return this.plansService.generateAndPersistPredefinedPlan(userId, new Date(dto.weekStart));
  }

  @Get('current')
  async getCurrentPlan(@Req() req: any, @Query('weekStart') weekStart: string) {
    const userId = req.user.sub;
    return this.plansService.getPlanByWeek(userId, new Date(weekStart));
  }

  @Put()
  async updatePlan(@Req() req: any, @Body() dto: PlanDto) {
    const userId = req.user.sub;
    return this.plansService.updatePlan(userId, new Date(dto.weekStart));
  }

  @Delete()
  async deletePlan(@Req() req: any, @Query('weekStart') weekStart: string){
    const userId = req.user.sub;
    return this.plansService.deletePlan(userId, new Date(weekStart));
  }
}
