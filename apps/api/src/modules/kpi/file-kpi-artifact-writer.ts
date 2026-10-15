import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const SAFE_ARTIFACT_NAMES = new Set(['payload.json', 'diagnostics.json']);

/** Filesystem boundary used by the CLI only; the publisher itself stays pure. */
export class FileKpiArtifactWriter {
  constructor(private readonly directory: string) {}

  async write(artifacts: Record<string, Buffer>): Promise<void> {
    const target = resolve(this.directory);
    await mkdir(target, { recursive: true });
    await Promise.all(Object.entries(artifacts).map(async ([name, contents]) => {
      if (!SAFE_ARTIFACT_NAMES.has(name)) throw new Error(`Unsupported KPI artifact: ${name}`);
      await writeFile(join(target, name), contents, { mode: 0o600 });
    }));
  }
}
