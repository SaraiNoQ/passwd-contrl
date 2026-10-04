import { spawn, type ChildProcess } from 'node:child_process';
// Use the standard WebDriver HTTP endpoints without adding a Selenium dependency.
export class FirefoxDriver {
  process: ChildProcess;
  session = '';
  readonly endpoint: string;
  constructor(binary: string, port = 4459) {
    this.endpoint = `http://127.0.0.1:${port}`;
    this.process = spawn(binary, ['--port', String(port), '--log', 'error', '--allow-system-access'], { stdio: 'ignore' });
  }
  async raw(path: string, body?: unknown, method = 'POST'): Promise<any> {
    const response = await fetch(this.endpoint + path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json() as { value: any };
    if (!response.ok || data.value?.error) throw new Error('Firefox WebDriver: ' + (data.value?.error ?? response.status));
    return data.value;
  }
  call(path: string, body?: unknown, method = 'POST') { return this.raw('/session/' + this.session + path, body, method); }
  async start() {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await this.raw('/status', undefined, 'GET'); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    const result = await this.raw('/session', { capabilities: { alwaysMatch: { acceptInsecureCerts: true, 'moz:firefoxOptions': { binary: process.env.ZERO_VAULT_FIREFOX_BINARY ?? '/Applications/Firefox.app/Contents/MacOS/firefox', args: ['-headless'], prefs: {
      'network.proxy.type': 0, 'network.dns.localDomains': 'vault-login.test',
      'extensions.webextensions.uuids': JSON.stringify({ 'zero-vault@zero-vault.local': 'cc37f5da-e152-433c-a57a-6699c26cd3d7' })
    } } } } });
    this.session = result.sessionId;
  }
  goto(url: string) { return this.call('/url', { url }); }
  script(script: string, args: unknown[] = []) { return this.call('/execute/sync', { script, args }); }
  async element(selector: string) { return (await this.call('/element', { using: 'css selector', value: selector }))['element-6066-11e4-a52e-4f735466cecf']; }
  async click(selector: string) { return this.call('/element/' + await this.element(selector) + '/click', {}); }
  async fill(selector: string, value: string) {
    const id = await this.element(selector); await this.call('/element/' + id + '/clear', {});
    await this.call('/element/' + id + '/value', { text: value });
  }
  async stop() { try { if (this.session) await this.call('', undefined, 'DELETE'); } finally { this.process.kill(); } }
}
