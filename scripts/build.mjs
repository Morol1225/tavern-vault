import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { VERSION } from '../src/core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modules = ['core.js', 'storage.js', 'capture.js', 'selection.js', 'host.js', 'ui.js', 'entry.js'];
const sources = [];
const hashes = {};
for (const name of modules) {
  const text = await fs.readFile(path.join(root, 'src', name), 'utf8');
  hashes[`src/${name}`] = crypto.createHash('sha256').update(text).digest('hex');
  sources.push(`// src/${name}\n${text.replace(/^import .*?;\r?\n/gm, '').replace(/^export (?=(?:const|class|function|async function)\b)/gm, '')}`);
}
const css = await fs.readFile(path.join(root, 'src/ui.css'), 'utf8');
hashes['src/ui.css'] = crypto.createHash('sha256').update(css).digest('hex');
const extension = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(extension.version, VERSION);
assert.equal(pkg.version, VERSION);
const content = `/* 储藏库 v${VERSION} | SillyTavern 原生扩展 | 无远程代码依赖 */\n${sources.join('\n\n')}\nconfigureVault(${JSON.stringify(css)});\nexport { onActivate, onEnable, onDisable, onDelete };\n`;
await fs.writeFile(path.join(root, 'index.js'), content, 'utf8');
const check = spawnSync(process.execPath, ['--check', path.join(root, 'index.js')], { encoding: 'utf8', windowsHide: true });
if (check.status !== 0) throw new Error(check.stderr || 'Native module syntax check failed');
const out = path.join(root, 'dist');
await fs.mkdir(out, { recursive: true });
const build = { version: VERSION, deliveryMode: 'extension', kind: 'sillytavern-ui-extension', sources: hashes,
  artifacts: Object.fromEntries(await Promise.all(['index.js', 'manifest.json'].map(async name => [name, crypto.createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex')]))) };
await fs.writeFile(path.join(out, 'build-manifest.json'), `${JSON.stringify(build, null, 2)}\n`);
console.log(`Built v${VERSION}: ${Buffer.byteLength(content).toLocaleString()} bytes; native manifest + self-contained ES module.`);
