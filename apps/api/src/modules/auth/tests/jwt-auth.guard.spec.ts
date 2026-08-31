import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard, AuthenticatedRequest } from '../guards/jwt-auth.guard';
import { Request } from 'express';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(() => {
    // Mock the JwtService
    jwtService = {
      verifyAsync: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;

    guard = new JwtAuthGuard(jwtService);
  });

  const createMockContext = (headers: any): ExecutionContext => {
    const request = {
      headers,
    } as unknown as AuthenticatedRequest;

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  };

  it('debería lanzar UnauthorizedException si no hay token', async () => {
    const context = createMockContext({}); // Sin header de autorización

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Token de autorización no provisto')
    );
  });

  it('debería lanzar UnauthorizedException si el formato del token es inválido', async () => {
    const context = createMockContext({ authorization: 'Basic asdasd' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Token de autorización no provisto')
    );
  });

  it('debería lanzar UnauthorizedException si el token es inválido o expiró', async () => {
    const context = createMockContext({ authorization: 'Bearer token-invalido' });
    
    // Simulamos que el JwtService tira un error
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Token inválido o expirado')
    );
  });

  it('debería devolver true y popular request.user si el token es válido', async () => {
    const context = createMockContext({ authorization: 'Bearer token-valido' });
    const payload = { sub: '123', email: 'test@test.com' };
    
    // Simulamos que el JwtService verifica el token con éxito
    jwtService.verifyAsync.mockResolvedValue(payload);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    // Verificamos que el payload se haya inyectado en la request
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    expect(req.user).toEqual(payload);
  });
});
