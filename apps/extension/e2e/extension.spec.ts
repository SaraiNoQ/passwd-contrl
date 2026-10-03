import { chromium, test, expect, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirefoxDriver } from './firefox-driver';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profileDirectories: string[] = [];
const output = path.join(root, 'build-test', process.env.TEST_WORKER_INDEX ?? '0');
let server: ReturnType<typeof createServer>;
let origin: string;
let certificateDirectory: string;
const accountPassword = 'SyntheticAccountPassword123!';
const localPassword = 'SyntheticPluginPassword123!';
const sitePassword = 'SyntheticSitePassword123!';
test.beforeAll(async () => {
  execFileSync(process.execPath, ['build.mjs'], { cwd: root, env: { ...process.env, ZERO_VAULT_EXTENSION_API_URL: 'http://localhost:8790', ZERO_VAULT_EXTENSION_OUTPUT: output }, stdio: 'pipe' });
  certificateDirectory = mkdtempSync(path.join(tmpdir(), 'zero-vault-extension-cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', path.join(certificateDirectory, 'key'), '-out', path.join(certificateDirectory, 'cert'), '-days', '1', '-nodes', '-subj', '/CN=vault-login.test'], { stdio: 'ignore' });
  server = createServer({ key: readFileSync(path.join(certificateDirectory, 'key')), cert: readFileSync(path.join(certificateDirectory, 'cert')) }, (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/welcome') { res.end('<h1>合成测试：已登录</h1>'); return; }
    const failed = req.url === '/failed';
    res.end('<!doctype html><html lang="zh-CN"><title>合成登录测试</title><h1>合成登录测试</h1><form action="/welcome" method="post"><label>用户名<input name="username" autocomplete="username"></label><label>密码<input type="password" name="password" autocomplete="current-password"></label><button type="submit">登录</button></form><p id="result"></p>' + (failed ? '<script>document.querySelector("form").onsubmit=e=>{e.preventDefault();document.getElementById("result").textContent="合成测试：登录失败"}</script>' : '') + '</html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'https://vault-login.test:' + (server.address() as { port: number }).port;
});
test.afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(certificateDirectory, { recursive: true, force: true });
  for (const directory of profileDirectories) rmSync(directory, { recursive: true, force: true });
});
async function launch(browserName: string) {
  const profile = mkdtempSync(path.join(tmpdir(), 'zero-vault-extension-profile-')); profileDirectories.push(profile);
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: browserName === 'edge' ? process.env.ZERO_VAULT_EDGE_BINARY! : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', '--ignore-certificate-errors', '--no-proxy-server', '--host-resolver-rules=MAP vault-login.test 127.0.0.1'],
    ignoreHTTPSErrors: true
  });
  const cdp = await context.browser()!.newBrowserCDPSession();
  const installed = await cdp.send('Extensions.loadUnpacked' as never, { path: path.join(output, 'chromium') } as never) as { id: string };
  return { context, id: installed.id };
}
async function registerWeb(page: Page, email: string) {
  await page.goto('http://localhost:3010');
  await page.locator('#master-password').fill('SyntheticWebPassword123!');
  await page.getByRole('button', { name: '开始生成' }).click();
  await expect(page.locator('.app-main')).toBeVisible();
  await page.getByRole('button', { name: /身份节点/ }).click();
  await page.getByPlaceholder('输入邮箱地址').fill(email);
  await page.getByPlaceholder('账户密码').fill(accountPassword);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  const recovery = page.getByRole('dialog', { name: '离线恢复记录' });
  await expect(recovery).toBeVisible();
  await recovery.getByLabel('我已将这份备用恢复码保存在安全的离线位置').check();
  await recovery.getByRole('button', { name: '完成' }).click();
  await expect(page.getByText(/已同步 · 版本/).first()).toBeVisible();
}
async function approve(page: Page) {
  await page.getByRole('button', { name: '设备同步', exact: true }).click();
  await page.locator('[aria-controls="trusted-device-network"]').click();
  await page.getByRole('button', { name: /批准加入同步 .*浏览器插件/ }).click();
  const dialog = page.getByRole('dialog', { name: '批准加入同步' });
  const completed = page.waitForResponse(response => response.url().includes('/approve') && response.status() === 200);
  await dialog.getByRole('button', { name: '确认', exact: true }).click(); await completed;
}
async function changeOnWeb(page: Page, password: string) {
  await page.getByRole('button', { name: /全部密码/ }).click();
  await page.getByRole('button', { name: '编辑 vault-login.test', exact: true }).click();
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  await dialog.locator('#credential-password').fill(password);
  const pushed = page.waitForResponse(response => response.url().includes('/vault/item-sync') && response.request().method() === 'POST' && response.status() === 200);
  await dialog.getByRole('button', { name: '保存修改' }).click(); await pushed;
}
test('independent device approval, site save/update, fill and Web synchronization', async ({}, info) => {
  test.skip(info.project.name === 'firefox');
  const { context, id } = await launch(info.project.name);
  try {
    const web = await context.newPage(); const email = 'extension-' + crypto.randomUUID() + '@example.com';
    await registerWeb(web, email);
    const popup = await context.newPage(); await popup.goto('chrome-extension://' + id + '/popup.html');
    await popup.getByLabel('账户邮箱').fill(email);
    await popup.getByLabel('账户密码', { exact: true }).fill(accountPassword);
    await popup.getByRole('button', { name: '连接账户', exact: true }).click();
    await expect(popup.getByText('批准此插件设备', { exact: true })).toBeVisible();
    await popup.getByLabel('插件本地主密码（至少 12 位）').fill(localPassword);
    await popup.getByLabel('再次输入本地主密码').fill(localPassword);
    await popup.getByRole('button', { name: '已批准，完成连接' }).click();
    await expect(popup.getByRole('status')).toContainText('批准此插件设备');
    await approve(web);
    await popup.getByLabel('插件本地主密码（至少 12 位）').fill(localPassword);
    await popup.getByLabel('再次输入本地主密码').fill(localPassword);
    await popup.getByRole('button', { name: '已批准，完成连接' }).click();
    await expect(popup.getByRole('button', { name: '锁定', exact: true })).toBeVisible();
    const errors: string[] = []; popup.on('pageerror', error => errors.push(error.message));
    const site = await context.newPage(); await site.goto(origin + '/login');
    await site.getByRole('textbox', { name: '用户名' }).fill('synthetic-user');
    await site.getByLabel('密码', { exact: true }).fill(sitePassword);
    await site.getByRole('button', { name: '登录' }).click();
    await expect(site.locator('iframe[data-zero-vault-prompt]')).toBeVisible();
    const prompt = site.frameLocator('iframe[data-zero-vault-prompt]');
    await expect(prompt.getByText('保存刚才使用的登录信息？')).toBeVisible();
    await expect(prompt.locator('#origin')).toHaveText(origin);
    await prompt.getByRole('button', { name: '保存', exact: true }).click();
    await expect(site.locator('iframe[data-zero-vault-prompt]')).toHaveCount(0);
    await web.getByRole('button', { name: '立即同步', exact: true }).first().click();
    await expect.poll(() => web.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('zero-vault.local.synced-timestamps.v1') ?? '{}')).length)).toBe(1);
    await changeOnWeb(web, sitePassword + '-from-web');
    await popup.evaluate(async () => { await chrome.runtime.sendMessage({ type: 'SYNC_NOW' }); });
    await site.goto(origin + '/login');
    await site.bringToFront();
    await popup.evaluate(async () => { const response = await chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' }); if (!response.credentials[0]) throw new Error('credential_missing'); await chrome.runtime.sendMessage({ type: 'FILL_MATCHED_CREDENTIAL', credentialId: response.credentials[0].id }); });
    await expect(site.getByLabel('密码', { exact: true })).toHaveValue(sitePassword + '-from-web');
    await expect(site.getByRole('textbox', { name: '用户名' })).toHaveValue('synthetic-user');
    await site.getByLabel('密码', { exact: true }).fill(sitePassword + '-changed');
    await site.getByRole('button', { name: '登录' }).click();
    await expect(site.locator('iframe[data-zero-vault-prompt]')).toBeVisible();
    await site.frameLocator('iframe[data-zero-vault-prompt]').getByRole('button', { name: '更新密码' }).click();
    await expect(site.locator('iframe[data-zero-vault-prompt]')).toHaveCount(0);
    await web.close();
    await popup.bringToFront(); await popup.getByRole('button', { name: '锁定', exact: true }).click();
    await expect(popup.getByLabel('插件本地主密码', { exact: true })).toBeVisible();
    await popup.getByLabel('插件本地主密码', { exact: true }).fill(localPassword);
    await popup.getByRole('button', { name: '解锁', exact: true }).click();
    await expect(popup.getByRole('button', { name: '锁定', exact: true })).toBeVisible();
    await site.goto(origin + '/failed');
    await site.getByRole('textbox', { name: '用户名' }).fill('synthetic-user');
    await site.getByLabel('密码', { exact: true }).fill('synthetic-wrong-password');
    await site.getByRole('button', { name: '登录' }).click();
    await expect(site.locator('#result')).toContainText('登录失败');
    await expect(site.locator('iframe[data-zero-vault-prompt]')).toHaveCount(0);
    await popup.bringToFront(); await popup.reload();
    await popup.locator('#generator').evaluate((element: HTMLDetailsElement) => { element.open = true; });
    await popup.locator('#length').fill('32'); await popup.locator('#length').dispatchEvent('change');
    await expect(popup.locator('#generated')).toHaveValue(/.{32}/);
    const worker = context.serviceWorkers().find(worker => worker.url().includes(id))!;
    expect(await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)))).not.toContain(sitePassword);
    await popup.locator('#generator').evaluate((element: HTMLDetailsElement) => { element.open = false; });
    const screenshots = path.join(root, 'artifacts'); mkdirSync(screenshots, { recursive: true });
    await popup.setViewportSize({ width: 360, height: 600 });
    await popup.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await popup.screenshot({ path: path.join(screenshots, info.project.name + '-popup.png') });
    await popup.setViewportSize({ width: 320, height: 600 });
    await popup.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await popup.screenshot({ path: path.join(screenshots, info.project.name + '-narrow.png') });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('Firefox independently connects, generates, saves, fills and synchronizes', async ({}, info) => {
  test.skip(info.project.name !== 'firefox');
  const trusted = await launch('chrome');
  const driver = new FirefoxDriver(process.env.ZERO_VAULT_GECKODRIVER!);
  const popupUrl = 'moz-extension://cc37f5da-e152-433c-a57a-6699c26cd3d7/popup.html';
  try {
    await driver.start();
    console.log('Firefox: isolated browser started');
    const temporary = mkdtempSync(path.join(tmpdir(), 'zero-vault-firefox-addon-')); profileDirectories.push(temporary);
    const archive = path.join(temporary, 'extension.xpi');
    execFileSync('zip', ['-qr', archive, '.'], { cwd: path.join(output, 'firefox') });
    await driver.call('/moz/addon/install', { path: archive, temporary: true });
    const web = await trusted.context.newPage(); const email = 'firefox-' + crypto.randomUUID() + '@example.com';
    await registerWeb(web, email);
    await driver.goto(popupUrl);
    await expect.poll(() => driver.script('return !!document.getElementById("email")')).toBe(true);
    await driver.fill('#email', email); await driver.fill('#account-password', accountPassword); await driver.click('#connect button');
    await expect.poll(() => driver.script('return document.getElementById("connection").textContent')).toContain('批准此插件设备');
    await approve(web);
    await driver.fill('#local-password', localPassword); await driver.fill('#confirm-password', localPassword);
    await driver.click('#connection form button');
    await expect.poll(() => driver.script('return document.getElementById("connection").textContent')).toContain('已解锁');
    console.log('Firefox: device approved and vault unlocked');
    await driver.goto(origin + '/login');
    await driver.fill('input[name=username]', 'synthetic-firefox-user'); await driver.fill('input[name=password]', sitePassword); await driver.click('button[type=submit]');
    await expect.poll(() => driver.script('return !!document.querySelector("iframe[data-zero-vault-prompt]")')).toBe(true);
    await driver.call('/frame', { id: await driver.call('/element', { using: 'css selector', value: 'iframe[data-zero-vault-prompt]' }) });
    await expect.poll(() => driver.script('return document.getElementById("save")?.textContent')).toBe('保存');
    await driver.click('#save'); await driver.call('/frame', { id: null });
    await expect.poll(() => driver.script('return !!document.querySelector("iframe[data-zero-vault-prompt]")')).toBe(false);
    console.log('Firefox: site login encrypted and saved');
    await web.getByRole('button', { name: '立即同步', exact: true }).first().click();
    await expect.poll(() => web.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('zero-vault.local.synced-timestamps.v1') ?? '{}')).length)).toBe(1);
    await changeOnWeb(web, sitePassword + '-from-web');
    console.log('Firefox: Web update synchronized');
    await web.close();
    await driver.goto(popupUrl); await expect.poll(() => driver.script('return document.getElementById("connection").textContent')).toContain('已解锁');
    await driver.call('/execute/async', { script: 'const done=arguments[arguments.length-1];browser.runtime.sendMessage({type:"SYNC_NOW"}).then(done);', args: [] });
    console.log('Firefox: extension pulled Web update');
    await driver.script('document.getElementById("generator").open=true;');
    await driver.fill('#length', '32'); await driver.click('#regenerate');
    expect(await driver.script('return document.getElementById("generated").value.length')).toBe(32);
    const popupHandle = await driver.call('/window', undefined, 'GET');
    const tab = await driver.call('/window/new', { type: 'tab' }); await driver.call('/window', { handle: tab.handle });
    await driver.goto(origin + '/login');
    const handles = await driver.call('/window/handles', undefined, 'GET');
    // Exercise the checked fill command from the trusted extension page.
    await driver.call('/window', { handle: tab.handle });
    await driver.call('/window', { handle: popupHandle });
    const result = await driver.call('/execute/async', { script: 'const done=arguments[arguments.length-1],origin=arguments[0];browser.tabs.query({}).then(async tabs=>{const tab=tabs.find(t=>t.url&&new URL(t.url).origin===origin);if(!tab){done({error:"site_missing"});return;}await browser.tabs.update(tab.id,{active:true});const state=await browser.runtime.sendMessage({type:"GET_POPUP_STATE"});const credential=state.credentials.find(item=>item.matchType==="exact");if(!credential){done({error:"credential_missing",origin:state.origin});return;}const response=await browser.runtime.sendMessage({type:"FILL_MATCHED_CREDENTIAL",credentialId:credential.id});done(response);}).catch(error=>done({error:error.name}));', args: [origin] });
    expect(result).toMatchObject({ ok: true });
    console.log('Firefox: exact-origin fill completed');
    await driver.call('/window', { handle: tab.handle }); expect(await driver.script('return document.querySelector("input[name=password]").value')).toBe(sitePassword + '-from-web');
    await driver.call('/window', { handle: popupHandle });
    expect(await driver.call('/execute/async', { script: 'const done=arguments[arguments.length-1];browser.storage.local.get(null).then(data=>done(JSON.stringify(data).includes(arguments[0])));', args: [sitePassword] })).toBe(false);
    await driver.script('document.getElementById("generator").open=false;');
    await driver.call('/window/rect', { width: 420, height: 750 });
    const screenshots = path.join(root, 'artifacts'); mkdirSync(screenshots, { recursive: true });
    const screenshot = await driver.call('/screenshot', undefined, 'GET');
    const { writeFileSync } = await import('node:fs'); writeFileSync(path.join(screenshots, 'firefox-popup.png'), Buffer.from(screenshot, 'base64'));
    expect(handles.length).toBeGreaterThan(0);
  } finally { await driver.stop(); await trusted.context.close(); }
});
