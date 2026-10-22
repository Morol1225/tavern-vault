import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { VaultStorage } from '../src/storage.js';
import { captureFloor } from '../src/capture.js';
import { extractHtmlPages, digest, META_FILE, UNFILED } from '../src/core.js';
import { MemoryDirectory } from './memory-fs.mjs';

const source = () => ({ chatId: '雾港手记 - 重逢', chatName: '雾港手记 - 重逢', characterOrGroupId: 'char.png',
  characterOrGroupName: '旅人', messageId: 12, swipeId: 1, speakerName: '旅人', role: 'assistant',
  capturedAt: '2026-10-22T08:00:00.000Z', origin: 'http://localhost:8000' });
const draft = (text = '第一行\r\n\r\n```html\n<button onclick="this.textContent=\'已点亮\'">点灯</button>\n```\n{{char}} & <标题>') =>
  ({ source: source(), original: text, rendered: '<p>这是显示内容</p>', pages: [{ label: '页面 1', html: '<button>点灯</button>', kind: 'source' }], warnings: [] });
const options = { title: '重逢的片刻', categoryId: UNFILED };

async function setup() {
  const directory = new MemoryDirectory();
  const storage = new VaultStorage({});
  await storage.attach(directory);
  return { directory, storage };
}

test('原文逐字符保真，并能由全新实例从同一文件夹恢复来源、分类和页面', async () => {
  const { directory, storage } = await setup();
  const original = draft();
  const result = await storage.save(original, { ...options, newCategory: '剧情片段' });
  const reopened = new VaultStorage({});
  await reopened.attach(directory, false);
  assert.equal(reopened.entries.length, 1);
  const entry = reopened.entries[0];
  assert.equal(entry.original, original.original);
  assert.deepEqual(entry.source, original.source);
  assert.equal(entry.content.originalSha256, await digest(original.original));
  assert.equal(reopened.meta.categories.find(c => c.id === entry.categoryId).name, '剧情片段');
  assert.equal(await reopened.readPage(entry, 0), '<button>点灯</button>');
  assert.equal(await reopened.readPage(entry, -1), original.rendered);
  assert.equal(entry.id, result.entry.id);
});

test('相同快照不重复写入；不同聊天、楼层、版本或原文会创建独立记录', async () => {
  const { storage } = await setup();
  const a = await storage.save(draft(), options);
  const b = await storage.save(draft(), options);
  assert.equal(b.duplicate, true);
  assert.equal(b.entry.id, a.entry.id);
  for (const [key, value] of [['chatId', '另一段聊天'], ['messageId', 13], ['swipeId', 2], ['characterOrGroupId', 'other.png']]) {
    const input = draft(); input.source[key] = value;
    assert.equal((await storage.save(input, options)).duplicate, false);
  }
  await storage.save(draft('已修改的正文'), options);
  assert.equal(storage.entries.length, 6);
});

test('分类采用稳定编号，并复用重名分类；并发操作不会丢失分类', async () => {
  const { storage } = await setup();
  const [a, b] = await Promise.all([storage.addCategory('  HTML 页面  '), storage.addCategory('ＨＴＭＬ 页面')]);
  assert.equal(a, b);
  await Promise.all([storage.addCategory('剧情'), storage.addCategory('信件')]);
  assert.equal(storage.meta.categories.length, 4);
});

test('磁盘正文写入失败不出现完整记录，重试后可恢复', async () => {
  const { directory, storage } = await setup();
  directory.state.fail = '/original.txt';
  await assert.rejects(storage.save(draft(), options), error => error.name === 'QuotaExceededError');
  assert.equal(storage.entries.length, 0);
  directory.state.fail = '';
  await storage.load();
  assert.equal(storage.entries.length, 0);
  assert.equal(storage.issues.length, 1);
  await storage.save(draft(), options);
  assert.equal(storage.entries.length, 1);
});

