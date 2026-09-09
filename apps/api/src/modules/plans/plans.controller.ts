import { Controller, Post, Get, Put, Delete, Body, Query, Req, UseGuards, HttpCode } from '@nestjs/common';
import { PlansService } from './plans.service';
import { GenerateMealPlanDto, CreateMealPlanDto, MealPlanQueryDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('meal-plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Post('generate')
  @HttpCode(201)
  async generatePlan(@Req() req: any, @Body() dto: GenerateMealPlanDto) {
    const userId = req.user.sub;
    return this.plansService.generateAndPersistPlan(userId, dto.weekStart);
  }

  @Post()
  @HttpCode(201)
  async createPlan(@Req() req: any, @Body() dto: CreateMealPlanDto) {
    const userId = req.user.sub;
    return this.plansService.validateAndPersistPlan(userId, dto);
  }

  @Get('current')
  async getCurrentPlan(@Req() req: any, @Query() query: MealPlanQueryDto) {
    const userId = req.user.sub;
    return this.plansService.getPlanByWeek(userId, query.weekStart);
  }

  @Put()
  async updatePlan(@Req() req: any, @Body() dto: CreateMealPlanDto) {
    const userId = req.user.sub;
    return this.plansService.updatePlan(userId, dto);
  }

  @Delete()
  async deletePlan(@Req() req: any, @Query() query: MealPlanQueryDto){
    const userId = req.user.sub;
    return this.plansService.deletePlan(userId, query.weekStart);
  }
}
