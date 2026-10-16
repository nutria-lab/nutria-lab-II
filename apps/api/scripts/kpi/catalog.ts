import { runKpiCatalogCli } from '../../src/modules/kpi/cli/kpi-catalog-cli';

void runKpiCatalogCli(process.argv.slice(2)).then(code => { process.exitCode = code; });
