import { build } from 'esbuild';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const output = process.env.ZERO_VAULT_EXTENSION_OUTPUT || path.join(root, 'build');
const apiUrl = process.env.ZERO_VAULT_EXTENSION_API_URL;
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
// OPAQUE's wasm-bindgen glue has a global-object fallback using Function().
// Extension CSP already forbids it; fail closed explicitly instead of shipping
// dynamic JS construction. Cryptography and the globalThis path are unchanged.
const noDynamicCode = {
  name: 'extension-csp',
  setup(builder) {
    builder.onLoad({ filter: /@serenity-kit[/\\]opaque[/\\]esm[/\\]index\.js$/ }, async args => {
      const source = await readFile(args.path, 'utf8');
      const expression = 'new Function(getStringFromWasm0(arg0, arg1))';
      if (source.split(expression).length !== 2) throw new Error('Review the OPAQUE global fallback before bundling');
      return { contents: source.replace(expression, '(() => { throw new Error("Dynamic JavaScript is disabled in extensions"); })()'), loader: 'js', resolveDir: path.dirname(args.path) };
    });
  }
};
if (process.argv[2] && process.argv[2] !== 'firefox') throw new Error('Supported build target: firefox');
for (const browser of process.argv[2] === 'firefox' ? ['firefox'] : ['chromium', 'firefox']) {
  const destination = path.join(output, browser); await mkdir(path.join(destination, 'dist'), { recursive: true });
  const config = structuredClone(manifest);
  if (apiUrl) config.host_permissions.push(new URL(apiUrl).origin + '/*');
  if (browser === 'firefox') {
    delete config.minimum_chrome_version;
    config.background = { scripts: ['dist/background.js'] };
    config.icons = { 16: 'icons/icon.svg', 32: 'icons/icon.svg', 48: 'icons/icon.svg', 96: 'icons/icon.svg' };
    config.action.default_icon = 'icons/icon.svg';
    config.browser_specific_settings = { gecko: { id: 'zero-vault@zero-vault.local', strict_min_version: '142.0', data_collection_permissions: { required: ['authenticationInfo', 'websiteActivity', 'websiteContent'], optional: [] } } };
  }
  const define = apiUrl ? { __ZERO_VAULT_API_URL__: JSON.stringify(apiUrl) } : {};
  await build({ absWorkingDir: root, entryPoints: ['src/background.ts'], bundle: true, outfile: path.join(destination, 'dist/background.js'), format: browser === 'chromium' ? 'esm' : 'iife', target: 'es2022', define, plugins: [noDynamicCode], logLevel: 'warning' });
  for (const entry of ['popup', 'save-prompt', 'content-script']) await build({ absWorkingDir: root, entryPoints: [`src/${entry}.ts`], bundle: true, outfile: path.join(destination, `dist/${entry}.js`), format: 'iife', target: 'es2022', define, logLevel: 'warning' });
  for (const file of ['popup.html', 'save-prompt.html', 'ui.css']) await copyFile(path.join(root, file), path.join(destination, file));
  await mkdir(path.join(destination, 'icons'), { recursive: true });
  for (const file of ['icon.svg', 'icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-128.png']) await copyFile(path.join(root, 'icons', file), path.join(destination, 'icons', file));
  await copyFile(path.join(root, '../../packages/crypto-core-wasm/pkg/crypto_core_bg.wasm'), path.join(destination, 'dist/crypto_core_bg.wasm'));
  await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(config, null, 2) + '\n');
}
