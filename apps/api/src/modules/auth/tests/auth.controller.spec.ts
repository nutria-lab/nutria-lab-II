import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { JwtAuthGuard, AuthenticatedRequest } from '../guards/jwt-auth.guard';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;

  beforeEach(async () => {
    authService = {
      register: jest.fn(),
      login: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('debería estar definido', () => {
    expect(controller).toBeDefined();
  });

  describe('getProfile (Endpoint Protegido)', () => {
    it('debería devolver el mensaje de éxito y el usuario decodificado', () => {
      const mockUser = { sub: '123', email: 'test@example.com' };
      const req = { user: mockUser } as AuthenticatedRequest;

      const result = controller.getProfile(req);

      expect(result).toEqual({
        message: 'Token válido',
        user: mockUser,
      });
    });
  });
});
