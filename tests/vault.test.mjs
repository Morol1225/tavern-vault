import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { VaultStorage } from '../src/storage.js';
import { captureFloor } from '../src/capture.js';
import { extractHtmlPages, digest, META_FILE, UNFILED, editToken, validateEntry, validateMeta, titleFileBase, compactSource, contentFileNames, textFilePath } from '../src/core.js';
import { MemoryDirectory } from './memory-fs.mjs';
const source = () => ({ chatId: '雾港手记 - 重逢', chatName: '雾港手记 - 重逢', characterOrGroupId: 'char.png',
  characterOrGroupName: '旅人', messageId: 12, swipeId: 1, speakerName: '旅人', role: 'assistant', capturedAt: '2026-10-22T08:00:00.000Z', origin: 'http://localhost:8000' });
const draft = (original = '第一行\r\n```html\n<button onclick="this.textContent=1">点灯</button>\n```') => ({ source: source(), original,
  rendered: 'UNNEEDED_RENDERED_COPY', pages: [{ html: 'UNNEEDED_PAGE_COPY', label: '旧显示副本' }], warnings: [] });
const options = { title: '重逢的片刻', categoryId: UNFILED };
async function setup() { const directory = new MemoryDirectory(); const storage = new VaultStorage({}); await storage.attach(directory); return { directory, storage }; }
const confirmation = (storage, entry) => ({ confirmed: true, expectedToken: editToken(entry), expectedLibraryId: storage.meta.libraryId });
async function filesIn(directory, prefix = '') {
  const result = {};
  for await (const handle of directory.values()) {
    if (handle.kind === 'file') result[`${prefix}/${handle.name}`] = await (await handle.getFile()).text();
    else Object.assign(result, await filesIn(handle, `${prefix}/${handle.name}`));
  }
  return result;
}
async function rootRecord(directory) { return JSON.parse((await directory.getFileHandle(META_FILE)).value); }

 test('一条收藏只在 items/分类名 内生成一个标题 TXT，分类与三个来源字段集中存入根配置', async () => {
  const { directory, storage } = await setup(); const input = draft();
  const { entry } = await storage.save(input, { ...options, newCategory: '剧情' });
  assert.deepEqual(Object.keys(await filesIn(directory)).sort(), ['/items/剧情/重逢的片刻.txt', '/tavern-vault.json']);
  assert.equal((await filesIn(directory))['/items/剧情/重逢的片刻.txt'], input.original);
  const meta = await rootRecord(directory);
  assert.equal(meta.schemaVersion, 3); assert.equal(meta.entries[0].schemaVersion, 5);
  assert.deepEqual(meta.entries[0].source, { chatId: source().chatId, characterName: '旅人', messageId: 12 });
  assert.deepEqual(entry.source, compactSource(input.source));
  assert.equal(entry.savedAt, meta.entries[0].savedAt);
  assert.doesNotMatch(JSON.stringify(meta), /UNNEEDED_|onclick|第一行|original"|renderedFile|storageId|swipeId|capturedAt|origin"/);
});

test('新实例逐字恢复 CRLF、分类与 HTML 交互源码，多页预览全部由 TXT 生成', async () => {
  const { directory, storage } = await setup();
  const text = draft().original + '\n```html\n<div>第二页</div>\n```';
  const saved = await storage.save(draft(text), { ...options, newCategory: 'HTML' });
  const reopened = new VaultStorage({}); await reopened.attach(directory, false); const entry = reopened.entries[0];
  assert.equal(entry.id, saved.entry.id); assert.equal(entry.original, text); assert.equal(entry.content.pages.length, 2);
  assert.match(await reopened.readPage(entry, 0), /onclick="this.textContent=1"/);
  assert.equal(await reopened.readPage(entry, 1), '<div>第二页</div>');
  assert.match(await reopened.readPage(entry, -1), /&lt;button/);
  assert.equal(reopened.meta.categories.find(item => item.id === entry.categoryId).name, 'HTML');
});

test('相同聊天角色楼层与正文去重，不同聊天、角色、楼层或正文独立保存', async () => {
  const { storage } = await setup(); const a = await storage.save(draft(), options);
  assert.equal((await storage.save(draft(), { ...options, title: '重复' })).entry.id, a.entry.id);
  for (const [key, value] of [['chatId', '另一聊天'], ['characterOrGroupName', '另一角色'], ['messageId', 13]]) {
    const input = draft(); input.source[key] = value; assert.equal((await storage.save(input, options)).duplicate, false);
  }
  await storage.save(draft('不同正文'), options); assert.equal(storage.entries.length, 5);
});

