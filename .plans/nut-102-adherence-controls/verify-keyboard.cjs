const { chromium } = require('../../.nutria/runtime/qa/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const output = path.join(__dirname, 'evidence');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto('http://127.0.0.1:5173/adherence-preview.html');
    const demo = page.getByRole('region', { name: 'Probá el control' });
    const group = demo.getByRole('group');
    const complete = group.getByRole('button', { name: 'Completada', exact: true });
    const skipped = group.getByRole('button', { name: 'Omitida', exact: true });
    await complete.waitFor();
    await page.keyboard.press('Tab');
    assert.equal(await complete.evaluate((button) => button === document.activeElement), true);
    await page.keyboard.press('Enter');
    assert.equal(await complete.getAttribute('aria-disabled'), 'true');
    assert.match(await demo.getByRole('status').innerText(), /Guardando/);
    assert.equal(await complete.evaluate((button) => button === document.activeElement), true);
    const focus = await complete.evaluate((button) => ({
      visible: button.matches(':focus-visible'),
      outline: getComputedStyle(button).outlineStyle,
      width: getComputedStyle(button).outlineWidth,
    }));
    assert.equal(focus.visible, true);
    assert.notEqual(focus.outline, 'none');
    await page.screenshot({ path: path.join(output, 'keyboard-pending.png') });
    await skipped.focus();
    await skipped.press('Enter');
    await skipped.press('Space');
    // Resolve the fixture request without moving focus, like a server response.
    await complete.focus();
    await demo.getByRole('button', { name: 'Simular error', exact: true }).dispatchEvent('click');
    await demo.getByRole('alert').waitFor();
    assert.equal(await complete.evaluate((button) => button === document.activeElement), true);
    assert.equal(await group.getByRole('button', { name: 'Sin registrar', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: path.join(output, 'keyboard-error.png') });
    await complete.press('Enter');
    await skipped.focus();
    await skipped.press('Enter');
    await complete.focus();
    await demo.getByRole('button', { name: 'Simular éxito', exact: true }).dispatchEvent('click');
    await group.getByRole('button', { name: 'Completada', exact: true, pressed: true }).waitFor();
    assert.equal(await complete.evaluate((button) => button === document.activeElement), true);
    assert.equal(await demo.getByRole('alert').count(), 0);
    await page.screenshot({ path: path.join(output, 'keyboard-success.png') });
    const undo = group.getByRole('button', { name: 'Sin registrar', exact: true });
    await undo.focus();
    await undo.press('Space');
    await demo.getByRole('button', { name: 'Simular éxito', exact: true }).dispatchEvent('click');
    await group.getByRole('button', { name: 'Sin registrar', exact: true, pressed: true }).waitFor();
    const readOnly = page.getByRole('group').last();
    await readOnly.getByRole('button', { name: 'Completada', exact: true }).press('Enter');
    assert.equal(await readOnly.getByRole('button', { name: 'Sin registrar', exact: true }).getAttribute('aria-pressed'), 'true');
    fs.writeFileSync(path.join(output, 'control-accessibility.yml'), await demo.ariaSnapshot());
    await page.evaluate(() => { document.body.style.zoom = '2'; });
    const zoom = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth }));
    assert.ok(zoom.documentWidth <= zoom.viewport + 1);
    await page.screenshot({ path: path.join(output, 'zoom-200-percent.png'), fullPage: true });
    const result = { browser: browser.version(), keyboard: 'Tab, Enter, Space passed', pendingGuard: 'passed', errorRecovery: 'passed', undo: 'passed', readOnly: 'passed', focus, zoom: { method: 'CSS body zoom 2', ...zoom } };
    fs.writeFileSync(path.join(output, 'keyboard-checks.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
