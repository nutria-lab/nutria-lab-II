/** Side-effect-free argument parsing shared by the executable KPI CLIs. */
export type PublishableKpiEnvironment = 'dev' | 'prod';

export interface PublishCliArgs {
  date: string;
  environment: PublishableKpiEnvironment;
  retryChainId?: string;
  runId?: string;
  phase?: 'prepare-only' | 'post-frozen';
}

export interface RetryCliArgs extends PublishCliArgs {
  retryChainId: string;
  attempt: 0 | 1 | 2;
  sourceCommit: string;
  runId?: string;
  manualRecovery?: boolean;
}

interface ParsedOptions {
  values: Readonly<Record<string, string>>;
  flags: ReadonlySet<string>;
}

function parseOptions(args: readonly string[], allowed: readonly string[], allowedFlags: readonly string[] = []): ParsedOptions {
  const values: Record<string, string> = {};
  const flags = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument}`);
    }

    const equals = argument.indexOf('=');
    const key = argument.slice(2, equals === -1 ? undefined : equals);
    if (allowedFlags.includes(key)) {
      if (equals !== -1 || flags.has(key)) throw new Error(`Invalid option: ${argument}`);
      flags.add(key);
      continue;
    }
    if (!allowed.includes(key) || key.length === 0 || Object.prototype.hasOwnProperty.call(values, key)) {
      throw new Error(`Invalid option: ${argument}`);
    }

    const value = equals === -1 ? args[++index] : argument.slice(equals + 1);
    if (value === undefined || value.length === 0 || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    values[key] = value;
  }

  return { values, flags };
}

function requireOption(options: ParsedOptions['values'], key: string): string {
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
  const { values: options, flags } = parseOptions(
    args, ['date', 'environment', 'retry-chain-id', 'run-id'], ['prepare-only', 'post-frozen'],
  );
  const phase = parsePhase(flags);
  const retryChainId = options['retry-chain-id'];
  const runId = options['run-id'];
  if (retryChainId !== undefined && !isUuid(retryChainId)) throw new Error('Retry chain ID must be a UUID');
  if (runId !== undefined && !isUuid(runId)) throw new Error('Run ID must be a UUID');
  if (phase === 'post-frozen' && (!retryChainId || !runId)) {
    throw new Error('Post-frozen requires --retry-chain-id and --run-id');
  }
  return {
    date: assertDate(requireOption(options, 'date')),
    environment: assertEnvironment(requireOption(options, 'environment')),
    ...(retryChainId === undefined ? {} : { retryChainId }),
    ...(runId === undefined ? {} : { runId }),
    ...(phase === undefined ? {} : { phase }),
  };
}

export function parseRetryCliArgs(args: readonly string[]): RetryCliArgs {
  const { values: options, flags } = parseOptions(
    args,
    ['date', 'environment', 'retry-chain-id', 'attempt', 'source-commit', 'run-id'],
    ['manual-recovery', 'prepare-only', 'post-frozen'],
  );
  const phase = parsePhase(flags);
  const manualRecovery = flags.has('manual-recovery');
  const attemptValue = options.attempt;
  if (manualRecovery ? attemptValue !== undefined : attemptValue !== '1' && attemptValue !== '2') {
    throw new Error(manualRecovery ? 'Manual recovery does not accept --attempt' : 'Attempt must be 1 or 2');
  }
  const retryChainId = requireOption(options, 'retry-chain-id');
  if (!isUuid(retryChainId)) throw new Error('Retry chain ID must be a UUID');
  const sourceCommit = requireOption(options, 'source-commit');
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit)) {
    throw new Error('Source commit must be a full SHA-1');
  }
  const runId = options['run-id'];
  if (runId !== undefined && !isUuid(runId)) throw new Error('Run ID must be a UUID');
  if (manualRecovery && !runId) throw new Error('Manual recovery requires --run-id');

  return {
    ...parsePublishCliArgs([
      '--date', requireOption(options, 'date'),
      '--environment', requireOption(options, 'environment'),
    ]),
    retryChainId,
    attempt: manualRecovery ? 0 : Number(attemptValue) as 1 | 2,
    sourceCommit,
    ...(runId === undefined ? {} : { runId }),
    ...(manualRecovery ? { manualRecovery: true } : {}),
    ...(phase === undefined ? {} : { phase }),
  };
}

function parsePhase(flags: ReadonlySet<string>): 'prepare-only' | 'post-frozen' | undefined {
  const prepareOnly = flags.has('prepare-only');
  const postFrozen = flags.has('post-frozen');
  if (prepareOnly && postFrozen) throw new Error('Choose only one KPI publication phase');
  return prepareOnly ? 'prepare-only' : postFrozen ? 'post-frozen' : undefined;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