test('分类复用规范化重名，并发新增分类不会丢失', async () => {
  const { storage } = await setup(); const [a, b] = await Promise.all([storage.addCategory(' HTML '), storage.addCategory('ＨＴＭＬ')]);
  assert.equal(a, b); await Promise.all([storage.addCategory('剧情'), storage.addCategory('信件')]); assert.equal(storage.meta.categories.length, 4);
});

test('同名及处理后相同名称使用编号 TXT，已有未知文件与大小写相似文件不被覆盖', async () => {
  const { directory, storage } = await setup(); const items = await (await directory.getDirectoryHandle('items')).getDirectoryHandle('未分类');
  (await items.getFileHandle('重逢的片刻.txt', { create: true })).value = '用户自己的文件';
  const a = await storage.save(draft('a'), options); const b = await storage.save(draft('b'), options);
  assert.equal(a.entry.content.originalFile, '重逢的片刻 (2).txt'); assert.equal(b.entry.content.originalFile, '重逢的片刻 (3).txt');
  assert.equal(storage.previewFileName(a.entry.title, a.entry.id), '重逢的片刻 (2).txt');
  for (const [title, expected] of [['Story', 'Story.txt'], ['story', 'story (2).txt'], ['故事/雪', '故事_雪.txt'], ['故事\\雪', '故事_雪 (2).txt']]) {
    const result = await storage.save(draft(title), { ...options, title }); assert.equal(result.entry.content.originalFile, expected);
  }
  assert.equal((await items.getFileHandle('重逢的片刻.txt')).value, '用户自己的文件');
});

test('权限撤回、未知库和损坏库均不会写入或覆盖', async () => {
  const { directory, storage } = await setup(); const before = await filesIn(directory); directory.state.permission = 'denied';
  await assert.rejects(storage.save(draft(), options), /重新授权/); directory.state.permission = 'granted'; assert.deepEqual(await filesIn(directory), before);
  const other = new MemoryDirectory(); (await other.getFileHandle(META_FILE, { create: true })).value = '{"product":"other"}';
  await assert.rejects(storage.attach(other), /不是受支持/); assert.equal(storage.directory, directory);
  (await other.getFileHandle(META_FILE)).value = '{'; await assert.rejects(storage.attach(other)); assert.equal(storage.directory, directory);
});

test('丢失文件和待删除记录仍保留文件名，避免新收藏误用尚未清理的引用', async () => {
  for (const pendingDelete of [false, true]) {
    const { directory, storage } = await setup(); const { entry } = await storage.save(draft('原记录'), options);
    await (await (await directory.getDirectoryHandle('items')).getDirectoryHandle(entry.content.folder)).removeEntry(entry.content.originalFile);
    if (pendingDelete) {
      const meta = await rootRecord(directory); meta.entries = []; meta.deleted = [{ entry: { ...entry, original: undefined }, deletedAt: new Date().toISOString() }];
      (await directory.getFileHandle(META_FILE)).value = JSON.stringify(meta);
    }
    await storage.load();
    const next = await storage.save(draft('新记录'), options); assert.equal(next.entry.content.originalFile, '重逢的片刻 (2).txt');
    if (pendingDelete) assert.equal(await storage.retryDeletions(), 0);
    assert.equal((await filesIn(directory))['/items/未分类/重逢的片刻 (2).txt'], '新记录');
  }
});

test('没有库配置但已有 items 时不接管陌生文件夹', async () => {
  const directory = new MemoryDirectory(); const items = await directory.getDirectoryHandle('items', { create: true });
  (await items.getFileHandle('重要.txt', { create: true })).value = '保留';
  await assert.rejects(new VaultStorage({}).attach(directory), /无法确认归属/); assert.equal(directory.children.has(META_FILE), false);
});

test('新建 TXT 或根索引写入失败时不登记成功，不残留本次创建的 TXT', async () => {
  for (const suffix of ['/重逢的片刻.txt', '/tavern-vault.json']) {
    const { directory, storage } = await setup(); const before = await filesIn(directory); directory.state.fail = suffix;
    await assert.rejects(storage.save(draft(), options)); directory.state.fail = ''; assert.deepEqual(await filesIn(directory), before);
    await storage.load(); assert.equal(storage.entries.length, 0); await storage.save(draft(), options); assert.equal(storage.entries.length, 1);
  }
});

test('未确认、空草稿和未修改内容不写盘', async () => {
  const { directory, storage } = await setup(); const { entry } = await storage.save(draft(), options); const before = await filesIn(directory); const writes = directory.state.writes;
  await assert.rejects(storage.updateContent(entry.id, '草稿', { ...confirmation(storage, entry), confirmed: false }), /尚未确认/);
  await assert.rejects(storage.updateContent(entry.id, ' ', confirmation(storage, entry)), /不能为空/);
  assert.equal((await storage.updateContent(entry.id, entry.original, confirmation(storage, entry))).unchanged, true);
  assert.equal(directory.state.writes, writes); assert.deepEqual(await filesIn(directory), before);
});

