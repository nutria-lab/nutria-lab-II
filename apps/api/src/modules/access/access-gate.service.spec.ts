import {
  ACCESS_GATE_TTL_MS,
  AccessGateService,
} from './access-gate.service';

describe('AccessGateService', () => {
  const originalPassword = process.env.APP_ACCESS_PASSWORD;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalPassword === undefined) delete process.env.APP_ACCESS_PASSWORD;
    else process.env.APP_ACCESS_PASSWORD = originalPassword;

    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('signs a short-lived token that cannot be reused after expiry or tampering', () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ACCESS_PASSWORD = 'correct horse battery staple';
    const service = new AccessGateService();
    const issuedAt = 1_000_000;
    const token = service.createToken(issuedAt);

    expect(service.isRequired()).toBe(true);
    expect(service.isValidPassword('correct horse battery staple')).toBe(true);
    expect(service.isValidPassword('wrong')).toBe(false);
    expect(service.isValidToken(token, issuedAt + ACCESS_GATE_TTL_MS)).toBe(true);
    expect(service.isValidToken(`${token}x`, issuedAt)).toBe(false);
    expect(service.isValidToken(token, issuedAt + ACCESS_GATE_TTL_MS + 1)).toBe(false);
  });

  it('keeps the gate visible and closed when the password variable is absent', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.APP_ACCESS_PASSWORD;
    const service = new AccessGateService();

    expect(service.isRequired()).toBe(true);
    expect(service.isValidToken(undefined)).toBe(false);
    expect(service.isValidPassword('anything')).toBe(false);
  });
});