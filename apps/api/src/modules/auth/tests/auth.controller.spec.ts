import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { Response } from 'express';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;

  beforeEach(async () => {
    authService = {
      register: jest.fn(),
      login: jest.fn(),
      findById: jest.fn(),
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

  describe('register', () => {
    it('debería registrar un usuario y devolver los datos del usuario', async () => {
      const registerDto = { email: 'test@example.com', password: 'Password123!', name: 'Test User' };
      const expectedUser = {
        id: '1',
        email: 'test@example.com',
        name: 'Test User',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      authService.register.mockResolvedValue(expectedUser);

      const result = await controller.register(registerDto);

      expect(authService.register).toHaveBeenCalledWith(registerDto);
      expect(result).toEqual(expectedUser);
    });
  });

  describe('login', () => {
    it('debería configurar la cookie HttpOnly y devolver los datos del usuario', async () => {
      const loginDto = { email: 'test@example.com', password: 'Password123!' };
      const mockUser = {
        id: '1',
        email: 'test@example.com',
        name: 'Test User',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const mockToken = 'mock-jwt-token';

      authService.login.mockResolvedValue({
        user: mockUser,
        token: mockToken,
      });

      const mockRes = {
        cookie: jest.fn(),
      } as unknown as Response;

      const result = await controller.login(loginDto, mockRes);

      expect(authService.login).toHaveBeenCalledWith(loginDto);
      expect(mockRes.cookie).toHaveBeenCalledWith(
        'token',
        mockToken,
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          maxAge: 24 * 60 * 60 * 1000,
        }),
      );
      expect(result).toEqual(mockUser);
    });
  });

  describe('logout', () => {
    it('debería limpiar la cookie de sesión con las mismas opciones de seguridad', async () => {
      const mockRes = {
        clearCookie: jest.fn(),
      } as unknown as Response;

      await controller.logout(mockRes);

      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'token',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          path: '/',
        }),
      );
    });

    it('es idempotente: puede ejecutarse múltiples veces sin lanzar errores', async () => {
      const mockRes = {
        clearCookie: jest.fn(),
      } as unknown as Response;

      await expect(controller.logout(mockRes)).resolves.not.toThrow();
      await expect(controller.logout(mockRes)).resolves.not.toThrow();
      expect(mockRes.clearCookie).toHaveBeenCalledTimes(2);
    });
  });
});
