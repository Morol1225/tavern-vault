import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modules = ['core.js', 'storage.js', 'capture.js', 'host.js', 'ui.js', 'entry.js'];
const sources = [];
const hashes = {};
for (const name of modules) {
  const text = await fs.readFile(path.join(root, 'src', name), 'utf8');
  hashes[`src/${name}`] = crypto.createHash('sha256').update(text).digest('hex');
  sources.push(`// src/${name}\n${text.replace(/^import .*?;\r?\n/gm, '').replace(/^export (?=(?:const|class|function|async function)\b)/gm, '')}`);
}
const css = await fs.readFile(path.join(root, 'src/ui.css'), 'utf8');
hashes['src/ui.css'] = crypto.createHash('sha256').update(css).digest('hex');
const content = `/* 储藏库 v0.1.0 | 无远程代码依赖 | 在酒馆助手全局脚本库运行 */\n(() => {\n'use strict';\n${sources.join('\n\n')}\nstartVault(${JSON.stringify(css)});\n})();\n`;
new vm.Script(content, { filename: 'tavern-vault.js' });
const artifact = {
  type: 'script', enabled: true, name: '储藏库', id: '18794bb9-574e-4639-b43b-6f7b965db199', content,
  info: '储藏库 v0.1.0。请导入酒馆助手的全局脚本库。选择电脑文件夹保存聊天楼层、分类、原文及HTML页面，并保留聊天与楼层来源。需要电脑Chrome/Edge和安全环境；依赖酒馆的页面功能不一定能脱离原聊天运行。',
  button: { enabled: true, buttons: [{ name: '储藏库', visible: true }] },
  data: {}, export_with: { data: false, button: true },
};
const out = path.join(root, 'dist');
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, 'tavern-vault.js'), content, 'utf8');
await fs.writeFile(path.join(out, 'tavern-vault.json'), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
const manifest = { version: '0.1.0', deliveryMode: 'component', kind: 'helper-script', sources: hashes,
  artifacts: Object.fromEntries(await Promise.all(['tavern-vault.js', 'tavern-vault.json'].map(async name => [name, crypto.createHash('sha256').update(await fs.readFile(path.join(out, name))).digest('hex')]))) };
await fs.writeFile(path.join(out, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built v0.1.0: ${Buffer.byteLength(content).toLocaleString()} bytes of self-contained script; JSON content matches source bundle.`);
