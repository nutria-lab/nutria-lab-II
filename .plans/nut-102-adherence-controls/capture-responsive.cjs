// Run from the repository root after starting the Vite preview entry.
const { chromium } = require('../../.nutria/runtime/qa/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const output = path.join(__dirname, 'evidence');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = [];
  try {
    for (const [name, width, height] of [
      ['mobile', 390, 844],
      ['tablet', 768, 1024],
      ['desktop', 1440, 1000],
      ['narrow', 320, 844],
    ]) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('http://127.0.0.1:5173/adherence-preview.html');
      await page.getByRole('button', { name: 'Completada', exact: true }).first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => {
        const controls = Array.from(document.querySelectorAll('button[aria-pressed]'));
        return {
          viewport: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          controls: controls.length,
          clipped: controls.filter((button) => {
            const rect = button.getBoundingClientRect();
            return rect.left < 0 || rect.right > innerWidth + 1;
          }).length,
          smallTargets: controls.filter((button) => button.getBoundingClientRect().height < 44).length,
          pressed: controls.filter((button) => button.getAttribute('aria-pressed') === 'true').length,
          blocked: controls.filter((button) => button.getAttribute('aria-disabled') === 'true').length,
        };
      });
      await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
      results.push({ name, width, height, ...layout, errors });
      if (layout.documentWidth > width + 1 || layout.clipped || layout.smallTargets || errors.length) {
        throw new Error(`${name}: responsive or runtime checks failed: ${JSON.stringify(results.at(-1))}`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'responsive-checks.json'), JSON.stringify(results, null, 2));
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