test('确认修改在同一个标题 TXT 中替换内容，页面重新生成，不创建旧版与附属文件', async () => {
  const { directory, storage } = await setup(); const { entry } = await storage.save(draft('OLD_BODY_MARKER'), options);
  const text = '<div><button onclick="this.textContent=1">新正文</button></div>';
  const result = await storage.updateContent(entry.id, text, confirmation(storage, entry));
  assert.deepEqual(result.entry.source, entry.source); assert.equal(result.entry.savedAt, entry.savedAt); assert(result.entry.editedAt);
  assert.equal(result.entry.content.originalFile, entry.content.originalFile); assert.equal(result.cleanupPending, false);
  const all = await filesIn(directory); assert.equal(Object.keys(all).length, 2); assert.equal(all['/items/未分类/重逢的片刻.txt'], text);
  assert(!Object.values(all).some(value => value.includes('OLD_BODY_MARKER')));
  const reopened = new VaultStorage({}); await reopened.attach(directory, false); assert.match(await reopened.readPage(reopened.entries[0], 0), /新正文/);
});

test('正文写入失败保留原文件，索引更新失败时明确说明已写入 TXT，重读后可补全记录', async () => {
  const { directory, storage } = await setup(); const { entry } = await storage.save(draft('旧正文'), options);
  directory.state.fail = '/重逢的片刻.txt'; await assert.rejects(storage.updateContent(entry.id, '新正文', confirmation(storage, entry)), error => error.name === 'QuotaExceededError');
  directory.state.fail = ''; await storage.load(); assert.equal(storage.entries[0].original, '旧正文');
  directory.state.fail = '/tavern-vault.json'; await assert.rejects(storage.updateContent(entry.id, '新正文', confirmation(storage, storage.entries[0])), /正文已写入 TXT/);
  directory.state.fail = ''; await storage.load(); assert.equal(storage.entries[0].original, '新正文');
  await storage.updateContent(entry.id, '新正文', confirmation(storage, storage.entries[0]));
  assert.equal((await rootRecord(directory)).entries[0].content.originalSha256, await digest('新正文'));
});

test('整理新标题只改一个 TXT 的名称，保留正文、角色来源和收藏时间，重名自动编号', async () => {
  const { directory, storage } = await setup(); const { entry } = await storage.save(draft(), options);
  const items = await (await directory.getDirectoryHandle('items')).getDirectoryHandle('未分类'); (await items.getFileHandle('新标题.txt', { create: true })).value = '未知文件';
  const next = await storage.edit(entry.id, { ...options, title: '新标题', ...confirmation(storage, entry) });
  assert.equal(next.content.originalFile, '新标题 (2).txt'); assert.deepEqual(next.source, entry.source); assert.equal(next.savedAt, entry.savedAt); assert.equal(next.editedAt, undefined);
  const all = await filesIn(directory); assert.equal(all['/items/未分类/新标题 (2).txt'], entry.original); assert.equal(all['/items/未分类/重逢的片刻.txt'], undefined); assert.equal(all['/items/未分类/新标题.txt'], '未知文件');
});

test('改名写入或根索引失败时原名称仍可恢复，清理失败可以重载后重试', async () => {
  for (const suffix of ['/新标题.txt', '/tavern-vault.json']) {
    const { directory, storage } = await setup(); const { entry } = await storage.save(draft(), options); const before = await filesIn(directory); directory.state.fail = suffix;
    await assert.rejects(storage.edit(entry.id, { ...options, title: '新标题' })); directory.state.fail = ''; assert.deepEqual(await filesIn(directory), before);
  }
  const { directory, storage } = await setup(); const { entry } = await storage.save(draft(), options); directory.state.failRemove = '/重逢的片刻.txt';
  const next = await storage.edit(entry.id, { ...options, title: '新标题' }); assert(next.cleanup);
  const reopened = new VaultStorage({}); await reopened.attach(directory, false); assert.equal(reopened.entries[0].title, '新标题');
  directory.state.failRemove = ''; await reopened.cleanupContent(entry.id); assert.equal(reopened.entries[0].cleanup, undefined);
  assert.equal((await filesIn(directory))['/items/未分类/重逢的片刻.txt'], undefined);
});

