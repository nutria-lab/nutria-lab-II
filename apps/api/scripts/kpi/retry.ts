import { runKpiRetryCli } from '../../src/modules/kpi/cli/kpi-publisher-cli';

void runKpiRetryCli(process.argv.slice(2)).then(code => { process.exitCode = code; });
