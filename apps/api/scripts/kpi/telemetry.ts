// Usage: tsx scripts/kpi/telemetry.ts --mode sample --environment dev|qa|prod [--diagnostics-out DIR]
import { createDefaultDeps, runTelemetryCli } from '../../src/modules/kpi/cli/telemetry-cli';

void runTelemetryCli(process.argv.slice(2), process.env, createDefaultDeps()).then(code => {
  process.exitCode = code;
});
