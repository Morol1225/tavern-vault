import { execFileSync } from 'node:child_process';

const allowed = new Set([
  '.gitignore', '.gitattributes', 'README.md', 'package.json', 'manifest.json', 'index.js', 'capability-contract.json',
  'src/core.js', 'src/storage.js', 'src/capture.js', 'src/host.js', 'src/ui.js', 'src/ui.css', 'src/entry.js', 'src/selection.js',
  'scripts/build.mjs', 'scripts/preview.mjs', 'scripts/check-publish.mjs',
  'tests/vault.test.mjs', 'tests/native-host.test.mjs', 'tests/selection.test.mjs', 'tests/memory-fs.mjs', 'tests/browser-check.mjs',
  'preview/index.html', 'preview/fixture.js', 'preview/native-fs.html',
  'docs/验证报告.md', 'docs/native-extension.md', 'docs/browser-evidence.json',
  'docs/screenshots/library-desktop.png', 'docs/screenshots/collector-desktop.png',
  'docs/screenshots/library-390.png', 'docs/screenshots/library-320.png',
  'docs/screenshots/editor-desktop.png', 'docs/screenshots/editor-320.png',
  'docs/screenshots/settings-entry.png',
]);
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, ...args], { encoding: 'utf8', maxBuffer: 4_000_000 });
const staged = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').split('\0').filter(Boolean);
const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
const errors = [];
for (const file of tracked) if (!allowed.has(file)) errors.push(`Outside publication allowlist: ${file}`);
for (const file of staged) {
  if (!allowed.has(file) || file.endsWith('.png')) continue;
  const value = git('show', `:${file}`);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)) errors.push(`Private key-shaped content: ${file}`);
  if (/\b[A-Za-z]:[\\/](?:Users|Deck|CodexData|chucangku|annoBOT)[\\/]/i.test(value)) errors.push(`Local absolute path: ${file}`);
  if (/\b(?:ghp_|github_pat_|sk-proj-)[a-zA-Z0-9_]{16,}/.test(value)) errors.push(`Credential-shaped content: ${file}`);
}
for (const privatePath of ['tavern-vault.json', 'items/', '.tools/', '.checks/']) {
  try { git('check-ignore', '-q', '--', privatePath); }
  catch { errors.push(`Private path must be ignored: ${privatePath}`); }
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Publication check passed: ${tracked.length} allowed tracked files, ${staged.length} staged changes; private data paths are excluded.`);
