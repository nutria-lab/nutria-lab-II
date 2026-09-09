import { UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common/enums/request-method.enum';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { AuthenticatedRequest, JwtAuthGuard } from '../guards/jwt-auth.guard';
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

  describe('me', () => {
    const safeUser = {
      id: '1',
      email: 'test@example.com',
      name: 'Test User',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const protectedController = AuthController.prototype as unknown as {
      me: (request: AuthenticatedRequest) => Promise<typeof safeUser>;
    };

    it('expone GET /auth/me protegido por JwtAuthGuard', () => {
      expect(Reflect.getMetadata(PATH_METADATA, protectedController.me)).toBe('me');
      expect(Reflect.getMetadata(METHOD_METADATA, protectedController.me)).toBe(RequestMethod.GET);
      expect(Reflect.getMetadata(GUARDS_METADATA, protectedController.me)).toContain(JwtAuthGuard);
    });

    it('devuelve el usuario seguro asociado al sub autenticado', async () => {
      authService.findById.mockResolvedValue(safeUser);
      const request = { user: { sub: safeUser.id, email: safeUser.email } } as AuthenticatedRequest;

      const result = await protectedController.me.call(controller, request);

      expect(authService.findById).toHaveBeenCalledWith(safeUser.id);
      expect(result).toEqual(safeUser);
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('token');
    });

    it('rechaza con 401 cuando el sujeto del JWT ya no existe', async () => {
      authService.findById.mockResolvedValue(null);
      const request = { user: { sub: 'deleted-user', email: 'deleted@example.com' } } as AuthenticatedRequest;

      await expect(protectedController.me.call(controller, request)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await expect(protectedController.me.call(controller, request)).rejects.toMatchObject({
        status: 401,
      });
    });
  });
});
