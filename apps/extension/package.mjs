import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const artifacts = path.join(root, 'artifacts'); await mkdir(artifacts, { recursive: true });
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const hashes = [];
if (process.argv[2] && process.argv[2] !== 'firefox') throw new Error('Supported package target: firefox');
const firefoxOnly = process.argv[2] === 'firefox';
for (const browser of firefoxOnly ? ['firefox'] : ['chromium', 'firefox']) {
  const directory = path.join(root, 'build', browser);
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.version !== version || manifest.host_permissions.length !== 1 || manifest.host_permissions[0] !== 'https://*/*') throw new Error('Refusing to package a test build or mismatched version.');
  const filename = firefoxOnly ? `zero-vault-firefox-${version}-unsigned.xpi` : `zero-vault-${browser}-${version}.zip`;
  await rm(path.join(artifacts, filename), { force: true });
  execFileSync('zip', ['-qr', path.join(artifacts, filename), 'manifest.json', 'popup.html', 'save-prompt.html', 'ui.css', 'dist', 'icons'], { cwd: directory });
  hashes.push(`${createHash('sha256').update(await readFile(path.join(artifacts, filename))).digest('hex')}  ${filename}`);
}
await writeFile(path.join(artifacts, firefoxOnly ? 'SHA256SUMS-firefox' : 'SHA256SUMS'), hashes.join('\n') + '\n');
