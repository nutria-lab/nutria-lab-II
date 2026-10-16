import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { KpiInternalAuthGuard } from './kpi-internal-auth.guard';

function context(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: authorization ? { authorization } : {} }) }),
  } as unknown as ExecutionContext;
}

describe('KpiInternalAuthGuard', () => {
  const savedToken = process.env.KPI_INTERNAL_TOKEN;
  const guard = new KpiInternalAuthGuard();

  afterAll(() => {
    if (savedToken === undefined) delete process.env.KPI_INTERNAL_TOKEN;
    else process.env.KPI_INTERNAL_TOKEN = savedToken;
  });

  it('allows a matching bearer token', () => {
    process.env.KPI_INTERNAL_TOKEN = 'internal-secret';
    expect(guard.canActivate(context('Bearer internal-secret'))).toBe(true);
  });

  it.each([undefined, 'internal-secret', 'Bearer wrong', 'Bearer internal-secret-extra'])(
    'rejects missing or mismatched credentials', authorization => {
      process.env.KPI_INTERNAL_TOKEN = 'internal-secret';
      expect(() => guard.canActivate(context(authorization))).toThrow(UnauthorizedException);
    },
  );

  it('fails closed when the backend token is not configured', () => {
    delete process.env.KPI_INTERNAL_TOKEN;
    expect(() => guard.canActivate(context('Bearer internal-secret'))).toThrow(UnauthorizedException);
  });
});
