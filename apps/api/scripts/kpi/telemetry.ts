// NUT-85 — Entrypoint del CLI de telemetría KPI (design D22). Sin lógica: toda vive en src (typecheckeada).
// Uso: tsx scripts/kpi/telemetry.ts --mode sample|finalize --environment dev|qa|prod [--date YYYY-MM-DD] [--diagnostics-out DIR]
// Import relativo (sin alias de paths ni carga de archivos de entorno): toda la cadena del CLI usa imports relativos para que tsx la resuelva
// sin tsconfig paths. El entorno llega del proceso (workflow), nunca de un archivo .env.
import { createDefaultDeps, runTelemetryCli } from '../../src/modules/kpi/cli/telemetry-cli';

void runTelemetryCli(process.argv.slice(2), process.env, createDefaultDeps()).then(code => {
  process.exitCode = code;
});
