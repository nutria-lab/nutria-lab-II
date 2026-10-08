import { Controller, Post, Get, Put, Delete, Body, Query, Req, UseGuards, HttpCode, HttpStatus, Param, ParseUUIDPipe, Headers, BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PlansService } from './plans.service';
import { GenerateMealPlanDto, CreateMealPlanDto, MealPlanQueryDto, ReplaceMealDto, RegenerateMealPlanDto } from './dto';
import { MealReplacementService } from './meal-replacement.service';
import { MealPlanRegenerationService } from './meal-plan-regeneration.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// Un id que no es UUID no puede existir: 404, como en el resto de los endpoints del proyecto.
export const uuidOr404 = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

@UseGuards(JwtAuthGuard)
@Controller('meal-plans')
export class PlansController {
  constructor(
    private readonly plansService: PlansService,
    private readonly mealReplacementService: MealReplacementService,
    private readonly mealPlanRegenerationService: MealPlanRegenerationService,
  ) {}

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

  // NUT-77: reemplaza una sola comida del plan actual. El body es opcional.
  @Post(':planId/meals/:plannedMealId/replace')
  @HttpCode(200)
  async replaceMeal(
    @Req() req: any,
    @Param('planId', uuidOr404) planId: string,
    @Param('plannedMealId', uuidOr404) plannedMealId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ReplaceMealDto,
  ) {
    assertIdempotencyKey(idempotencyKey);
    return this.mealReplacementService.replaceMeal(req.user.sub, planId, plannedMealId, idempotencyKey, dto ?? {});
  }

  // NUT-78: regenera la semana como una versión nueva del plan (la anterior se conserva).
  @Post(':planId/regenerate')
  @HttpCode(201)
  async regeneratePlan(
    @Req() req: any,
    @Param('planId', uuidOr404) planId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: RegenerateMealPlanDto,
  ) {
    assertIdempotencyKey(idempotencyKey);
    return this.mealPlanRegenerationService.regenerate(req.user.sub, planId, idempotencyKey, dto);
  }
}

function assertIdempotencyKey(idempotencyKey: string | undefined): asserts idempotencyKey is string {
  if (!idempotencyKey || !isUUID(idempotencyKey)) {
    throw new BadRequestException('Idempotency-Key header must be a UUID');
  }
}
