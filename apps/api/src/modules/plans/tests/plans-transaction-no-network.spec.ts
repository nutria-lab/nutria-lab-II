import * as fs from 'fs';
import * as path from 'path';

/**
 * NUT-83 — AC14 (design.md D2): "ningún método que abra o reciba un `$transaction` puede
 * invocar, directa o indirectamente, al adaptador de Pexels". Verificación ESTÁTICA: se lee
 * como texto plano el archivo completo `plans.repository.ts` (no sólo el método que abre la
 * transacción) porque, tal como permite explícitamente el enunciado de esta etapa, es la forma
 * más simple y sigue siendo una aserción honesta — si la cadena "pexels" no aparece en NINGÚN
 * lugar del archivo (ni en imports, ni en comentarios, ni en código), es estructuralmente
 * imposible que el código que abre la transacción lo invoque.
 *
 * Mismo patrón que los specs de migración (`generation-run-migration.spec.ts`,
 * `recipe-image-migration.spec.ts`): lectura de texto plano con `fs.readFileSync`, sin importar
 * el módulo real ni tocar ninguna base de datos.
 *
 * Este test pasa HOY (green) porque `plans.repository.ts` todavía no referencia a Pexels en
 * absoluto — es intencional: design.md D2 es una regla dura que nunca debe dejar de cumplirse,
 * así que este archivo queda como guarda permanente, no como un test que deba "ponerse en
 * verde" recién después de la integración. Si un futuro cambio agrega una importación o llamada
 * a Pexels dentro de `plans.repository.ts` (violando D2), este test debe empezar a fallar.
 */
describe('plans.repository.ts no referencia al adaptador de Pexels (AC14, design.md D2)', () => {
  const repositoryFile = path.resolve(__dirname, '../plans.repository.ts');

  it('el archivo plans.repository.ts existe', () => {
    expect(fs.existsSync(repositoryFile)).toBe(true);
  });

  it('no contiene ninguna referencia a "pexels" (case-insensitive) en ningún lugar del archivo', () => {
    const content = fs.readFileSync(repositoryFile, 'utf-8');
    expect(content).not.toMatch(/pexels/i);
  });
});
