import { Test, TestingModule } from '@nestjs/testing';
import { NutritionProfileController } from '../nutrition-profile.controller';
import { NutritionProfileService } from '../nutrition-profile.service';
import { NotFoundException } from '@nestjs/common';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { NutritionGoal, Diet, CookTimePreference, DietaryRestriction } from '../../../generated/prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';


describe('NutritionProfileController', () => {
    let controller: NutritionProfileController;
    let service: jest.Mocked<NutritionProfileService>;

    beforeEach(async () => {
        const mockService = {
            getProfile: jest.fn(),
            upsertProfile: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [NutritionProfileController],
            providers: [
                {
                    provide: NutritionProfileService,
                    useValue: mockService,
                }
            ],
        })
        .overrideGuard(JwtAuthGuard)
        .useValue({ canActivate: jest.fn(() => true) })
        .compile();

        controller = module.get<NutritionProfileController>(NutritionProfileController);
        service = module.get(NutritionProfileService);
    });

    // GET sin perfil existente
    it('Tira excepcion si no existe', async () => {
        service.getProfile.mockRejectedValue(new NotFoundException('Nutrition profile not found'));

        const req = { user: { sub: 'user-1' } };
        
        await expect(controller.getProfile(req)).rejects.toThrow(NotFoundException);
        expect(service.getProfile).toHaveBeenCalledWith('user-1');
    });

    // GET con perfil existente
    it('Un usuario autenticado obtiene únicamente su propio perfil', async () => {
        const mockProfile = {
            goal: NutritionGoal.LOSE_WEIGHT,
            diet: Diet.VEGAN,
            excludedIngredients: [DietaryRestriction.NUTS],
            cookTimePreference: CookTimePreference.STANDARD,
        };
        service.getProfile.mockResolvedValue(mockProfile);

        const req = { user: { sub: 'user-2' } };
        const result = await controller.getProfile(req);

        expect(result).toEqual(mockProfile);
        expect(service.getProfile).toHaveBeenCalledWith('user-2');
    });

    // Creacion o actualizacion
    it('Un PUT válido crea o actualiza el perfil aislando por usuario', async () => {
        const dto: UpdateProfileDto = {
            goal: NutritionGoal.GAIN_MUSCLE,
            diet: Diet.ALL,
            excludedIngredients: [],
            cookTimePreference: CookTimePreference.QUICK,
        };

        service.upsertProfile.mockResolvedValue(dto);

        const req = { user: { sub: 'user-3' } };
        const result = await controller.updateProfile(req, dto);

        expect(result).toEqual(dto);
        expect(service.upsertProfile).toHaveBeenCalledWith('user-3', dto);
    });
});

describe('UpdateProfileDto Validation', () => {
    it('Rechaza enums inválidos', async () => {
        const badPayload = {
            goal: 'MAGIC_WEIGHT_LOSS', // Inválido
            diet: Diet.VEGAN,
            excludedIngredients: [],
            cookTimePreference: CookTimePreference.STANDARD,
        };
        const dto = plainToInstance(UpdateProfileDto, badPayload);
        const errors = await validate(dto);
        
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].property).toBe('goal');
    });

    it('Rechaza restricciones duplicadas (ArrayUnique)', async () => {
        const badPayload = {
            goal: NutritionGoal.LOSE_WEIGHT,
            diet: Diet.VEGAN,
            excludedIngredients: [DietaryRestriction.NUTS, DietaryRestriction.NUTS], // Duplicado
            cookTimePreference: CookTimePreference.STANDARD,
        };
        const dto = plainToInstance(UpdateProfileDto, badPayload);
        const errors = await validate(dto);
        
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].property).toBe('excludedIngredients');
    });

    it('Valida correctamente el shape completo (Happy path)', async () => {
        const goodPayload = {
            goal: NutritionGoal.MAINTAIN,
            diet: Diet.PALEO,
            excludedIngredients: [DietaryRestriction.DAIRY],
            cookTimePreference: CookTimePreference.GOURMET,
        };
        const dto = plainToInstance(UpdateProfileDto, goodPayload);
        const errors = await validate(dto);
        
        expect(errors.length).toBe(0); // El shape es correcto y sin errores
    });
});