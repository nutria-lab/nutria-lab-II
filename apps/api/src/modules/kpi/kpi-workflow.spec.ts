import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function workflow(name: 'kpi-publish.yml' | 'kpi-retry.yml'): string {
  return readFileSync(resolve(__dirname, '../../../../../.github/workflows', name), 'utf8');
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

  it('allows only explicit retry input and carries the exact retry identity', () => {
    const content = workflow('kpi-retry.yml');

    expect(content).toMatch(/workflow_dispatch:/);
    expect(content).toMatch(/date:\s*[\s\S]*environment:\s*[\s\S]*retry_chain_id:\s*[\s\S]*attempt:\s*[\s\S]*source_commit:/);
    expect(content).toMatch(/run_id:/);
    expect(content).toMatch(/inputs\.attempt\s*==\s*['"]1['"]/);
    expect(content).toMatch(/inputs\.attempt\s*==\s*['"]2['"]/);
    expect(content).toMatch(/(?:sleep|delay)[^\n]*(?:300|5\s*\*\s*60)|(?:300|5\s*\*\s*60)[^\n]*(?:sleep|delay)/);
    expect(content).toMatch(/(?:sleep|delay)[^\n]*(?:600|10\s*\*\s*60)|(?:600|10\s*\*\s*60)[^\n]*(?:sleep|delay)/);
    expect(content).toMatch(/gated pending approved adapters/i);
    expect(content).not.toMatch(/\b(?:curl|wget)\b|https?:\/\//i);
    expectCommonSafetyGuards(content, 40);
  });
});
