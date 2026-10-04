import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FirefoxDriver } from './firefox-driver';

test('Firefox toolbar popup keeps its intended width', async ({}, info) => {
  test.skip(info.project.name !== 'firefox');
  const temporary = mkdtempSync(path.join(tmpdir(), 'zero-vault-popup-'));
  const driver = new FirefoxDriver(process.env.ZERO_VAULT_GECKODRIVER!, 4460);
  try {
    execFileSync(process.execPath, ['build.mjs', 'firefox'], {
      env: { ...process.env, ZERO_VAULT_EXTENSION_OUTPUT: temporary }
    });
    const archive = path.join(temporary, 'popup.xpi');
    execFileSync('zip', ['-qr', archive, '.'], { cwd: path.join(temporary, 'firefox') });
    await driver.start();
    await driver.call('/moz/addon/install', { path: archive, temporary: true });
    await driver.call('/moz/context', { context: 'chrome' });
    await driver.script(`
      const {CustomizableUI} = ChromeUtils.importESModule('moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs');
      CustomizableUI.addWidgetToArea('zero-vault_zero-vault_local-browser-action', CustomizableUI.AREA_NAVBAR);
      document.getElementById('zero-vault_zero-vault_local-BAP').click();
    `);
    // A tab has a pre-existing viewport and cannot exercise Firefox's popup auto-sizing.
    await expect.poll(() => driver.script(`
      return document.querySelector('.webextension-popup-browser')?.getBoundingClientRect().width ?? 0;
    `)).toBe(360);
    const height = await driver.script(`return document.querySelector('.webextension-popup-browser').getBoundingClientRect().height;`);
    expect(height).toBeGreaterThan(100);
    expect(height).toBeLessThanOrEqual(600);
  } finally {
    await driver.stop();
    rmSync(temporary, { recursive: true, force: true });
  }
});
