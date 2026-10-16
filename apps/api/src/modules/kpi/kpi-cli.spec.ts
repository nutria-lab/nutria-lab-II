import { parsePublishCliArgs, parseRetryCliArgs } from './kpi-cli';

describe('KPI CLI argument parsing', () => {
  it('accepts explicit publish date and the only publishable environments', () => {
    expect(parsePublishCliArgs(['--date', '2026-10-09', '--environment', 'prod'])).toEqual({
      date: '2026-10-09',
      environment: 'prod',
    });
    expect(parsePublishCliArgs(['--environment=dev', '--date=2026-01-01'])).toEqual({
      date: '2026-01-01',
      environment: 'dev',
    });
  });

  it.each([
    ['missing date', ['--environment', 'prod']],
    ['impossible calendar date', ['--date', '2026-02-29', '--environment', 'prod']],
    ['non-ISO date', ['--date', '09-10-2026', '--environment', 'prod']],
    ['unsupported environment', ['--date', '2026-10-09', '--environment', 'qa']],
    ['unknown switch', ['--date', '2026-10-09', '--environment', 'prod', '--debug']],
  ])('rejects publish input with %s', (_label, args) => {
    expect(() => parsePublishCliArgs(args)).toThrow();
  });

  it('accepts a retry only when its date, environment, UUID chain, attempt and full commit SHA are valid', () => {
    expect(parseRetryCliArgs([
      '--date', '2026-10-09',
      '--environment', 'prod',
      '--retry-chain-id', 'f049dc13-8d9f-4c23-9f55-0f1a4d676fe4',
      '--attempt', '2',
      '--source-commit', 'a'.repeat(40),
      '--run-id', 'f66cd499-0171-41dc-858f-bef11373f1f5',
    ])).toEqual({
      date: '2026-10-09',
      environment: 'prod',
      retryChainId: 'f049dc13-8d9f-4c23-9f55-0f1a4d676fe4',
      attempt: 2,
      sourceCommit: 'a'.repeat(40),
      runId: 'f66cd499-0171-41dc-858f-bef11373f1f5',
    });
  });

  it.each([
    ['bad date', ['--date', '2026-13-09']],
    ['unsupported environment', ['--environment', 'qa']],
    ['non-UUID chain', ['--retry-chain-id', 'retry-1']],
    ['initial attempt', ['--attempt', '0']],
    ['fourth attempt', ['--attempt', '3']],
    ['abbreviated SHA', ['--source-commit', 'abcdef0']],
    ['non-hex SHA', ['--source-commit', 'g'.repeat(40)]],
  ])('rejects retry %s', (_label, replacement) => {
    const args = [
      '--date', '2026-10-09', '--environment', 'dev',
      '--retry-chain-id', 'f049dc13-8d9f-4c23-9f55-0f1a4d676fe4',
      '--attempt', '1', '--source-commit', 'b'.repeat(40),
      ...replacement,
    ];

    expect(() => parseRetryCliArgs(args)).toThrow();
  });
});