test('提交标志写入失败不会误报收藏完成，已写内容仍在文件夹', async () => {
  const { directory, storage } = await setup();
  directory.state.fail = '/entry.json';
  await assert.rejects(storage.save(draft(), options));
  directory.state.fail = '';
  await storage.load();
  assert.equal(storage.entries.length, 0);
  assert.equal(storage.issues.length, 1);
  const items = await directory.getDirectoryHandle('items');
  const partial = [...items.children.values()][0];
  assert.equal((await partial.getFileHandle('original.txt')).value, draft().original);
});

test('权限被收回时阻止保存，不修改已有内容', async () => {
  const { directory, storage } = await setup();
  const writes = directory.state.writes;
  directory.state.permission = 'denied';
  await assert.rejects(storage.save(draft(), options), /重新授权/);
  assert.equal(directory.state.writes, writes);
});

test('未知或损坏的库标识不会被覆盖', async () => {
  const directory = new MemoryDirectory();
  const meta = await directory.getFileHandle(META_FILE, { create: true });
  meta.value = '{"product":"other-tool","schemaVersion":1}';
  const before = meta.value;
  await assert.rejects(new VaultStorage({}).attach(directory), /不是受支持/);
  assert.equal(meta.value, before);
  meta.value = '损坏的内容';
  await assert.rejects(new VaultStorage({}).attach(directory));
  assert.equal(meta.value, '损坏的内容');
});

test('没有库标识但存在 items 文件夹时保留未知文件并拒绝接管', async () => {
  const directory = new MemoryDirectory();
  const items = await directory.getDirectoryHandle('items', { create: true });
  const old = await items.getFileHandle('important.txt', { create: true }); old.value = '必须保留';
  await assert.rejects(new VaultStorage({}).attach(directory), /无法确认归属/);
  assert.equal(old.value, '必须保留');
  assert.equal(directory.children.has(META_FILE), false);
});

test('一条损坏记录不会阻止其他收藏恢复，非法路径不能被读取', async () => {
  const { directory, storage } = await setup();
  const good = await storage.save(draft('正常记录'), options);
  const bad = await storage.save(draft('之后被破坏的记录'), options);
  const items = await directory.getDirectoryHandle('items');
  const badDir = await items.getDirectoryHandle(bad.entry.id);
  const marker = await badDir.getFileHandle('entry.json');
  const json = JSON.parse(marker.value); json.content.pages[0].file = '../../tavern-vault.json'; marker.value = JSON.stringify(json);
  await storage.load();
  assert.equal(storage.entries.length, 1);
  assert.equal(storage.entries[0].id, good.entry.id);
  assert.equal(storage.issues.length, 1);
  await assert.rejects(storage.readPage(json, 0), /页面路径无效/);
});

test('原文文件被外部改变时明确跳过，不把改动后的正文当原始快照', async () => {
  const { directory, storage } = await setup();
  const saved = await storage.save(draft(), options);
  const item = await (await directory.getDirectoryHandle('items')).getDirectoryHandle(saved.entry.id);
  (await item.getFileHandle('original.txt')).value = '已被外部修改';
  await storage.load();
  assert.equal(storage.entries.length, 0);
  assert.match(storage.issues[0].message, /校验不一致/);
});

test('整理标题和分类不改变原文、聊天来源、收藏时间或未知字段', async () => {
  const { directory, storage } = await setup();
  const saved = await storage.save(draft(), options);
  const record = await (await (await directory.getDirectoryHandle('items')).getDirectoryHandle(saved.entry.id)).getFileHandle('entry.json');
  const before = JSON.parse(record.value); before.futureField = { keep: 7 }; record.value = JSON.stringify(before);
  await storage.edit(saved.entry.id, { title: '新的标题', newCategory: '新分类' });
  const after = JSON.parse(record.value);
  assert.deepEqual(after.source, before.source);
  assert.deepEqual(after.content, before.content);
  assert.equal(after.savedAt, before.savedAt);
  assert.deepEqual(after.futureField, { keep: 7 });
});