test('外部改写 TXT 会被读取，过期编辑、整理或删除及换库操作均拒绝覆盖', async () => {
  const { directory, storage } = await setup(); const { entry } = await storage.save(draft('原文'), options); const stale = confirmation(storage, entry);
  (await (await (await directory.getDirectoryHandle('items')).getDirectoryHandle(entry.content.folder)).getFileHandle(entry.content.originalFile)).value = '<button>外部修改</button>';
  const writes = directory.state.writes;
  await assert.rejects(storage.updateContent(entry.id, '过期草稿', stale), /别处修改/);
  await assert.rejects(storage.edit(entry.id, { ...options, title: '过期整理', ...stale }), /别处修改/);
  await assert.rejects(storage.delete(entry.id, stale), /别处修改/);
  await assert.rejects(storage.delete(entry.id, { ...stale, expectedLibraryId: 'other' }), /更换了收藏库/);
  assert.equal(directory.state.writes, writes); await storage.load(); assert.equal(storage.entries[0].original, '<button>外部修改</button>');
  assert.equal(storage.entries[0].content.pages.length, 1);
});

test('删除必须确认，确认后移除该 TXT 与记录，其他收藏和分类保留', async () => {
  const { directory, storage } = await setup(); const a = (await storage.save(draft('删除'), options)).entry; const b = (await storage.save(draft('保留'), options)).entry;
  const before = await filesIn(directory); await assert.rejects(storage.delete(a.id, { ...confirmation(storage, a), confirmed: false }), /尚未确认/); assert.deepEqual(await filesIn(directory), before);
  assert.equal((await storage.delete(a.id, confirmation(storage, a))).cleanupPending, false);
  const reopened = new VaultStorage({}); await reopened.attach(directory, false); assert.equal(reopened.entries.length, 1); assert.equal(reopened.entries[0].id, b.id);
  const all = await filesIn(directory); assert.equal(all[`/items/${textFilePath(a)}`], undefined); assert.equal(all[`/items/${textFilePath(b)}`], '保留');
  assert.equal((await rootRecord(directory)).deleted.length, 0);
});

test('删除索引写入失败不删 TXT，删除文件失败可重载后明确重试清理', async () => {
  const { directory, storage } = await setup(); const { entry } = await storage.save(draft(), options); const before = await filesIn(directory);
  directory.state.fail = '/tavern-vault.json'; await assert.rejects(storage.delete(entry.id, confirmation(storage, entry))); directory.state.fail = ''; assert.deepEqual(await filesIn(directory), before);
  directory.state.failRemove = '/重逢的片刻.txt'; assert.equal((await storage.delete(entry.id, confirmation(storage, entry))).cleanupPending, true);
  const reopened = new VaultStorage({}); await reopened.attach(directory, false); assert.equal(reopened.entries.length, 0); assert.equal(reopened.pendingDeleteCount, 1);
  directory.state.failRemove = ''; assert.equal(await reopened.retryDeletions(), 0); assert.equal((await filesIn(directory))['/items/未分类/重逢的片刻.txt'], undefined);
});

test('索引拒绝越界路径及重复 TXT 引用，损坏配置不会被保存覆盖', async () => {
  const { directory, storage } = await setup(); const { entry } = await storage.save(draft(), options);
  assert.throws(() => validateEntry({ ...entry, content: { ...entry.content, originalFile: '../private.txt' } }, entry.id), /TXT/);
  assert.throws(() => validateEntry({ ...entry, cleanup: { files: [{ name: '../private.txt', sha256: 'a'.repeat(64) }] } }, entry.id), /清理/);
  const meta = await rootRecord(directory); assert.throws(() => validateMeta({ ...meta, entries: [...meta.entries, { ...meta.entries[0], id: 'other' }] }), /重复/);
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
    readMessage: () => ({ message_id: 1, swipe_id: 1, message: '当前页', name: '原角色', role: 'assistant' }) };
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
    versions: {}, lastMessageId: () => 0, readMessage: () => ({ message_id: 0, swipe_id: 0, message: raw, name: '测试', role: 'assistant' }), api: {
      substitudeMacros: fail, formatAsDisplayedMessage: fail, formatAsTavernRegexedString: fail } };
  const result = captureFloor(host, 0);
  assert.equal(result.original, raw);
  assert.equal(result.pages[0].html, '<div>{{char}}</div>');
});

