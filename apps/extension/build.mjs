import { build } from 'esbuild';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const output = process.env.ZERO_VAULT_EXTENSION_OUTPUT || path.join(root, 'build');
const apiUrl = process.env.ZERO_VAULT_EXTENSION_API_URL;
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
for (const browser of ['chromium', 'firefox']) {
  const destination = path.join(output, browser); await mkdir(path.join(destination, 'dist'), { recursive: true });
  const config = structuredClone(manifest);
  if (apiUrl) config.host_permissions.push(new URL(apiUrl).origin + '/*');
  if (browser === 'firefox') {
    delete config.minimum_chrome_version;
    config.background = { scripts: ['dist/background.js'] };
    config.browser_specific_settings = { gecko: { id: 'zero-vault@zero-vault.local', strict_min_version: '128.0', data_collection_permissions: { required: ['authenticationInfo', 'websiteActivity', 'websiteContent'], optional: [] } } };
  }
  const define = apiUrl ? { __ZERO_VAULT_API_URL__: JSON.stringify(apiUrl) } : {};
  await build({ absWorkingDir: root, entryPoints: ['src/background.ts'], bundle: true, outfile: path.join(destination, 'dist/background.js'), format: browser === 'chromium' ? 'esm' : 'iife', target: 'es2022', define, logLevel: 'warning' });
  for (const entry of ['popup', 'save-prompt', 'content-script']) await build({ absWorkingDir: root, entryPoints: [`src/${entry}.ts`], bundle: true, outfile: path.join(destination, `dist/${entry}.js`), format: 'iife', target: 'es2022', define, logLevel: 'warning' });
  for (const file of ['popup.html', 'save-prompt.html', 'ui.css']) await copyFile(path.join(root, file), path.join(destination, file));
  await copyFile(path.join(root, '../../packages/crypto-core-wasm/pkg/crypto_core_bg.wasm'), path.join(destination, 'dist/crypto_core_bg.wasm'));
  await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(config, null, 2) + '\n');
}
