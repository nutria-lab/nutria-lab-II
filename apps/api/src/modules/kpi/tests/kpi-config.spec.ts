import { resolveKpiConfig } from '../config/kpi-config';

describe('resolveKpiConfig', () => {
  describe('KPI_ENV (B7, D1)', () => {
    it.each([{}, { KPI_ENV: undefined }, { KPI_ENV: '' }])(
      'KPI_ENV ausente (%p) ⇒ deshabilitado con KPI_ENV_MISSING',
      env => {
        expect(resolveKpiConfig(env)).toEqual({
          enabled: false,
          environment: null,
          disabledReason: 'KPI_ENV_MISSING',
        });
      },
    );

    it.each(['production', 'PROD', ' prod', 'prod ', 'Dev', 'development', 'staging', 'QA'])(
      'KPI_ENV=%p ⇒ deshabilitado con KPI_ENV_INVALID y sin incluir el valor recibido',
      value => {
        const config = resolveKpiConfig({ KPI_ENV: value });

        expect(config).toEqual({ enabled: false, environment: null, disabledReason: 'KPI_ENV_INVALID' });
        expect(JSON.stringify(config)).not.toContain(value);
      },
    );

    it.each([
      { NODE_ENV: 'production' },
      { NODE_ENV: 'development' },
      { NODE_ENV: 'test' },
      { NODE_ENV: 'production', VERCEL_ENV: 'production' },
    ])('NODE_ENV/VERCEL_ENV sin KPI_ENV (%p) no habilita nada', env => {
      expect(resolveKpiConfig(env)).toEqual({
        enabled: false,
        environment: null,
        disabledReason: 'KPI_ENV_MISSING',
      });
    });

    it.each(['dev', 'qa', 'prod'] as const)('KPI_ENV=%p válido ⇒ habilitado con ese ambiente', value => {
      expect(resolveKpiConfig({ KPI_ENV: value })).toEqual({
        enabled: true,
        environment: value,
        disabledReason: null,
      });
    });

    it('el ambiente sale de KPI_ENV aunque NODE_ENV diga otra cosa', () => {
      expect(resolveKpiConfig({ KPI_ENV: 'prod', NODE_ENV: 'development' }).environment).toBe('prod');
      expect(resolveKpiConfig({ KPI_ENV: 'dev', NODE_ENV: 'production' }).environment).toBe('dev');
    });
  });

  describe('KPI_INSTRUMENTATION_ENABLED (B8, D2)', () => {
    it('ausente o "true" ⇒ habilitado', () => {
      expect(resolveKpiConfig({ KPI_ENV: 'qa' }).enabled).toBe(true);
      expect(resolveKpiConfig({ KPI_ENV: 'qa', KPI_INSTRUMENTATION_ENABLED: 'true' })).toEqual({
        enabled: true,
        environment: 'qa',
        disabledReason: null,
      });
    });

    it('"false" ⇒ deshabilitado con KPI_SWITCH_OFF', () => {
      const config = resolveKpiConfig({ KPI_ENV: 'qa', KPI_INSTRUMENTATION_ENABLED: 'false' });

      expect(config.enabled).toBe(false);
      expect(config.disabledReason).toBe('KPI_SWITCH_OFF');
    });

    it.each(['FALSE', 'TRUE', '0', '1', 'no', 'yes', 'off', ' true', 'true '])(
      'valor inválido %p ⇒ deshabilitado con KPI_SWITCH_INVALID (ante duda, apagado)',
      value => {
        const config = resolveKpiConfig({ KPI_ENV: 'dev', KPI_INSTRUMENTATION_ENABLED: value });

        expect(config.enabled).toBe(false);
        expect(config.disabledReason).toBe('KPI_SWITCH_INVALID');
      },
    );

    it('interruptor encendido no compensa un KPI_ENV faltante', () => {
      expect(resolveKpiConfig({ KPI_INSTRUMENTATION_ENABLED: 'true' }).enabled).toBe(false);
    });

    it('no lee process.env: sólo el objeto recibido', () => {
      const previous = process.env.KPI_ENV;
      process.env.KPI_ENV = 'dev';
      try {
        expect(resolveKpiConfig({}).enabled).toBe(false);
      } finally {
        if (previous === undefined) delete process.env.KPI_ENV;
        else process.env.KPI_ENV = previous;
      }
    });
  });
});
