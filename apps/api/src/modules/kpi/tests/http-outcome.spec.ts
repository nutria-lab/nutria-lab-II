import {
  UNMATCHED_OPERATION,
  UNRESOLVED_OPERATION,
  classifyHttpOutcome,
  isExcludedFromTraffic,
  normalizeOperation,
} from '../http/http-outcome';

describe('classifyHttpOutcome (D6)', () => {
  it.each([
    [200, 'success'],
    [201, 'success'],
    [204, 'success'],
    [400, 'client_error'],
    [401, 'client_error'],
    [404, 'client_error'],
    [422, 'client_error'],
    [408, 'client_error'], // 4xx nunca es timeout: sólo 504 o el timeout confirmado del socket del servidor
    [500, 'server_error'],
    [503, 'server_error'],
    [504, 'timeout'],
    [101, 'other'],
    [301, 'other'],
    [302, 'other'],
    [304, 'other'],
  ] as const)('status %p ⇒ %p conservando el status', (statusCode, outcome) => {
    expect(classifyHttpOutcome({ statusCode })).toEqual({ outcome, httpStatus: statusCode });
  });

  it('socket cerrado por el cliente antes de terminar ⇒ network_error con http_status null', () => {
    // res.statusCode vale 200 por defecto aunque no se haya enviado nada.
    expect(classifyHttpOutcome({ statusCode: 200, clientDisconnected: true })).toEqual({
      outcome: 'network_error',
      httpStatus: null,
    });
    expect(classifyHttpOutcome({ statusCode: null, clientDisconnected: true })).toEqual({
      outcome: 'network_error',
      httpStatus: null,
    });
  });

  it('timeout señalado por el propio servidor ⇒ timeout confirmado (con el status si existe)', () => {
    expect(classifyHttpOutcome({ statusCode: null, serverTimedOut: true })).toEqual({
      outcome: 'timeout',
      httpStatus: null,
    });
    expect(classifyHttpOutcome({ statusCode: 504, serverTimedOut: true })).toEqual({
      outcome: 'timeout',
      httpStatus: 504,
    });
  });

  it('nunca devuelve pending: el pending sólo existe como fila sin cierre', () => {
    const outcomes = [100, 200, 302, 404, 500, 599].map(statusCode => classifyHttpOutcome({ statusCode }).outcome);
    expect(outcomes).not.toContain('pending');
  });
});

describe('normalizeOperation (B4, D7)', () => {
  it('método en mayúsculas + plantilla de ruta', () => {
    expect(normalizeOperation('get', '/meal-plans/:planId')).toBe('GET /meal-plans/:planId');
    expect(normalizeOperation('POST', '/meal-plans/:planId/regenerate')).toBe('POST /meal-plans/:planId/regenerate');
  });

  it('sin query ni barra final', () => {
    expect(normalizeOperation('GET', '/recipes?userId=u-1&token=abc')).toBe('GET /recipes');
    expect(normalizeOperation('GET', '/meal-plans/:planId/')).toBe('GET /meal-plans/:planId');
    expect(normalizeOperation('GET', '/')).toBe('GET /');
  });

  it('trunca a 200 caracteres', () => {
    const operation = normalizeOperation('GET', `/${'a'.repeat(400)}`);
    expect(operation).toHaveLength(200);
    expect(operation.startsWith('GET /aaa')).toBe(true);
  });

  it.each([null, undefined, ''])('sin ruta que matchee (%p) ⇒ valor fijo UNMATCHED', template => {
    expect(normalizeOperation('GET', template)).toBe('UNMATCHED');
  });

  it('constantes fijas para pending y sin match', () => {
    expect(UNRESOLVED_OPERATION).toBe('UNRESOLVED');
    expect(UNMATCHED_OPERATION).toBe('UNMATCHED');
  });

  it('una plantilla con query, UUID y token reales nunca los deja pasar', () => {
    const operation = normalizeOperation('GET', '/meal-plans/:planId?token=eyJhbGciOi.secret&userId=8a7b');
    expect(operation).toBe('GET /meal-plans/:planId');
    expect(operation).not.toMatch(/token|userId|eyJ|8a7b|\?/);
  });
});

describe('isExcludedFromTraffic (B5, D8)', () => {
  it.each([
    ['GET', '/health'],
    ['HEAD', '/health'],
    ['POST', '/health'],
    ['GET', '/health/'],
    ['GET', '/health?probe=1'],
    ['GET', '/kpi'],
    ['GET', '/kpi/'],
    ['POST', '/kpi/telemetry'],
    ['GET', '/kpi/reports/2026-10-09?x=1'],
    ['OPTIONS', '/meal-plans'],
    ['options', '/auth/login'],
  ])('%s %s se excluye', (method, url) => {
    expect(isExcludedFromTraffic(method, url)).toBe(true);
  });

  it.each([
    ['GET', '/'],
    ['GET', '/healthz'],
    ['GET', '/kpis'],
    ['GET', '/meal-plans/kpi'],
    ['GET', '/meal-plans/health'],
    ['POST', '/auth/login'],
    ['DELETE', '/recipes/1'],
  ])('%s %s se instrumenta', (method, url) => {
    expect(isExcludedFromTraffic(method, url)).toBe(false);
  });
});
