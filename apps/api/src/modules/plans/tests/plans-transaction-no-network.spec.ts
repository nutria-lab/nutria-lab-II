import * as fs from 'fs';
import * as path from 'path';

// plans.repository.ts abre las transacciones, así que nunca puede usar el adaptador de imágenes.
// Revisar el texto del archivo detecta también cualquier import nuevo.
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
