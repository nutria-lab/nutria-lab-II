import type { NextFunction, Request, Response } from 'express';
import { AccessGateMiddleware } from './access-gate.middleware';
import { AccessGateService } from './access-gate.service';

describe('AccessGateMiddleware', () => {
  const next = jest.fn() as unknown as NextFunction;
  const nextMock = next as jest.Mock;
  const status = jest.fn();
  const json = jest.fn();
  const response = { status: (code: number) => { status(code); return response; }, json } as unknown as Response;
  const accessGate = { isRequired: () => true, isValidToken: () => false } as unknown as AccessGateService;
  const middleware = new AccessGateMiddleware(accessGate);

  beforeEach(() => {
    nextMock.mockClear();
    status.mockClear();
    json.mockClear();
  });

  it.each([
    '/kpi/telemetry/sample',
    '/kpi/telemetry/finalize',
  ])('permits the internal telemetry route %s through to its token guard', path => {
    middleware.use({ method: 'POST', path, cookies: {} } as Request, response, next);

    expect(nextMock).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it('continues to require the access cookie for unrelated routes', () => {
    middleware.use({ method: 'GET', path: '/recipes', cookies: {} } as Request, response, next);

    expect(nextMock).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ACCESS_GATE_REQUIRED' }));
  });

  it('does not bypass the access gate for another method on an internal path', () => {
    middleware.use({ method: 'GET', path: '/kpi/telemetry/sample', cookies: {} } as Request, response, next);

    expect(nextMock).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });
});
