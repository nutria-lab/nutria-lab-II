// Uso: tsx scripts/kpi/telemetry.ts --mode sample|finalize --environment dev|qa|prod [--date YYYY-MM-DD] [--diagnostics-out DIR]
import { createDefaultDeps, runTelemetryCli } from '../../src/modules/kpi/cli/telemetry-cli';

void runTelemetryCli(process.argv.slice(2), process.env, createDefaultDeps()).then(code => {
  process.exitCode = code;
});
