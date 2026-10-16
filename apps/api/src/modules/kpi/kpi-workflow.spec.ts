import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function workflow(name: 'kpi-publish.yml' | 'kpi-retry.yml'): string {
  return readFileSync(resolve(__dirname, '../../../../../.github/workflows', name), 'utf8');
}

function apiPackage(): { scripts?: Record<string, string> } {
  return JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8')) as { scripts?: Record<string, string> };
}

function expectCommonSafetyGuards(content: string, timeoutMinutes: number): void {
  expect(content).toMatch(/permissions:\s*[\s\S]*contents:\s*read[\s\S]*actions:\s*write/);
  expect(content).toMatch(/node-version:\s*['"]?24['"]?/);
  expect(content).toContain('pnpm install --frozen-lockfile');
  expect(content).toMatch(/prisma:generate|prisma generate/);
  expect(content).toMatch(/concurrency:\s*[\s\S]*group:\s*kpi-publication-/);
  expect(content).toMatch(/cancel-in-progress:\s*false/);
  expect(content).toMatch(new RegExp(`timeout-minutes:\\s*${timeoutMinutes}`));
  expect(content).toMatch(/if:\s*always\(\)/);
  expect(content).toMatch(/retention-days:\s*90/);
  expect(content.toLowerCase()).not.toMatch(/prisma\s+(migrate|seed)|pnpm\s+[^\n]*(migrate|seed)/);
}

describe('KPI publication workflows', () => {
  it('makes the daily publish workflow deterministic, serialized, and artifact-backed', () => {
    const content = workflow('kpi-publish.yml');

    expect(content).toMatch(/schedule:\s*[\s\S]*cron:\s*['"]0 0 \* \* \*['"]/);
    expect(content).toMatch(/workflow_dispatch:/);
    expect(content).toMatch(/date:\s*[\s\S]*environment:/);
    expect(content).toMatch(/date:\s*[\s\S]*?required:\s*true\s*[\s\S]*?type:\s*string/);
    expect(content).toMatch(/github\.event\.repository\.default_branch/);
    expect(content).toContain('git rev-parse HEAD');
    expect(content).toMatch(/LOCAL_HOUR[\s\S]*10#\$LOCAL_HOUR\s*<\s*21[\s\S]*date\s+-d\s+'yesterday'/);
    expect(content).toContain('Prepare diagnostic artifact directory');
    expectCommonSafetyGuards(content, 10);
  });

  it('executes the real publish CLI and dispatches retry one only for a pre-acceptance retryable result', () => {
    const content = workflow('kpi-publish.yml');

    expect(content).toMatch(/pnpm\s+--filter\s+api\s+kpi:publish\s+--date\s+["']?\$REPORT_DATE["']?\s+--environment\s+["']?\$TARGET_ENV["']?/);
    expect(content).toContain('kpi-retry.yml');
    expect(content).toContain('ref: process.env.SOURCE_COMMIT');
    expect(content).toContain("attempt: '1'");
    expect(content).toMatch(/outcome\.post_accepted\s*\|\|\s*!outcome\.retryable/);
    expect(content).toMatch(/Fail the initial publication[\s\S]*exit\s+["']?\$CLI_EXIT["']?/);
    expect(content).toMatch(/KPI_ARTIFACT_DIR/);
    expect(content).not.toMatch(/remains gated|pending approved adapters/i);
  });

  it('allows only explicit retry input and carries the exact retry identity', () => {
    const content = workflow('kpi-retry.yml');

    expect(content).toMatch(/workflow_dispatch:/);
    expect(content).toMatch(/date:\s*[\s\S]*environment:\s*[\s\S]*retry_chain_id:\s*[\s\S]*attempt:\s*[\s\S]*source_commit:/);
    expect(content).toMatch(/run_id:/);
    expect(content).toMatch(/Validate retry identity/);
    expect(content).toMatch(/SOURCE_COMMIT/);
    expect(content).toMatch(/git cat-file -e/);
    expect(content).toMatch(/git merge-base --is-ancestor/);
    expect(content).toMatch(/git checkout --detach/);
    expect(content).toMatch(/manual_recovery:/);
    expect(content).toMatch(/MANUAL_RECOVERY/);
    expect(content).toMatch(/\[\[\s*["']?\$ATTEMPT["']?\s*==\s*["']1["']\s*\|\|\s*["']?\$ATTEMPT["']?\s*==\s*["']2["']/);
    expect(content).toMatch(/base\s*=\s*300/);
    expect(content).toMatch(/base\s*=\s*600/);
    expect(content).toMatch(/pnpm\s+--filter\s+api\s+kpi:retry\s+["']?\$\{args\[@\]\}["']?/);
    expect(content).toMatch(/Respect backoff and Retry-After[\s\S]*hint\s*>\s*base/);
    expect(content).toMatch(/Dispatch retry two only for an eligible retry one failure[\s\S]*inputs\.attempt\s*==\s*['"]1['"]/);
    expect(content).toContain("attempt: '2'");
    expect(content).toMatch(/outcome\.post_accepted\s*\|\|\s*!outcome\.retryable/);
    expect(content).not.toMatch(/remains gated|pending approved adapters/i);
    expectCommonSafetyGuards(content, 40);
  });

  it('exposes real, executable publish and retry entrypoints instead of a workflow-only gate', () => {
    const scripts = apiPackage().scripts ?? {};

    expect(scripts['kpi:publish']).toBe('tsx scripts/kpi/publish.ts');
    expect(scripts['kpi:retry']).toBe('tsx scripts/kpi/retry.ts');
    expect(scripts['kpi:catalog']).toBe('tsx scripts/kpi/catalog.ts');
    expect(existsSync(resolve(__dirname, '../../../scripts/kpi/publish.ts'))).toBe(true);
    expect(existsSync(resolve(__dirname, '../../../scripts/kpi/retry.ts'))).toBe(true);
    expect(existsSync(resolve(__dirname, '../../../scripts/kpi/catalog.ts'))).toBe(true);
  });
});
