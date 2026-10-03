import * as fs from 'fs';
import * as path from 'path';

// AC14 (design.md D2): no method that opens a $transaction may invoke the image adapter,
// directly or indirectly. A plain-text grep over the whole file is a stronger guard than
// a behavioral mock — it can't miss a new import added anywhere in the file.
//
// This test is green today because plans.repository.ts doesn't reference the adapter at all
// yet; it stays as a permanent guard, not a check meant to flip green only after integration.
describe('plans.repository.ts no referencia al adaptador de Unsplash (AC14, design.md D2)', () => {
  const repositoryFile = path.resolve(__dirname, '../plans.repository.ts');

  it('el archivo plans.repository.ts existe', () => {
    expect(fs.existsSync(repositoryFile)).toBe(true);
  });

  it('no contiene ninguna referencia a "unsplash" (case-insensitive) en ningún lugar del archivo', () => {
    const content = fs.readFileSync(repositoryFile, 'utf-8');
    expect(content).not.toMatch(/unsplash/i);
  });
});
