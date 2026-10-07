import { Test, TestingModule } from '@nestjs/testing';
import { PlansController, uuidOr404 } from '../plans.controller';
import { PlansService } from '../plans.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GenerateMealPlanDto, CreateMealPlanDto, MealPlanQueryDto } from '../dto';
import { MealReplacementService } from '../meal-replacement.service';
import { MealPlanRegenerationService } from '../meal-plan-regeneration.service';

describe('PlansController', () => {
  let controller: PlansController;
  let service: jest.Mocked<PlansService>;
  let replacementService: { replaceMeal: jest.Mock };
  let regenerationService: { regenerate: jest.Mock };

  beforeEach(async () => {
    const mockService = {
      generateAndPersistPlan: jest.fn(),
      validateAndPersistPlan: jest.fn(),
      getPlanByWeek: jest.fn(),
      updatePlan: jest.fn(),
      deletePlan: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlansController],
      providers: [
        {
          provide: PlansService,
          useValue: mockService,
        },
        {
          provide: MealReplacementService,
          useValue: { replaceMeal: jest.fn() },
        },
        {
          provide: MealPlanRegenerationService,
          useValue: { regenerate: jest.fn() },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<PlansController>(PlansController);
    service = module.get(PlansService);
    replacementService = module.get(MealReplacementService);
    regenerationService = module.get(MealPlanRegenerationService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('generatePlan', () => {
    it('should call generateAndPersistPlan with userId and weekStart', async () => {
      const req = { user: { sub: 'user-123' } };
      const dto: GenerateMealPlanDto = { weekStart: '2026-09-07' };
      const expectedPlan = { id: 'plan-1' };
      
      service.generateAndPersistPlan.mockResolvedValue(expectedPlan as any);

      const result = await controller.generatePlan(req, dto);

      expect(result).toEqual(expectedPlan);
      expect(service.generateAndPersistPlan).toHaveBeenCalledWith('user-123', '2026-09-07');
    });
  });

  describe('createPlan', () => {
    it('should call validateAndPersistPlan with userId and full DTO', async () => {
      const req = { user: { sub: 'user-123' } };
      const dto: CreateMealPlanDto = { weekStart: '2026-09-07', days: [] };
      const expectedPlan = { id: 'plan-new' };
      
      service.validateAndPersistPlan.mockResolvedValue(expectedPlan as any);

      const result = await controller.createPlan(req, dto);

      expect(result).toEqual(expectedPlan);
      expect(service.validateAndPersistPlan).toHaveBeenCalledWith('user-123', dto);
    });
  });

  describe('getCurrentPlan', () => {
    it('should call getPlanByWeek with userId and weekStart', async () => {
      const req = { user: { sub: 'user-123' } };
      const query: MealPlanQueryDto = { weekStart: '2026-09-07' };
      const expectedPlan = { id: 'plan-3' };
      
      service.getPlanByWeek.mockResolvedValue(expectedPlan as any);

      const result = await controller.getCurrentPlan(req, query);

      expect(result).toEqual(expectedPlan);
      expect(service.getPlanByWeek).toHaveBeenCalledWith('user-123', '2026-09-07');
    });
  });

  describe('updatePlan', () => {
    it('should call updatePlan with userId and full DTO', async () => {
      const req = { user: { sub: 'user-123' } };
      const dto: CreateMealPlanDto = { weekStart: '2026-09-07', days: [] };
      const expectedPlan = { id: 'plan-4' };
      
      service.updatePlan.mockResolvedValue(expectedPlan as any);

      const result = await controller.updatePlan(req, dto);

      expect(result).toEqual(expectedPlan);
      expect(service.updatePlan).toHaveBeenCalledWith('user-123', dto);
    });
  });

  describe('deletePlan', () => {
    it('should call deletePlan with userId and weekStart', async () => {
      const req = { user: { sub: 'user-123' } };
      const query: MealPlanQueryDto = { weekStart: '2026-09-07' };
      const expectedPlan = { id: 'plan-5' };
      
      service.deletePlan.mockResolvedValue(expectedPlan as any);

      const result = await controller.deletePlan(req, query);

      expect(result).toEqual(expectedPlan);
      expect(service.deletePlan).toHaveBeenCalledWith('user-123', '2026-09-07');
    });
  });

  describe('replaceMeal (NUT-77)', () => {
    const req = { user: { sub: 'user-123' } };
    const planId = '11111111-1111-4111-8111-111111111111';
    const mealId = '22222222-2222-4222-8222-222222222222';
    const key = '33333333-3333-4333-8333-333333333333';

    it('delega en MealReplacementService con el usuario, los ids, la clave y el body', async () => {
      replacementService.replaceMeal.mockResolvedValue({ planId });
      const dto = { topic: 'cena liviana', maxPrepMinutes: 30 };

      const result = await controller.replaceMeal(req, planId, mealId, key, dto);

      expect(replacementService.replaceMeal).toHaveBeenCalledWith('user-123', planId, mealId, key, dto);
      expect(result).toEqual({ planId });
    });

    it('sin body usa criterios vacíos', async () => {
      await controller.replaceMeal(req, planId, mealId, key, undefined as any);

      expect(replacementService.replaceMeal).toHaveBeenCalledWith('user-123', planId, mealId, key, {});
    });

    it('un planId o plannedMealId que no es UUID da 404 (convención del proyecto)', async () => {
      await expect(uuidOr404.transform('no-es-un-uuid', { type: 'param' } as any)).rejects.toBeInstanceOf(NotFoundException);
      await expect(uuidOr404.transform(planId, { type: 'param' } as any)).resolves.toBe(planId);
    });

    it.each([undefined, '', 'no-es-un-uuid'])('responde 400 si Idempotency-Key es %p', async (badKey) => {
      await expect(controller.replaceMeal(req, planId, mealId, badKey as any, {})).rejects.toBeInstanceOf(BadRequestException);
      expect(replacementService.replaceMeal).not.toHaveBeenCalled();
    });
  });

  describe('regeneratePlan (NUT-78)', () => {
    const req = { user: { sub: 'user-123' } };
    const planId = '11111111-1111-4111-8111-111111111111';
    const key = '33333333-3333-4333-8333-333333333333';
    const dto = { reason: 'USER_REQUESTED' } as any;

    it('delega en MealPlanRegenerationService con el usuario, el plan, la clave y el body', async () => {
      regenerationService.regenerate.mockResolvedValue({ id: 'plan-2' });

      const result = await controller.regeneratePlan(req, planId, key, dto);

      expect(regenerationService.regenerate).toHaveBeenCalledWith('user-123', planId, key, dto);
      expect(result).toEqual({ id: 'plan-2' });
    });

    it('responde 201', () => {
      expect(Reflect.getMetadata('__httpCode__', PlansController.prototype.regeneratePlan)).toBe(201);
    });

    it('un planId que no es UUID da 404 (usa uuidOr404, convención del proyecto)', () => {
      const args = Reflect.getMetadata('__routeArguments__', PlansController, 'regeneratePlan') as Record<string, { data?: string; pipes?: unknown[] }>;
      const planIdArg = Object.values(args).find(arg => arg.data === 'planId');
      expect(planIdArg?.pipes).toContain(uuidOr404);
    });

    it.each([undefined, '', 'no-es-un-uuid'])('responde 400 si Idempotency-Key es %p', async (badKey) => {
      await expect(controller.regeneratePlan(req, planId, badKey as any, dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(regenerationService.regenerate).not.toHaveBeenCalled();
    });
  });
});
