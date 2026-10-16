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
    expectCommonSafetyGuards(content, 10);
  });

  it('executes the real publish CLI and dispatches retry one only for a pre-acceptance retryable result', () => {
    const content = workflow('kpi-publish.yml');

    expect(content).toMatch(/pnpm\s+--filter\s+api\s+kpi:publish\s+--date\s+["']?\$REPORT_DATE["']?\s+--environment\s+["']?\$TARGET_ENV["']?/);
    expect(content).toContain('kpi-retry.yml');
    expect(content).toContain("attempt: '1'");
    expect(content).toMatch(/outcome\.post_accepted\s*\|\|\s*!outcome\.retryable/);
    expect(content).not.toMatch(/\(!uploadFailed\s*&&\s*!outcome\.retryable\)/);
    expect(content).toMatch(/Fail the initial publication on preparation or POST failure/);
    expect(content).toMatch(/KPI_ARTIFACT_DIR/);
    expect(content).not.toMatch(/remains gated|pending approved adapters/i);
    expect(content).toMatch(/workflow_id:\s*'kpi-retry\.yml',\s*ref:\s*['"]main['"]/);
    expect(content).not.toMatch(/ref:\s*context\.sha/);
    expect(content).toMatch(/SUPABASE_URL:\s*\$\{\{\s*vars\.SUPABASE_URL\s*\}\}/);
    expect(content).toMatch(/name:\s*kpi-batch-\$\{\{\s*.*run_id.*\}\}/);
  });

  it('uses the last completed Argentina cut when the daily scheduler starts late after local midnight', () => {
    const content = workflow('kpi-publish.yml');
    const reportDateStep = content.match(/id:\s*report-date[\s\S]*?run:\s*\|?\s*\n([\s\S]*?)(?=\n      - id:|\n      - name:)/)?.[1] ?? '';
    const reportDateEntryPoint = resolve(__dirname, '../../../scripts/kpi/report-date.ts');
    const reportDateScript = readFileSync(reportDateEntryPoint, 'utf8');

    expect(reportDateStep).toMatch(/pnpm\s+--filter\s+api\s+exec\s+tsx\s+scripts\/kpi\/report-date\.ts/);
    expect(existsSync(reportDateEntryPoint)).toBe(true);
    expect(reportDateScript).toMatch(/import\s*\{\s*selectAutomaticArgentinaKpiDate\s*\}\s*from\s*['"]\.\.\/\.\.\/src\/modules\/kpi\/kpi-window['"]/);
    expect(reportDateScript).toMatch(/selectAutomaticArgentinaKpiDate\s*\(/);
    expect(reportDateStep).not.toMatch(/TZ=America\/Argentina\/Buenos_Aires\s+date\s+\+%F/);
  });

  it('selects the Supabase URL through the selected GitHub environment and keeps the telemetry health URL separate', () => {
    const publish = workflow('kpi-publish.yml');
    const retry = workflow('kpi-retry.yml');

    expect(publish).toMatch(/environment:\s*\$\{\{\s*github\.event_name\s*==\s*'schedule'\s*&&\s*'prod'\s*\|\|\s*inputs\.environment\s*\}\}/);
    expect(publish).toMatch(/SUPABASE_URL:\s*\$\{\{\s*vars\.SUPABASE_URL\s*\}\}/);
    expect(retry).toMatch(/environment:\s*\$\{\{\s*inputs\.environment\s*\}\}/);
    expect(retry).toMatch(/SUPABASE_URL:\s*\$\{\{\s*vars\.SUPABASE_URL\s*\}\}/);
    expect(publish + retry).not.toContain('KPI_API_BASE_URL');
    expect(publish + retry).not.toMatch(/https?:\/\/(?:gapkr|rzlal)\./i);
  });

  it('blocks non-main refs before secrets and only dispatches a retryable, unaccepted outcome', () => {
    const publish = workflow('kpi-publish.yml');
    const retry = workflow('kpi-retry.yml');

    for (const content of [publish, retry]) {
      expect(content).toMatch(/jobs:\s*[\s\S]*?if:\s*github\.ref\s*==\s*['"]refs\/heads\/main['"][\s\S]*?DATABASE_URL:\s*\$\{\{\s*secrets\.DATABASE_URL\s*\}\}/);
      expect(content).toMatch(/workflow_id:\s*'kpi-retry\.yml',\s*ref:\s*'main'/);
    }
    expect(publish.indexOf('Upload frozen batch artifact before any POST')).toBeLessThan(publish.indexOf('POST only after the frozen batch artifact is uploaded'));
    expect(retry.indexOf('Upload frozen retry payload before any POST')).toBeLessThan(retry.indexOf('POST the same frozen KPI batch after artifact upload'));
    expect(retry).toMatch(/inputs\.attempt\s*==\s*'1'[\s\S]*uploadFailed[\s\S]*attempt:\s*'2'/);
    expect(retry).toMatch(/outcome\.post_accepted\s*\|\|\s*!outcome\.retryable/);
    expect(retry).not.toMatch(/\(!uploadFailed\s*&&\s*!outcome\.retryable\)/);
    expect(retry).not.toMatch(/attempt:\s*'3'/);
  });

  it('does not persist checkout tokens and fails closed when Retry-After exceeds the safe retry window', () => {
    const publish = workflow('kpi-publish.yml');
    const retry = workflow('kpi-retry.yml');

    for (const [content, expectedCheckouts] of [[publish, 1], [retry, 2]] as const) {
      const checkoutSteps = content.split('\n      - ').filter(step => /uses: actions\/checkout@/.test(step));
      expect(checkoutSteps).toHaveLength(expectedCheckouts);
      expect(checkoutSteps.every(step => /persist-credentials:\s*false/.test(step))).toBe(true);
    }
    expect(retry).toContain('MAX_AUTOMATIC_RETRY_DELAY_SECONDS=1800');
    expect(retry).toContain('RETRY_AFTER_EXCEEDS_WORKFLOW_WINDOW');
    expect(retry).toMatch(/RETRY_AFTER_MS[\s\S]*?exceeds the safe 30-minute retry window[\s\S]*?exit 78/);
  });

  it('allows only explicit retry input and carries the exact retry identity', () => {
    const content = workflow('kpi-retry.yml');

    expect(content).toMatch(/workflow_dispatch:/);
    expect(content).toMatch(/date:\s*[\s\S]*environment:\s*[\s\S]*retry_chain_id:\s*[\s\S]*attempt:\s*[\s\S]*source_commit:/);
    expect(content).toMatch(/run_id:/);
    expect(content).toMatch(/Validate retry identity/);
    expect(content).toMatch(/SOURCE_COMMIT/);
    expect(content).toMatch(/git cat-file -e/);
    expect(content).toMatch(/\[\[\s*["']?\$ATTEMPT["']?\s*==\s*["']1["']\s*\|\|\s*["']?\$ATTEMPT["']?\s*==\s*["']2["']/);
    expect(content).toMatch(/base\s*=\s*300/);
    expect(content).toMatch(/base\s*=\s*600/);
    expect(content).toMatch(/pnpm\s+--filter\s+api\s+kpi:retry\s+["']?\$\{args\[@\]\}["']?/);
    expect(content).toMatch(/Respect backoff and Retry-After[\s\S]*hint\s*>\s*base/);
    expect(content).toMatch(/Dispatch retry two only for an eligible retry one failure[\s\S]*inputs\.attempt\s*==\s*['"]1['"]/);
    expect(content).toContain("attempt: '2'");
    expect(content).toMatch(/outcome\.post_accepted\s*\|\|\s*!outcome\.retryable/);
    expect(content).not.toMatch(/\(!uploadFailed\s*&&\s*!outcome\.retryable\)/);
    expect(content).not.toMatch(/remains gated|pending approved adapters/i);
    expect(content).toMatch(/git\s+merge-base\s+--is-ancestor\s+["']?\$SOURCE_COMMIT["']?\s+origin\/main/);
    expect(content).toMatch(/actions\/checkout@v4[\s\S]*ref:\s*\$\{\{\s*inputs\.source_commit\s*\}\}/);
    expect(content).not.toMatch(/ref:\s*process\.env\.SOURCE_COMMIT/);
    expect(content).toMatch(/SUPABASE_URL:\s*\$\{\{\s*vars\.SUPABASE_URL\s*\}\}/);
    expect(content).toMatch(/name:\s*kpi-batch-\$\{\{\s*.*run_id.*\}\}/);
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
