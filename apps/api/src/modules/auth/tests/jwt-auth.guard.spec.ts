import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard, AuthenticatedRequest } from '../guards/jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(() => {
    jwtService = {
      verifyAsync: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;

    guard = new JwtAuthGuard(jwtService);
  });

  const createMockContext = (cookies: any = {}, headers: any = {}): ExecutionContext => {
    const request = {
      cookies,
      headers,
    } as unknown as AuthenticatedRequest;

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  };

  it('debería lanzar UnauthorizedException si la cookie token no está presente (ej. tras logout)', async () => {
    const context = createMockContext({}); // Sin cookie token

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Token de autorización no provisto'),
    );
  });

  it('debería lanzar UnauthorizedException si la cookie token es inválida o expiró', async () => {
    const context = createMockContext({ token: 'token-invalido' });

    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Token inválido o expirado'),
    );
  });

  it('debería devolver true y popular request.user si la cookie token es válida', async () => {
    const context = createMockContext({ token: 'token-valido' });
    const payload = { sub: '123', email: 'test@test.com' };

    jwtService.verifyAsync.mockResolvedValue(payload);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    expect(req.user).toEqual(payload);
  });

  it('debería rechazar peticiones que solo envían header Authorization sin cookie (consistencia estricta de cookie)', async () => {
    const context = createMockContext({}, { authorization: 'Bearer token-valido' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Token de autorización no provisto'),
    );
  });
});
