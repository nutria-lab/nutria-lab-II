import { KPI_CATALOG_DEFINITIONS } from '../kpi-catalog-definitions';
import { runKpiCatalogCli } from './kpi-catalog-cli';

describe('kpi:catalog CLI', () => {
  it('validates project identity, registers missing definitions once, and reports only safe metadata', async () => {
    const fetch = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('[]', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(KPI_CATALOG_DEFINITIONS.map(row => ({ ...row, active: true }))), { status: 200 }));
    const log = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(runKpiCatalogCli(['--environment', 'dev'], {
        KPI_ENV: 'dev',
        SUPABASE_URL: 'https://project.example',
        SUPABASE_PUBLISHABLE_KEY: 'publishable-secret-fixture',
        PROJECT_KEY: 'project-secret-fixture',
      })).resolves.toBe(0);

      expect(fetch).toHaveBeenCalledTimes(4);
      expect(fetch.mock.calls[0][0]).toBe('https://project.example/rest/v1/rpc/current_project');
      expect(fetch.mock.calls[1][0]).toBe('https://project.example/rest/v1/kpi_catalog?select=*');
      expect(fetch.mock.calls[2][1]).toMatchObject({ method: 'POST' });
      expect(JSON.parse(String(fetch.mock.calls[2][1]?.body))).toEqual(KPI_CATALOG_DEFINITIONS);
      expect(log).toHaveBeenCalledWith('KPI_CATALOG_RESULT {"environment":"dev","added_count":10,"active_count":10}');
      expect(error).not.toHaveBeenCalled();
      expect(log.mock.calls.flat().join(' ')).not.toMatch(/publishable-secret|project-secret|project\.example/);
    } finally {
      fetch.mockRestore();
      log.mockRestore();
      error.mockRestore();
    }
  });

  it('fails without exposing HTTP response bodies or secrets when the target project is wrong', async () => {
    const fetch = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('sensitive remote body', { status: 401 }));
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(runKpiCatalogCli(['--environment', 'prod'], {
        KPI_ENV: 'prod',
        SUPABASE_URL: 'https://project.example',
        SUPABASE_PUBLISHABLE_KEY: 'publishable-secret-fixture',
        PROJECT_KEY: 'project-secret-fixture',
      })).resolves.toBe(1);

      expect(log).toHaveBeenCalledWith(expect.stringContaining('KPI_REMOTE_IDENTITY_INVALID'));
      expect(log.mock.calls.flat().join(' ')).not.toMatch(/sensitive remote body|publishable-secret|project-secret|project\.example/);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      fetch.mockRestore();
      log.mockRestore();
    }
  });
});