test('原生扩展入口与构建摘要一致，无助手启动依赖或远程代码加载器', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const js = await fs.readFile(new URL('../index.js', import.meta.url), 'utf8');
  const build = JSON.parse(await fs.readFile(new URL('../dist/build-manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.js, 'index.js');
  assert.equal(manifest.version, build.version);
  assert.equal(await digest(js), build.artifacts['index.js']);
  for (const [name, hash] of Object.entries(build.sources)) assert.equal(await digest(await fs.readFile(new URL(`../${name}`, import.meta.url), 'utf8')), hash);
  const entry = await import('../index.js');
  for (const name of Object.values(manifest.hooks)) assert.equal(typeof entry[name], 'function');
  assert.doesNotMatch(js, /import\s*\(\s*['"]https?:|import\s+.*?from\s*['"]https?:|fetch\s*\(/);
  assert.doesNotMatch(js, /getChatMessages|retrieveDisplayedMessage|appendInexistentScriptButtons|scriptWindow\.parent/);
});

test('文件名保留中文和表情，处理特殊字符、尾部句点、系统保留名与空名称', () => {
  const cases = [
    ['雪夜里的重逢 🌙', '雪夜里的重逢 🌙'],
    ['  问：为什么？ / <回家>\\"灯"|*  ', '问：为什么？ _ _回家___灯___'],
    ['a\nb\t\u0000c', 'a_b__c'], ['回家...  ', '回家'], ['...', '未命名收藏'],
    ['CON', '_CON'], ['nul.txt', '_nul.txt'], ['COM¹', '_COM¹'], ['LPT9.log', '_LPT9.log'], ['CON .txt', '_CON .txt'],
    ['CONductor', 'CONductor'], ['e\u0301', 'é'], ['\ud800断开的字符', '_断开的字符'],
  ];
  for (const [title, expected] of cases) {
    assert.equal(titleFileBase(title), expected, title);
    assert.equal(titleFileBase(expected), expected);
  }
  for (const title of ['长'.repeat(160), 'A'.repeat(160), '🌙'.repeat(80)]) {
    const name = titleFileBase(title);
    assert(name.endsWith('…'));
    assert(name.length <= 120 && new TextEncoder().encode(name).length <= 180);
    assert.doesNotMatch(name, /[\ud800-\udfff]/u);
    assert.equal(titleFileBase(name), name);
  }
});

async function legacyFixture(directory, schemaVersion, pendingCleanup = false) {
  const id = `legacy-${schemaVersion}`;
  const item = await (await directory.getDirectoryHandle('items')).getDirectoryHandle(id, { create: true });
  const original = `LEGACY_BODY_MARKER_${schemaVersion}`;
  const rendered = '<section>LEGACY_SNAPSHOT_MARKER<button onclick="this.textContent=1">旧按钮</button></section>';
  const pages = ['<button>LEGACY_PAGE_MARKER_1</button>', '<div>LEGACY_PAGE_MARKER_2</div>'];
  const record = { schemaVersion, id, title: '以前的收藏', categoryId: UNFILED,
    savedAt: '2026-10-22T08:00:00.000Z', updatedAt: '2026-10-22T08:00:00.000Z', source: source(),
    futureField: { keep: true }, content: { originalFile: 'original.txt', renderedFile: 'rendered.html',
      originalSha256: await digest(original), pages: pages.map((_, index) => ({ file: `pages/page-${index + 1}.html`, label: `旧页面 ${index + 1}` })), warnings: ['旧说明'] } };
  if (schemaVersion === 3) {
    record.content.fileBase = titleFileBase(record.title);
    const names = contentFileNames(record.content.fileBase, pages.length);
    record.content.originalFile = names.originalFile; record.content.renderedFile = names.renderedFile;
    record.content.pages.forEach((page, index) => { page.file = names.pageFiles[index]; });
  }
  const write = async (dir, name, text) => { (await dir.getFileHandle(name, { create: true })).value = text; };
  let active = item;
  if (schemaVersion === 2 || schemaVersion === 3 && pendingCleanup) {
    record.content.storageId = 'old-content';
    active = await (await item.getDirectoryHandle('content', { create: true })).getDirectoryHandle('old-content', { create: true });
    await write(active, '.owned.json', JSON.stringify({ product: 'tavern-vault', entryId: id, storageId: 'old-content' }));
  }
  for (const target of pendingCleanup ? [item, active] : [active]) {
    await write(target, record.content.originalFile, original);
    await write(target, record.content.renderedFile, rendered);
    const pageDirectory = await target.getDirectoryHandle('pages', { create: true });
    for (const [index, text] of pages.entries()) await write(pageDirectory, record.content.pages[index].file.slice(6), text);
  }
  if (pendingCleanup) record.cleanup = { legacyPageCount: pages.length, ...(schemaVersion === 3 ? { legacyFileBase: record.content.fileBase } : {}) };
  await write(item, 'entry.json', JSON.stringify(record));
  return { record, original, rendered, pages, item };
}


test('兼容读取旧库格式，刷新不迁移，确认整理后按分类保存标题 TXT', async () => {
  for (const version of [1, 2, 3]) {
    const { directory, storage } = await setup(); const fixture = await legacyFixture(directory, version, version === 2);
    const marker = await directory.getFileHandle(META_FILE); const meta = JSON.parse(marker.value); delete meta.entries; delete meta.deleted; meta.schemaVersion = 1; meta.categories = meta.categories.map(({ folder, ...category }) => category);
    await (await directory.getDirectoryHandle('items')).removeEntry('未分类'); marker.value = JSON.stringify(meta);
    const before = await filesIn(directory); await storage.load(); assert.equal(storage.legacyCount, 1); assert.deepEqual(await filesIn(directory), before);
    assert.equal(await storage.readPage(storage.entries[0], 1), fixture.pages[1]);
    await assert.rejects(storage.migrate({ confirmed: false }), /尚未确认/); assert.deepEqual(await filesIn(directory), before);
    const result = await storage.migrate({ confirmed: true, expectedLibraryId: storage.meta.libraryId }); assert.equal(result.converted, 1); assert.equal(result.cleanupPending, 0);
    assert.equal(storage.entries[0].original, fixture.original); assert.deepEqual(storage.entries[0].source, compactSource(fixture.record.source));
    assert.equal(storage.entries[0].savedAt, fixture.record.savedAt); assert.equal(storage.legacyCount, 0);
    assert.deepEqual(Object.keys(await filesIn(directory)).sort(), ['/items/未分类/以前的收藏.txt', '/tavern-vault.json']);
    const reopened = new VaultStorage({}); await reopened.attach(directory, false); assert.equal(reopened.entries[0].original, fixture.original);
  }
});

test('旧库迁移 TXT 或索引失败时原目录不丢失，之后重试可完成', async () => {
  for (const suffix of ['/以前的收藏.txt', '/tavern-vault.json']) {
    const { directory, storage } = await setup(); await legacyFixture(directory, 1); await storage.load(); const before = await filesIn(directory);
    directory.state.fail = suffix; await assert.rejects(storage.migrate({ confirmed: true, expectedLibraryId: storage.meta.libraryId })); directory.state.fail = ''; assert.deepEqual(await filesIn(directory), before);
    assert.equal((await storage.migrate({ confirmed: true, expectedLibraryId: storage.meta.libraryId })).cleanupPending, 0);
  }
});

test('旧目录中的未知文件保留，转换后的收藏可读，明确检查后能重试清理', async () => {
  const { directory, storage } = await setup(); const fixture = await legacyFixture(directory, 1);
  (await fixture.item.getFileHandle('important.dat', { create: true })).value = '用户额外放入的文件'; await storage.load();
  const result = await storage.migrate({ confirmed: true, expectedLibraryId: storage.meta.libraryId }); assert.equal(result.cleanupPending, 1);
  assert.equal((await fixture.item.getFileHandle('important.dat')).value, '用户额外放入的文件');
  const reopened = new VaultStorage({}); await reopened.attach(directory, false); assert.equal(reopened.entries.length, 1); assert.equal(reopened.entries[0].schemaVersion, 5);
  await fixture.item.removeEntry('important.dat'); await reopened.cleanupContent(fixture.record.id); assert.equal(reopened.entries[0].cleanup, undefined);
});

test('未迁移的旧收藏也可以确认删除，成功后没有 TXT 副本或旧目录', async () => {
  for (const version of [1, 2, 3]) {
    const { directory, storage } = await setup(); await legacyFixture(directory, version); await storage.load();
    assert.equal((await storage.delete(storage.entries[0].id, confirmation(storage, storage.entries[0]))).cleanupPending, false);
    assert.deepEqual(Object.keys(await filesIn(directory)), ['/tavern-vault.json']);
  }
});

test('格式 3 已编辑内容集和待清理根副本也能合并为一个 TXT', async () => {
  const { directory, storage } = await setup(); const fixture = await legacyFixture(directory, 3, true);
  await storage.load(); const result = await storage.migrate({ confirmed: true, expectedLibraryId: storage.meta.libraryId });
  assert.equal(result.cleanupPending, 0); assert.equal(storage.entries[0].original, fixture.original);
  assert.deepEqual(Object.keys(await filesIn(directory)).sort(), ['/items/未分类/以前的收藏.txt', '/tavern-vault.json']);
});


test('同一分类的标题重名加序号，不同分类可各自使用原标题，空分类也有文件夹', async () => {
  const { directory, storage } = await setup();
  const a = (await storage.save(draft('剧情正文'), { ...options, newCategory: '剧情片段' })).entry;
  const b = (await storage.save(draft('页面正文'), { ...options, newCategory: 'HTML 页面' })).entry;
  const c = (await storage.save(draft('另一段剧情'), { ...options, categoryId: a.categoryId })).entry;
  await storage.addCategory('空分类');
  assert.equal(textFilePath(a), '剧情片段/重逢的片刻.txt');
  assert.equal(textFilePath(b), 'HTML 页面/重逢的片刻.txt');
  assert.equal(textFilePath(c), '剧情片段/重逢的片刻 (2).txt');
  const items = await directory.getDirectoryHandle('items');
  assert.equal((await items.getDirectoryHandle('空分类')).children.size, 0);
  const reopened = new VaultStorage({}); await reopened.attach(directory, false);
  assert.equal(reopened.entries.find(entry => entry.id === a.id).original, '剧情正文');
  assert.equal(reopened.entries.find(entry => entry.id === b.id).original, '页面正文');
});

test('分类名特殊字符及截短重名会分配不同目录，不接管未知同名目录', async () => {
  const { directory, storage } = await setup(); const items = await directory.getDirectoryHandle('items');
  const unknown = await items.getDirectoryHandle('已有目录', { create: true });
  (await unknown.getFileHandle('keep.txt', { create: true })).value = '未知文件';
  await storage.load();
  const categories = ['剧情/片段', '剧情\\片段', '已有目录', '长'.repeat(79) + '甲', '长'.repeat(79) + '乙'];
  const entries = [];
  for (const name of categories) entries.push((await storage.save(draft(name), { ...options, newCategory: name })).entry);
  assert.equal(entries[0].content.folder, '剧情_片段'); assert.equal(entries[1].content.folder, '剧情_片段 (2)');
  assert.equal(entries[2].content.folder, '已有目录 (2)');
  assert.notEqual(entries[3].content.folder, entries[4].content.folder);
  assert.equal((await unknown.getFileHandle('keep.txt')).value, '未知文件');
  await storage.load(); assert.equal(storage.entries.length, categories.length);
});

test('确认改分类会移动 TXT，遇到目标同名文件加序号，不改变原文、来源或收藏时间', async () => {
  const { directory, storage } = await setup();
  const a = (await storage.save(draft('要移动的正文'), { ...options, newCategory: '剧情' })).entry;
  const b = (await storage.save(draft('目标已有正文'), { ...options, newCategory: '信件' })).entry;
  assert.equal(storage.previewPath(a.title, { entryId: a.id, categoryId: b.categoryId }), '信件/重逢的片刻 (2).txt');
  const moved = await storage.edit(a.id, { ...options, categoryId: b.categoryId, ...confirmation(storage, a) });
  assert.equal(textFilePath(moved), '信件/重逢的片刻 (2).txt'); assert.equal(moved.cleanup, undefined);
  assert.equal(moved.savedAt, a.savedAt); assert.deepEqual(moved.source, a.source);
  const files = await filesIn(directory);
  assert.equal(files['/items/剧情/重逢的片刻.txt'], undefined);
  assert.equal(files['/items/信件/重逢的片刻.txt'], '目标已有正文');
  assert.equal(files['/items/信件/重逢的片刻 (2).txt'], '要移动的正文');
  const reopened = new VaultStorage({}); await reopened.attach(directory, false);
  assert.equal(reopened.entries.find(entry => entry.id === a.id).original, a.original);
});

test('跨分类移动的正文或索引写入失败时原文件仍在，旧位置清理失败可重载后重试', async () => {
  for (const fail of ['/目标/重逢的片刻.txt', '/tavern-vault.json']) {
    const { directory, storage } = await setup(); const target = await storage.addCategory('目标');
    const { entry } = await storage.save(draft('原位置正文'), options); const before = await filesIn(directory);
    directory.state.fail = fail;
    await assert.rejects(storage.edit(entry.id, { ...options, categoryId: target }));
    directory.state.fail = ''; assert.deepEqual(await filesIn(directory), before);
  }
  const { directory, storage } = await setup(); const target = await storage.addCategory('目标');
  const { entry } = await storage.save(draft('原位置正文'), options);
  directory.state.failRemove = '/未分类/重逢的片刻.txt';
  const moved = await storage.edit(entry.id, { ...options, categoryId: target }); assert(moved.cleanup);
  const reopened = new VaultStorage({}); await reopened.attach(directory, false); assert.equal(reopened.entries[0].content.folder, '目标');
  directory.state.failRemove = ''; await reopened.cleanupContent(entry.id);
  assert.equal((await filesIn(directory))['/items/未分类/重逢的片刻.txt'], undefined);
  assert.equal((await filesIn(directory))['/items/目标/重逢的片刻.txt'], '原位置正文');
});

test('不同分类的同名 TXT 删除与重试仅影响选中的收藏，分类文件夹保留', async () => {
  const { directory, storage } = await setup();
  const a = (await storage.save(draft('删除正文'), { ...options, newCategory: '甲' })).entry;
  const b = (await storage.save(draft('保留正文'), { ...options, newCategory: '乙' })).entry;
  directory.state.failRemove = '/甲/重逢的片刻.txt';
  assert.equal((await storage.delete(a.id, confirmation(storage, a))).cleanupPending, true);
  const reopened = new VaultStorage({}); await reopened.attach(directory, false);
  assert.equal(reopened.entries.length, 1); assert.equal(reopened.entries[0].id, b.id);
  directory.state.failRemove = ''; assert.equal(await reopened.retryDeletions(), 0);
  assert.equal((await filesIn(directory))['/items/乙/重逢的片刻.txt'], '保留正文');
  assert.equal((await (await directory.getDirectoryHandle('items')).getDirectoryHandle('甲')).children.size, 0);
});

async function flatFixture() {
  const directory = new MemoryDirectory(); const items = await directory.getDirectoryHandle('items', { create: true });
  const original = '<button>旧版平铺正文</button>';
  const entry = { schemaVersion: 4, id: 'old-flat', title: '旧版平铺', categoryId: UNFILED,
    savedAt: '2026-10-23T01:00:00.000Z', updatedAt: '2026-10-23T01:00:00.000Z', source: compactSource(source()),
    content: { originalFile: '旧版平铺.txt', originalSha256: await digest(original), pages: [{ label: '页面 1', kind: 'source' }], warnings: [] } };
  (await items.getFileHandle('旧版平铺.txt', { create: true })).value = original;
  (await directory.getFileHandle(META_FILE, { create: true })).value = JSON.stringify({ product: 'tavern-vault', schemaVersion: 2,
    libraryId: 'flat-library', revision: 0, createdAt: entry.savedAt, categories: [{ id: UNFILED, name: '未分类' }], entries: [entry], deleted: [] });
  const storage = new VaultStorage({}); await storage.attach(directory, false); return { directory, storage, entry, original };
}

test('v0.5 平铺库读取不搬动，明确整理后放入分类文件夹，来源和收藏时间保留', async () => {
  const { directory, storage, entry, original } = await flatFixture();
  const before = await filesIn(directory); await storage.load(); assert.deepEqual(await filesIn(directory), before); assert.equal(storage.legacyCount, 1);
  assert.equal(await storage.readPage(storage.entries[0], 0), original);
  const result = await storage.migrate({ confirmed: true, expectedLibraryId: storage.meta.libraryId });
  assert.equal(result.converted, 1); assert.equal(result.cleanupPending, 0); assert.equal(storage.entries[0].schemaVersion, 5);
  assert.equal(storage.entries[0].savedAt, entry.savedAt); assert.deepEqual(storage.entries[0].source, entry.source);
  assert.deepEqual(Object.keys(await filesIn(directory)).sort(), ['/items/未分类/旧版平铺.txt', '/tavern-vault.json']);
  assert.equal((await filesIn(directory))['/items/未分类/旧版平铺.txt'], original);
});

test('旧平铺 TXT 移动提交失败不丢原文件，未整理时也可以直接删除', async () => {
  const { directory, storage } = await flatFixture(); await storage.addCategory('未分类');
  const before = await filesIn(directory); directory.state.fail = '/tavern-vault.json';
  await assert.rejects(storage.migrate({ confirmed: true, expectedLibraryId: storage.meta.libraryId }));
  directory.state.fail = ''; assert.deepEqual(await filesIn(directory), before);
  assert.equal((await storage.delete(storage.entries[0].id, confirmation(storage, storage.entries[0]))).cleanupPending, false);
  assert.deepEqual(Object.keys(await filesIn(directory)), ['/tavern-vault.json']);
});

test('分类目录越界、重复目录与收藏的目录分类不一致时拒绝写入', async () => {
  const { directory, storage } = await setup(); const { entry } = await storage.save(draft(), options);
  for (const folder of ['../other', 'nested/folder', '..', '']) {
    assert.throws(() => validateEntry({ ...entry, content: { ...entry.content, folder } }, entry.id), /分类文件夹/);
    assert.throws(() => validateEntry({ ...entry, cleanup: { files: [{ name: 'keep.txt', folder, sha256: 'a'.repeat(64) }] } }, entry.id), /清理/);
  }
  const meta = await rootRecord(directory);
  assert.throws(() => validateMeta({ ...meta, categories: [...meta.categories, { id: 'other', name: '另一分类', folder: '未分类' }] }), /分类文件夹/);
  assert.throws(() => validateMeta({ ...meta, entries: [{ ...meta.entries[0], content: { ...meta.entries[0].content, folder: '另一分类' } }] }), /分类文件夹不一致/);
});
