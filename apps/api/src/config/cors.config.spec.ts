import { Controller, Post } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { request } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createCorsOptions } from './cors.config';

type CorsOptions = {
  credentials?: boolean;
  origin?: unknown;
};

type OriginCallback = (error: Error | null, allowed?: boolean) => void;
type OriginResolver = (origin: string | undefined, callback: OriginCallback) => void;

@Controller('auth')
class CorsTestController {
  @Post('login')
  login() {
    return { ok: true };
  }
}

function resolveOrigin(options: CorsOptions, origin: string): Promise<boolean> {
  if (typeof options.origin !== 'function') {
    throw new Error('La política CORS debe usar un resolutor de orígenes exactos.');
  }

  return new Promise((resolve, reject) => {
    (options.origin as OriginResolver)(origin, (error, allowed) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(allowed === true);
    });
  });
}

function sendLoginPreflight(
  application: INestApplication,
  origin: string,
): Promise<{ statusCode?: number; headers: IncomingHttpHeaders }> {
  const address = application.getHttpServer().address() as AddressInfo;

  return new Promise((resolve, reject) => {
    const requestToApi = request(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path: '/auth/login',
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      },
      (response) => {
        response.resume();
        response.on('end', () => {
          resolve({ statusCode: response.statusCode, headers: response.headers });
        });
      },
    );

    requestToApi.on('error', reject);
    requestToApi.end();
  });
}

describe('createCorsOptions', () => {
  it('permite localhost como fallback de desarrollo con credenciales y sin wildcard', async () => {
    const options = createCorsOptions({ NODE_ENV: 'development' });

    expect(options.credentials).toBe(true);
    expect(options.origin).not.toBe('*');
    await expect(resolveOrigin(options, 'http://localhost:5173')).resolves.toBe(true);
  });

  it('permite un origen HTTPS exacto configurado y rechaza uno que no está incluido', async () => {
    const options = createCorsOptions({
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://web.nutria.test/',
    });

    expect(options.credentials).toBe(true);
    expect(options.origin).not.toBe('*');
    await expect(resolveOrigin(options, 'https://web.nutria.test')).resolves.toBe(true);
    await expect(resolveOrigin(options, 'https://unlisted.nutria.test')).resolves.toBe(false);
  });

  it.each(['http://localhost:5173', 'http://web.nutria.test'])(
    'rechaza el origen HTTP %s en producción',
    (origin) => {
      expect(() =>
        createCorsOptions({
          NODE_ENV: 'production',
          CORS_ORIGINS: origin,
        }),
      ).toThrow(/HTTPS/i);
    },
  );

  it.each([undefined, '', ' , '])(
    'falla de forma segura en producción sin CORS_ORIGINS válido (%p)',
    (corsOrigins) => {
      expect(() =>
        createCorsOptions({
          NODE_ENV: 'production',
          CORS_ORIGINS: corsOrigins,
        }),
      ).toThrow(/CORS_ORIGINS/i);
    },
  );

  describe('preflight HTTP de login', () => {
    let application: INestApplication;

    beforeAll(async () => {
      const module = await Test.createTestingModule({
        controllers: [CorsTestController],
      }).compile();

      application = module.createNestApplication();
      application.enableCors(
        createCorsOptions({
          NODE_ENV: 'production',
          CORS_ORIGINS: 'https://web.nutria.test',
        }),
      );
      await application.init();
      await application.listen(0, '127.0.0.1');
    });

    afterAll(async () => {
      await application.close();
    });

    it('autoriza el OPTIONS de un origen exacto con credenciales', async () => {
      const response = await sendLoginPreflight(application, 'https://web.nutria.test');

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe('https://web.nutria.test');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('no entrega autorización CORS a un OPTIONS de origen no incluido', async () => {
      const response = await sendLoginPreflight(application, 'https://unlisted.nutria.test');

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });
});
