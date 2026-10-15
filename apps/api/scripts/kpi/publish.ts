import { runKpiPublishCli } from '../../src/modules/kpi/cli/kpi-publisher-cli';

void runKpiPublishCli(process.argv.slice(2)).then(code => { process.exitCode = code; });