test('取消或连接无效新目录后，继续保留此前已连接的库', async () => {
  const { directory, storage } = await setup();
  await storage.save(draft(), options);
  const other = new MemoryDirectory('无效库');
  (await other.getFileHandle(META_FILE, { create: true })).value = '{}';
  await assert.rejects(storage.attach(other));
  assert.equal(storage.directory, directory);
  assert.equal(storage.entries.length, 1);
});

test('HTML 提取保留原脚本，支持多页面与 CRLF，不把其他语言代码当页面', () => {
  const text = '段落\r\n```html\r\n<button onclick="this.textContent=\'亮了\'">点灯</button>\r\n```\r\n\n~~~html\n<div>第二页</div>\n~~~\n\n```javascript\nconst a = "<div>不是页面</div>";\n```';
  const pages = extractHtmlPages(text);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].html, '<button onclick="this.textContent=\'亮了\'">点灯</button>');
  assert.equal(pages[1].html, '<div>第二页</div>');
  assert.equal(extractHtmlPages('<!doctype html><html><body>页面</body></html>').length, 1);
  assert.equal(extractHtmlPages('<html><body>第一页</body></html>\n<html><body>第二页</body></html>').length, 2);
});

test('收藏草稿读取当前消息版本，并在切换聊天后保留原来的来源', () => {
  const context = { chatId: '原聊天.jsonl', characterId: 0, characters: [{ avatar: 'old.png', name: '原角色' }], chat: [{}, {}] };
  const host = { window: { location: { origin: 'http://localhost:8000' } }, context: () => context,
    lastMessageId: () => 1, versions: { tavern: 'snapshot', helper: 'snapshot' },
    api: { getChatMessages: () => [{ message_id: 1, swipe_id: 1, swipes: ['旧页', '当前页'], name: '原角色', role: 'assistant' }] } };
  const frozen = captureFloor(host, 1);
  context.chatId = '新聊天'; context.characters[0].name = '新角色';
  assert.equal(frozen.original, '当前页');
  assert.equal(frozen.source.chatId, '原聊天.jsonl');
  assert.equal(frozen.source.chatName, '原聊天');
  assert.equal(frozen.source.characterOrGroupName, '原角色');
  assert.equal(frozen.source.swipeId, 1);
  assert.equal(frozen.source.messageId, 1);
});

test('收藏不会重新运行可能修改变量的宏和显示格式化接口', () => {
  const raw = '{{setvar::test::changed}}\n```html\n<div>{{char}}</div>\n```';
  const fail = () => { throw new Error('收藏不应调用变换接口'); };
  const host = { window: { location: { origin: 'http://localhost:8000' } }, context: () => ({ chatId: '原聊天', chat: [{}] }),
    versions: {}, lastMessageId: () => 0, api: { getChatMessages: () => [{ message_id: 0, swipe_id: 0, swipes: [raw], name: '测试', role: 'assistant' }],
      substitudeMacros: fail, formatAsDisplayedMessage: fail, formatAsTavernRegexedString: fail } };
  const result = captureFloor(host, 0);
  assert.equal(result.original, raw);
  assert.equal(result.pages[0].html, '<div>{{char}}</div>');
});

test('构建导出 JSON 与脚本逐字符一致，且无远程代码加载器', async () => {
  const json = JSON.parse(await fs.readFile(new URL('../dist/tavern-vault.json', import.meta.url), 'utf8'));
  const js = await fs.readFile(new URL('../dist/tavern-vault.js', import.meta.url), 'utf8');
  assert.equal(json.content, js);
  assert.equal(json.type, 'script'); assert.equal(json.enabled, true);
  assert.equal(json.button.buttons[0].name, '储藏库');
  assert.equal(json.export_with.data, false);
  new vm.Script(js);
  assert.doesNotMatch(js, /import\s*\(\s*['"]https?:|import\s+.*?from\s*['"]https?:|fetch\s*\(/);
});
