/**
 * Parsing only: execution is intentionally kept outside this module until the
 * publication repository and remote-client adapters have been approved.
 */
export type PublishableKpiEnvironment = 'dev' | 'prod';

export interface PublishCliArgs {
  date: string;
  environment: PublishableKpiEnvironment;
}

export interface RetryCliArgs extends PublishCliArgs {
  retryChainId: string;
  attempt: 1 | 2;
  sourceCommit: string;
  runId?: string;
  manualRecovery: boolean;
}

export interface CatalogCliArgs {
  environment: PublishableKpiEnvironment;
}

type ParsedOptions = Readonly<Record<string, string>>;

function parseOptions(args: readonly string[], allowed: readonly string[]): ParsedOptions {
  const values: Record<string, string> = {};

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument}`);
    }

    const equals = argument.indexOf('=');
    const key = argument.slice(2, equals === -1 ? undefined : equals);
    if (!allowed.includes(key) || key.length === 0 || Object.prototype.hasOwnProperty.call(values, key)) {
      throw new Error(`Invalid option: ${argument}`);
    }

    const value = equals === -1 ? args[++index] : argument.slice(equals + 1);
    if (value === undefined || value.length === 0 || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    values[key] = value;
  }

  return values;
}

function requireOption(options: ParsedOptions, key: string): string {
  const value = options[key];
  if (value === undefined) {
    throw new Error(`Missing required option --${key}`);
  }
  return value;
}

function assertDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Date must be YYYY-MM-DD');
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('Date must be a valid calendar date');
  }
  return value;
}

function assertEnvironment(value: string): PublishableKpiEnvironment {
  if (value !== 'dev' && value !== 'prod') {
    throw new Error('Environment must be dev or prod');
  }
  return value;
}

export function parsePublishCliArgs(args: readonly string[]): PublishCliArgs {
  const options = parseOptions(args, ['date', 'environment']);
  return {
    date: assertDate(requireOption(options, 'date')),
    environment: assertEnvironment(requireOption(options, 'environment')),
  };
}

export function parseRetryCliArgs(args: readonly string[]): RetryCliArgs {
  const options = parseOptions(args, ['date', 'environment', 'retry-chain-id', 'attempt', 'source-commit', 'run-id', 'manual-recovery']);
  const attemptValue = requireOption(options, 'attempt');
  if (attemptValue !== '1' && attemptValue !== '2') {
    throw new Error('Attempt must be 1 or 2');
  }
  const retryChainId = requireOption(options, 'retry-chain-id');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(retryChainId)) {
    throw new Error('Retry chain ID must be a UUID');
  }
  const sourceCommit = requireOption(options, 'source-commit');
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit)) {
    throw new Error('Source commit must be a full SHA-1');
  }
  const runId = options['run-id'];
  if (runId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
    throw new Error('Run ID must be a UUID');
  }
  const manualRecoveryValue = options['manual-recovery'] ?? 'false';
  if (manualRecoveryValue !== 'true' && manualRecoveryValue !== 'false') throw new Error('Manual recovery must be true or false');
  const manualRecovery = manualRecoveryValue === 'true';
  if (manualRecovery && attemptValue !== '1') throw new Error('Manual recovery starts at attempt 1');

  return {
    ...parsePublishCliArgs([
      '--date', requireOption(options, 'date'),
      '--environment', requireOption(options, 'environment'),
    ]),
    retryChainId,
    attempt: Number(attemptValue) as 1 | 2,
    sourceCommit,
    manualRecovery,
    ...(options['run-id'] === undefined ? {} : { runId: options['run-id'] }),
  };
}

export function parseCatalogCliArgs(args: readonly string[]): CatalogCliArgs {
  const options = parseOptions(args, ['environment']);
  return { environment: assertEnvironment(requireOption(options, 'environment')) };
}
