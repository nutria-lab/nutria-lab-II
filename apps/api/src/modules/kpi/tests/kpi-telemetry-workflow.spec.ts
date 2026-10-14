import * as fs from 'fs';
import * as path from 'path';

const WORKFLOW_PATH = path.resolve(
  __dirname,
  '../../../../../../.github/workflows/kpi-telemetry.yml',
);

// ---------------------------------------------------------------------------
// Helpers de lectura por indentación (YAML de GitHub Actions, sin parser).
// ---------------------------------------------------------------------------

function readWorkflow(): string {
  if (!fs.existsSync(WORKFLOW_PATH)) {
    throw new Error(`No existe el workflow de telemetría: ${WORKFLOW_PATH}`);
  }
  return fs.readFileSync(WORKFLOW_PATH, 'utf8').replace(/\r\n/g, '\n');
}

/** Quita comentarios de línea completa y comentarios finales " # ...". */
function stripComments(text: string): string[] {
  return text
    .split('\n')
    .map(line => (/^\s*#/.test(line) ? '' : line.replace(/\s+#\s.*$/, '')));
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Normaliza un ítem de lista "- key: v" para que su key quede con la indentación del contenido. */
function normalizeListItem(line: string): string {
  return line.replace(/^(\s*)- /, (_m, sp: string) => `${sp}  `);
}

/** Líneas hijas (más indentadas) de la línea en `start`. */
function childBlock(lines: string[], start: number): string[] {
  const limit = indentOf(normalizeListItem(lines[start]));
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() !== '' && indentOf(line) <= limit) break;
    out.push(line);
  }
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return out;
}

function keyRegex(key: string): RegExp {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*(?:- )?${escaped}:(?:\\s|$)`);
}

/** Índices de las líneas que declaran `key:` con exactamente la indentación dada (si se pasa). */
function findKeys(lines: string[], key: string, indent?: number): number[] {
  const re = keyRegex(key);
  const out: number[] = [];
  lines.forEach((line, i) => {
    if (!re.test(line)) return;
    if (indent !== undefined && indentOf(normalizeListItem(line)) !== indent) return;
    out.push(i);
  });
  return out;
}

function inlineValue(line: string): string {
  const raw = line.replace(/^\s*(?:- )?[^:]+:\s?/, '').trim();
  return unquote(raw);
}

function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
    return v.slice(1, -1);
  }
  return v;
}

function normalizeExpr(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
}

/** Bloque de un mapa top-level como `on:` o `jobs:`. */
function topLevelBlock(lines: string[], key: string): string[] {
  const idx = findKeys(lines, key, 0);
  if (idx.length !== 1) {
    throw new Error(`Se esperaba exactamente una clave top-level "${key}:" (encontradas ${idx.length})`);
  }
  return childBlock(lines, idx[0]);
}

function firstContentIndent(block: string[]): number {
  const first = block.find(l => l.trim() !== '');
  if (!first) throw new Error('Bloque vacío');
  return indentOf(first);
}

/** Opciones de un input `choice`: soporta `options: [a, b]` y lista con guiones. */
function parseOptions(inputBlock: string[]): string[] {
  const idx = findKeys(inputBlock, 'options');
  if (idx.length !== 1) return [];
  const inline = inlineValue(inputBlock[idx[0]]);
  if (inline.startsWith('[')) {
    return inline
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map(s => unquote(s))
      .filter(Boolean);
  }
  return childBlock(inputBlock, idx[0])
    .filter(l => /^\s*- /.test(l))
    .map(l => unquote(l.replace(/^\s*- /, '')));
}

function scalarValue(block: string[], key: string): string | undefined {
  const idx = findKeys(block, key, firstContentIndent(block));
  if (idx.length === 0) return undefined;
  return inlineValue(block[idx[0]]);
}

interface Workflow {
  lines: string[];
  text: string;
  job: string[];
  jobIndent: number;
  steps: Step[];
}

interface Step {
  lines: string[];
  uses?: string;
  run?: string;
  ifCond?: string;
  env: Record<string, string>;
  with: Record<string, string>;
}

function parseMap(block: string[]): Record<string, string> {
  if (block.length === 0) return {};
  const indent = firstContentIndent(block);
  const out: Record<string, string> = {};
  for (const line of block) {
    if (line.trim() === '' || indentOf(line) !== indent) continue;
    const m = /^\s*([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = unquote(m[2]);
  }
  return out;
}

function parseStep(stepLines: string[]): Step {
  const norm = stepLines.map((l, i) => (i === 0 ? normalizeListItem(l) : l));
  const keyIndent = indentOf(norm[0]);
  const get = (key: string): number | undefined => findKeys(norm, key, keyIndent)[0];

  const usesIdx = get('uses');
  const runIdx = get('run');
  const ifIdx = get('if');
  const envIdx = get('env');
  const withIdx = get('with');

  let run: string | undefined;
  if (runIdx !== undefined) {
    const inline = inlineValue(norm[runIdx]);
    if (/^[|>][-+]?$/.test(inline)) {
      run = childBlock(norm, runIdx)
        .map(l => l.trim())
        .join('\n');
    } else {
      run = inline;
    }
  }

  return {
    lines: norm,
    uses: usesIdx !== undefined ? inlineValue(norm[usesIdx]) : undefined,
    run,
    ifCond: ifIdx !== undefined ? inlineValue(norm[ifIdx]) : undefined,
    env: envIdx !== undefined ? parseMap(childBlock(norm, envIdx)) : {},
    with: withIdx !== undefined ? parseMap(childBlock(norm, withIdx)) : {},
  };
}

function loadWorkflow(): Workflow {
  const text = readWorkflow();
  const lines = stripComments(text);

  const jobs = topLevelBlock(lines, 'jobs');
  const jobIdIndent = firstContentIndent(jobs);
  const jobIds = jobs.filter(l => l.trim() !== '' && indentOf(l) === jobIdIndent);
  if (jobIds.length !== 1) {
    throw new Error(`Se esperaba un único job (encontrados ${jobIds.length})`);
  }
  const job = childBlock(jobs, jobs.indexOf(jobIds[0]));
  const jobIndent = firstContentIndent(job);

  const stepsIdx = findKeys(job, 'steps', jobIndent);
  if (stepsIdx.length !== 1) throw new Error('El job no declara steps:');
  const stepsBlock = childBlock(job, stepsIdx[0]);
  const itemIndent = Math.min(
    ...stepsBlock.filter(l => /^\s*- /.test(l)).map(indentOf),
  );
  const steps: Step[] = [];
  let current: string[] | null = null;
  for (const line of stepsBlock) {
    if (/^\s*- /.test(line) && indentOf(line) === itemIndent) {
      if (current) steps.push(parseStep(current));
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) steps.push(parseStep(current));

  return { lines, text: lines.join('\n'), job, jobIndent, steps };
}

function jobScalar(wf: Workflow, key: string): string | undefined {
  const idx = findKeys(wf.job, key, wf.jobIndent);
  if (idx.length === 0) return undefined;
  const inline = inlineValue(wf.job[idx[0]]);
  if (inline !== '') return inline;
  // forma de mapa, p. ej. environment: { name: ... }
  const nested = parseMap(childBlock(wf.job, idx[0]));
  return nested.name;
}

function telemetryStep(wf: Workflow): Step {
  const matches = wf.steps.filter(s => s.run && /pnpm\s+--filter\s+api\s+(?:run\s+)?kpi:telemetry\b/.test(s.run));
  if (matches.length !== 1) {
    throw new Error(`Se esperaba exactamente un paso que ejecute kpi:telemetry (encontrados ${matches.length})`);
  }
  return matches[0];
}

/** Entorno efectivo de un paso: workflow env < job env < step env. */
function effectiveEnv(wf: Workflow, step: Step): Record<string, string> {
  const topEnvIdx = findKeys(wf.lines, 'env', 0);
  const top = topEnvIdx.length ? parseMap(childBlock(wf.lines, topEnvIdx[0])) : {};
  const jobEnvIdx = findKeys(wf.job, 'env', wf.jobIndent);
  const job = jobEnvIdx.length ? parseMap(childBlock(wf.job, jobEnvIdx[0])) : {};
  return { ...top, ...job, ...step.env };
}

/** Variable de shell usada como argumento de un flag, p. ej. --mode "$MODE" → MODE. */
function shellVarForFlag(run: string, flag: string): string | undefined {
  const re = new RegExp(`${flag}[\\s=]+"?\\$\\{?([A-Za-z_][A-Za-z0-9_]*)\\}?"?`);
  return re.exec(run)?.[1];
}

function workflowDispatchInputs(wf: Workflow): string[] {
  const on = topLevelBlock(wf.lines, 'on');
  const onIndent = firstContentIndent(on);
  const wd = findKeys(on, 'workflow_dispatch', onIndent);
  if (wd.length !== 1) throw new Error('Falta on.workflow_dispatch');
  const wdBlock = childBlock(on, wd[0]);
  const inputsIdx = findKeys(wdBlock, 'inputs', firstContentIndent(wdBlock));
  if (inputsIdx.length !== 1) throw new Error('workflow_dispatch no declara inputs');
  return childBlock(wdBlock, inputsIdx[0]);
}

function inputBlock(inputs: string[], name: string): string[] {
  const idx = findKeys(inputs, name, firstContentIndent(inputs));
  if (idx.length !== 1) throw new Error(`Falta el input "${name}"`);
  return childBlock(inputs, idx[0]);
}

function allRuns(wf: Workflow): string[] {
  return wf.steps.map(s => s.run).filter((r): r is string => r !== undefined);
}

// ---------------------------------------------------------------------------

describe('NUT-85 T6 — workflow .github/workflows/kpi-telemetry.yml', () => {
  describe('I1 — disparadores y ambiente efectivo', () => {
    it('existe en la raíz del repo', () => {
      expect(fs.existsSync(WORKFLOW_PATH)).toBe(true);
    });

    it('on.schedule tiene un único cron exacto "*/30 * * * *"', () => {
      const wf = loadWorkflow();
      const on = topLevelBlock(wf.lines, 'on');
      const schedule = findKeys(on, 'schedule', firstContentIndent(on));
      expect(schedule).toHaveLength(1);
      const crons = childBlock(on, schedule[0])
        .filter(l => keyRegex('cron').test(l))
        .map(inlineValue);
      expect(crons).toEqual(['*/30 * * * *']);
    });

    it('workflow_dispatch: environment es choice dev/prod (sin qa)', () => {
      const wf = loadWorkflow();
      const env = inputBlock(workflowDispatchInputs(wf), 'environment');
      expect(scalarValue(env, 'type')).toBe('choice');
      expect([...parseOptions(env)].sort()).toEqual(['dev', 'prod']);
      expect(env.join('\n')).not.toMatch(/\bqa\b/);
    });

    it('workflow_dispatch: mode es choice sample/finalize', () => {
      const wf = loadWorkflow();
      const mode = inputBlock(workflowDispatchInputs(wf), 'mode');
      expect(scalarValue(mode, 'type')).toBe('choice');
      expect([...parseOptions(mode)].sort()).toEqual(['finalize', 'sample']);
    });

    it('workflow_dispatch: date es opcional y de tipo string', () => {
      const wf = loadWorkflow();
      const date = inputBlock(workflowDispatchInputs(wf), 'date');
      expect(scalarValue(date, 'required')).not.toBe('true');
      const type = scalarValue(date, 'type');
      if (type !== undefined) expect(type).toBe('string');
      expect(scalarValue(date, 'default') ?? '').toBe('');
    });

    it('workflow_dispatch: la descripción de date habla de la fecha local de Argentina, no de UTC', () => {
      const wf = loadWorkflow();
      const date = inputBlock(workflowDispatchInputs(wf), 'date');
      expect(scalarValue(date, 'description')).toBeDefined();
      // Bloque completo por si la descripción es multilínea (| o >).
      const descriptionText = date.join('\n');
      expect(descriptionText).toMatch(/America\/Argentina\/Buenos_Aires/);
      expect(descriptionText).toMatch(/YYYY-MM-DD/);
      expect(descriptionText).not.toMatch(/\bUTC\b/i);
    });

    it('el job usa GitHub Environments con el ambiente efectivo (input o prod en schedule)', () => {
      const wf = loadWorkflow();
      const environment = jobScalar(wf, 'environment');
      expect(environment).toBeDefined();
      const expr = normalizeExpr(environment!);
      expect(expr).toMatch(/^\$\{\{.*\}\}$/);
      expect(expr).toMatch(/inputs\.environment/);
      expect(expr).toMatch(/'prod'/);
      expect(expr).not.toMatch(/'dev'|'qa'/);
    });

    it('el job solo corre con vars.KPI_TELEMETRY_ENABLED == true (no se activa hasta que exista kpi:telemetry)', () => {
      const wf = loadWorkflow();
      const condition = jobScalar(wf, 'if');
      expect(condition).toBeDefined();
      expect(normalizeExpr(condition!).replace(/^\$\{\{\s*|\s*\}\}$/g, '')).toBe("vars.KPI_TELEMETRY_ENABLED == 'true'");
    });

    it('el schedule ejecuta sample: MODE resuelve inputs.mode o sample', () => {
      const wf = loadWorkflow();
      const step = telemetryStep(wf);
      const modeVar = shellVarForFlag(step.run!, '--mode');
      expect(modeVar).toBeDefined();
      const expr = normalizeExpr(effectiveEnv(wf, step)[modeVar!] ?? '');
      expect(expr).toMatch(/inputs\.mode/);
      expect(expr).toMatch(/'sample'/);
      expect(expr).not.toMatch(/'finalize'/);
    });
  });

  describe('I2 — aislamiento, pasos y comando', () => {
    it('concurrency por ambiente efectivo con cancel-in-progress: false', () => {
      const wf = loadWorkflow();
      const idx = findKeys(wf.lines, 'concurrency');
      expect(idx).toHaveLength(1);
      const conc = parseMap(childBlock(wf.lines, idx[0]));
      expect(normalizeExpr(conc.group ?? '')).toMatch(/inputs\.environment/);
      expect(normalizeExpr(conc.group ?? '')).toMatch(/'prod'/);
      expect(conc['cancel-in-progress']).toBe('false');
      expect(wf.text).not.toMatch(/cancel-in-progress:\s*true/);
    });

    it('permissions: solo contents: read (nada más amplio)', () => {
      const wf = loadWorkflow();
      const idx = findKeys(wf.lines, 'permissions');
      expect(idx.length).toBeGreaterThanOrEqual(1);
      for (const i of idx) {
        expect(inlineValue(wf.lines[i])).toBe('');
        expect(parseMap(childBlock(wf.lines, i))).toEqual({ contents: 'read' });
      }
      expect(wf.text).not.toMatch(/write-all|read-all|:\s*write\b/);
    });

    it('timeout-minutes: 10 en el job', () => {
      const wf = loadWorkflow();
      expect(jobScalar(wf, 'timeout-minutes')).toBe('10');
    });

    it('checkout de la rama default (sin ref a la rama del evento manual)', () => {
      const wf = loadWorkflow();
      const checkout = wf.steps.filter(s => /^actions\/checkout@v\d+/.test(s.uses ?? ''));
      expect(checkout).toHaveLength(1);
      const ref = checkout[0].with.ref;
      if (ref !== undefined) {
        expect(normalizeExpr(ref)).toBe('${{ github.event.repository.default_branch }}');
      }
      expect(wf.text).not.toMatch(/github\.head_ref|github\.ref_name|inputs\.ref\b/);
    });

    it('Node 24 con pnpm/action-setup y pnpm install --frozen-lockfile', () => {
      const wf = loadWorkflow();
      expect(wf.steps.some(s => /^pnpm\/action-setup@v\d+/.test(s.uses ?? ''))).toBe(true);
      const node = wf.steps.filter(s => /^actions\/setup-node@v\d+/.test(s.uses ?? ''));
      expect(node).toHaveLength(1);
      let version = node[0].with['node-version'] ?? '';
      const envRef = /\$\{\{\s*env\.([A-Za-z0-9_]+)\s*\}\}/.exec(version);
      if (envRef) version = effectiveEnv(wf, node[0])[envRef[1]] ?? '';
      expect(version).toBe('24');
      expect(allRuns(wf).some(r => /pnpm\s+install\s+--frozen-lockfile/.test(r))).toBe(true);
    });

    it('prisma generate se ejecuta antes del script de telemetría', () => {
      const wf = loadWorkflow();
      const generate = wf.steps.findIndex(s => /prisma(?::|\s+)generate/.test(s.run ?? ''));
      const telemetry = wf.steps.indexOf(telemetryStep(wf));
      expect(generate).toBeGreaterThanOrEqual(0);
      expect(generate).toBeLessThan(telemetry);
    });

    it('ejecuta pnpm --filter api kpi:telemetry --mode --environment por env y --date solo si viene', () => {
      const wf = loadWorkflow();
      const step = telemetryStep(wf);
      const run = step.run!;
      const env = effectiveEnv(wf, step);

      const modeVar = shellVarForFlag(run, '--mode');
      const envVar = shellVarForFlag(run, '--environment');
      expect(modeVar).toBeDefined();
      expect(envVar).toBeDefined();
      expect(run).toMatch(/--diagnostics-out[\s=]+\S+/);

      // --date sólo condicional: ${DATE:+--date "$DATE"} o dentro de un if [ -n ... ].
      const dateUses = run.match(/--date/g) ?? [];
      expect(dateUses.length).toBeGreaterThanOrEqual(1);
      const conditional =
        /\$\{([A-Za-z_][A-Za-z0-9_]*):\+--date[\s=]+"?\$\{?\1\}?"?\}/.exec(run) ??
        /if\s+\[\[?\s+-n\s+"?\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?"?\s*\]\]?[\s\S]*--date[\s=]+"?\$\{?\1\}?"?/.exec(run);
      expect(conditional).not.toBeNull();
      const dateVar = conditional![1];
      expect(normalizeExpr(env[dateVar] ?? '')).toMatch(/^\$\{\{.*inputs\.date.*\}\}$/);
    });

    it('nunca ejecuta migrate (dev/deploy/reset), db push ni seed', () => {
      const wf = loadWorkflow();
      expect(wf.text).not.toMatch(/\bmigrate\b/i);
      expect(wf.text).not.toMatch(/db\s+push/i);
      expect(wf.text).not.toMatch(/\bseed\b/i);
    });

    it('los inputs llegan por env: ningún run: interpola ${{ ... }}', () => {
      const wf = loadWorkflow();
      for (const run of allRuns(wf)) {
        expect(run).not.toMatch(/\$\{\{/);
      }
    });
  });

  describe('I3 — artifact de diagnóstico y secrets/vars del contrato', () => {
    it('sube el diagnóstico con actions/upload-artifact, if: always() y retention-days: 90', () => {
      const wf = loadWorkflow();
      const uploads = wf.steps.filter(s => /^actions\/upload-artifact@v\d+/.test(s.uses ?? ''));
      expect(uploads).toHaveLength(1);
      const upload = uploads[0];
      expect(normalizeExpr(upload.ifCond ?? '')).toMatch(/^(\$\{\{\s*)?always\(\)(\s*\}\})?$/);
      expect(upload.with['retention-days']).toBe('90');

      const out = /--diagnostics-out[\s=]+"?([^"\s]+)"?/.exec(telemetryStep(wf).run!)?.[1] ?? '';
      const base = path.posix.basename(out);
      expect(base).not.toBe('');
      expect(upload.with.path ?? '').toContain(base);
      expect(wf.steps.indexOf(upload)).toBeGreaterThan(wf.steps.indexOf(telemetryStep(wf)));
    });

    it('solo usa secrets.DATABASE_URL y vars KPI_ENV / KPI_API_BASE_URL (más la guarda KPI_TELEMETRY_ENABLED)', () => {
      const wf = loadWorkflow();
      const secrets = new Set([...wf.text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map(m => m[1]));
      const vars = new Set([...wf.text.matchAll(/vars\.([A-Za-z0-9_]+)/g)].map(m => m[1]));
      expect([...secrets]).toEqual(['DATABASE_URL']);
      expect([...vars].sort()).toEqual(['KPI_API_BASE_URL', 'KPI_ENV', 'KPI_TELEMETRY_ENABLED']);
      expect(wf.text).not.toMatch(/DATABASE_URL_UNPOOLED|PROJECT_KEY|SUPABASE_|service_role/);
      expect(wf.text).not.toMatch(/secrets\s*\[|toJSON\(\s*secrets/);

      const env = effectiveEnv(wf, telemetryStep(wf));
      expect(normalizeExpr(env.DATABASE_URL ?? '')).toBe('${{ secrets.DATABASE_URL }}');
      expect(normalizeExpr(env.KPI_ENV ?? '')).toBe('${{ vars.KPI_ENV }}');
      expect(normalizeExpr(env.KPI_API_BASE_URL ?? '')).toBe('${{ vars.KPI_API_BASE_URL }}');
    });

    it('no hace echo de secrets ni activa trazas de shell', () => {
      const wf = loadWorkflow();
      for (const run of allRuns(wf)) {
        expect(run).not.toMatch(/(echo|printf|cat)[^\n]*\$\{?(DATABASE_URL|KPI_API_BASE_URL)\b/);
        expect(run).not.toMatch(/set\s+-[a-z]*x|\benv\s*$|\bprintenv\b/m);
      }
    });

    it('--environment usa el mismo ambiente efectivo que el GitHub Environment (KPI_ENV coincide)', () => {
      const wf = loadWorkflow();
      const step = telemetryStep(wf);
      const envVar = shellVarForFlag(step.run!, '--environment');
      expect(envVar).toBeDefined();
      expect(envVar).not.toBe('KPI_ENV');
      const passed = normalizeExpr(effectiveEnv(wf, step)[envVar!] ?? '');
      expect(passed).not.toBe('');
      expect(passed).toBe(normalizeExpr(jobScalar(wf, 'environment') ?? ''));
    });
  });
});
