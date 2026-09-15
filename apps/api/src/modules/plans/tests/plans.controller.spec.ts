import { Test, TestingModule } from '@nestjs/testing';
import { PlansController } from '../plans.controller';
import { PlansService } from '../plans.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { GenerateMealPlanDto, CreateMealPlanDto, MealPlanQueryDto } from '../dto';

describe('PlansController', () => {
  let controller: PlansController;
  let service: jest.Mocked<PlansService>;

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
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<PlansController>(PlansController);
    service = module.get(PlansService);
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
});
