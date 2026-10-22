import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allow = new Set(['/preview/index.html', '/preview/fixture.js', '/preview/native-fs.html', '/tests/memory-fs.mjs', '/dist/tavern-vault.js', '/src/core.js', '/src/storage.js']);
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const target = url.pathname === '/' ? '/preview/index.html' : url.pathname;
  if (!allow.has(target)) { response.writeHead(404); response.end('Not found'); return; }
  try {
    const data = await fs.readFile(path.join(root, target));
    response.writeHead(200, { 'Content-Type': target.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(data);
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(Number(process.env.TAVERN_VAULT_PREVIEW_PORT || 0), '127.0.0.1', () => {
  console.log(`PREVIEW_URL=http://127.0.0.1:${server.address().port}/preview/index.html`);
  console.log('Synthetic chat only. The preview folder is an in-memory filesystem; no real chats or disk folders are read.');
});
