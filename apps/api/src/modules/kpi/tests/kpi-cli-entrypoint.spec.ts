// NUT-85 T5 — Entrypoint delgado del CLI (design D22). Estático + typecheck dirigido.
// apps/api/scripts/kpi/telemetry.ts queda fuera de rootDir/include: ni lint ni build lo ven, por eso este spec.
// Contrato: único import relativo '../../src/modules/kpi/cli/telemetry-cli'; sin dotenv ni '@/'; sin lógica;
// runTelemetryCli(process.argv.slice(2), process.env, createDefaultDeps()).then(code => { process.exitCode = code; }).
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

jest.setTimeout(180_000);

const API_ROOT = path.resolve(__dirname, '../../../..');
const ENTRY = path.resolve(API_ROOT, 'scripts/kpi/telemetry.ts');
const CLI_MODULE = path.resolve(API_ROOT, 'src/modules/kpi/cli/telemetry-cli.ts');

function source(): string {
  return fs.readFileSync(ENTRY, 'utf-8');
}

function importSpecifiers(text: string): string[] {
  const file = ts.createSourceFile(ENTRY, text, ts.ScriptTarget.ES2021, true);
  const specs: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specs.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specs.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return specs;
}

describe('scripts/kpi/telemetry.ts (entrypoint, D22)', () => {
  it('existe y el CLI vive en src', () => {
    expect(fs.existsSync(ENTRY)).toBe(true);
    expect(fs.existsSync(CLI_MODULE)).toBe(true);
  });

  it('sólo importa ../../src/modules/kpi/cli/telemetry-cli', () => {
    expect(importSpecifiers(source())).toEqual(['../../src/modules/kpi/cli/telemetry-cli']);
  });

  it('no importa dotenv ni usa el alias @/', () => {
    const text = source();
    expect(text).not.toMatch(/dotenv/);
    expect(text).not.toMatch(/['"]@\//);
  });

  it('delega en runTelemetryCli con createDefaultDeps y setea process.exitCode', () => {
    const text = source();
    expect(text).toMatch(/runTelemetryCli\(\s*process\.argv\.slice\(2\)\s*,\s*process\.env\s*,\s*createDefaultDeps\(\)\s*\)/);
    expect(text).toMatch(/process\.exitCode\s*=/);
    expect(text).not.toMatch(/process\.exit\(/);
  });

  it('no contiene lógica (sin control de flujo) y es corto', () => {
    const text = source();
    expect(text).not.toMatch(/\b(if|for|while|switch|try|catch)\b\s*[({]/);
    expect(text).not.toMatch(/\?\s*[^.:]+\s*:/); // sin ternarios
    const codeLines = text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('//'));
    expect(codeLines.length).toBeLessThanOrEqual(15);
  });

  it('typecheckea sin errores (strict, CommonJS, ES2021)', () => {
    const program = ts.createProgram([ENTRY], {
      strict: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
      esModuleInterop: true,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      skipLibCheck: true,
      types: ['node'],
      noEmit: true,
    });
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    expect(diagnostics).toEqual([]);
  });
});
