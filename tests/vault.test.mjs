import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { VaultStorage } from '../src/storage.js';
import { captureFloor } from '../src/capture.js';
import { extractHtmlPages, digest, META_FILE, UNFILED, editToken, validateEntry, titleFileBase } from '../src/core.js';
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
  directory.state.fail = '/重逢的片刻.txt';
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
  assert.equal((await partial.getFileHandle('重逢的片刻.txt')).value, draft().original);
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
  (await item.getFileHandle(saved.entry.content.originalFile)).value = '已被外部修改';
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
  assert.equal(after.content.originalSha256, before.content.originalSha256);
  assert.equal(after.content.originalFile, '新的标题.txt');
  assert.equal(after.content.renderedFile, '新的标题.html');
  assert.equal(after.content.pages[0].file, 'pages/新的标题.html');
  assert.equal(storage.entries[0].original, draft().original);
  assert.equal(await storage.readPage(storage.entries[0], 0), '<button>点灯</button>');
  assert.equal(await storage.readPage(storage.entries[0], -1), draft().rendered);
  assert.equal(after.editedAt, before.editedAt);
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

const confirmation = (storage, entry) => ({ confirmed: true, expectedToken: editToken(entry), expectedLibraryId: storage.meta.libraryId });
async function filesIn(directory, prefix = '') {
  const files = {};
  for await (const handle of directory.values()) {
    if (handle.kind === 'file') files[`${prefix}/${handle.name}`] = await (await handle.getFile()).text();
    else Object.assign(files, await filesIn(handle, `${prefix}/${handle.name}`));
  }
  return files;
}

test('未确认或未修改内容时不写盘，空草稿不能覆盖原文', async () => {
  const { directory, storage } = await setup();
  const { entry } = await storage.save(draft(), options);
  const before = await filesIn(directory);
  const writes = directory.state.writes;
  await assert.rejects(storage.updateContent(entry.id, '草稿', { ...confirmation(storage, entry), confirmed: false }), /尚未确认/);
  await assert.rejects(storage.updateContent(entry.id, '  ', confirmation(storage, entry)), /不能为空/);
  const unchanged = await storage.updateContent(entry.id, entry.original, confirmation(storage, entry));
  assert.equal(unchanged.unchanged, true);
  assert.equal(directory.state.writes, writes);
  assert.deepEqual(await filesIn(directory), before);
});

test('确认编辑后同步原文、页面、快照与哈希，保留来源及收藏时间，不保留旧内容', async () => {
  const { directory, storage } = await setup();
  const { entry } = await storage.save(draft('OLD_BODY_MARKER'), options);
  const recordDir = await (await directory.getDirectoryHandle('items')).getDirectoryHandle(entry.id);
  const marker = await recordDir.getFileHandle('entry.json');
  const initial = JSON.parse(marker.value); initial.futureField = { keep: 7 }; marker.value = JSON.stringify(initial);
  const text = '修改后的文字\r\n```html\n<div><button onclick="this.textContent=\'修改已同步\'">点击</button></div>\n```';
  const result = await storage.updateContent(entry.id, text, confirmation(storage, entry));
  assert.equal(result.cleanupPending, false);
  assert.equal(result.entry.id, entry.id);
  assert.equal(result.entry.savedAt, entry.savedAt);
  assert.equal(result.entry.title, entry.title);
  assert.equal(result.entry.categoryId, entry.categoryId);
  assert.deepEqual(result.entry.source, entry.source);
  assert.deepEqual(result.entry.futureField, { keep: 7 });
  assert.equal(result.entry.content.originalSha256, await digest(text));
  assert.equal(result.entry.schemaVersion, 3);
  assert.equal(result.entry.cleanup, undefined);
  assert(Number.isFinite(Date.parse(result.entry.editedAt)));
  const reopened = new VaultStorage({}); await reopened.attach(directory, false);
  assert.equal(reopened.entries[0].original, text);
  assert.match(await reopened.readPage(reopened.entries[0], 0), /修改已同步/);
  assert.match(await reopened.readPage(reopened.entries[0], -1), /&lt;button/);
  assert.equal(recordDir.children.has(entry.content.originalFile), false);
  assert.equal(recordDir.children.has(entry.content.renderedFile), false);
  for (const value of Object.values(await filesIn(recordDir))) assert.doesNotMatch(value, /OLD_BODY_MARKER|这是显示内容/);
});

test('再次确认编辑只留下当前内容集，多页变为纯文字时没有旧 HTML 残留', async () => {
  const { directory, storage } = await setup();
  let { entry } = await storage.save(draft('LEGACY_BODY_MARKER'), options);
  entry = (await storage.updateContent(entry.id, '```html\n<div>FIRST_EDIT_MARKER</div>\n```\n```html\n<button>SECOND_PAGE_MARKER</button>\n```', confirmation(storage, entry))).entry;
  assert.equal(entry.content.pages.length, 2);
  entry = (await storage.updateContent(entry.id, '最终的纯文字', confirmation(storage, entry))).entry;
  const recordDir = await (await directory.getDirectoryHandle('items')).getDirectoryHandle(entry.id);
  const content = await recordDir.getDirectoryHandle('content');
  assert.equal([...content.children.values()].filter(handle => handle.kind === 'directory').length, 1);
  assert.equal(entry.content.pages.length, 0);
  for (const value of Object.values(await filesIn(recordDir))) assert.doesNotMatch(value, /LEGACY_BODY_MARKER|FIRST_EDIT_MARKER|SECOND_PAGE_MARKER/);
});

test('内容写入或提交失败时仍能恢复旧记录，重试成功后清理失败的临时内容', async () => {
  for (const suffix of ['/重逢的片刻.txt', '/pages/重逢的片刻.html', '/entry.json']) {
    const { directory, storage } = await setup();
    const { entry } = await storage.save(draft('OLD_INTACT_MARKER'), options);
    directory.state.fail = suffix;
    await assert.rejects(storage.updateContent(entry.id, '```html\n<div>CONFIRMED_NEW_MARKER</div>\n```', confirmation(storage, entry)));
    directory.state.fail = '';
    const reopened = new VaultStorage({}); await reopened.attach(directory, false);
    assert.equal(reopened.entries[0].original, 'OLD_INTACT_MARKER');
    const next = await reopened.updateContent(entry.id, '最终保存', confirmation(reopened, reopened.entries[0]));
    assert.equal(next.cleanupPending, false);
    const recordDir = await (await directory.getDirectoryHandle('items')).getDirectoryHandle(entry.id);
    for (const value of Object.values(await filesIn(recordDir))) assert.doesNotMatch(value, /OLD_INTACT_MARKER|CONFIRMED_NEW_MARKER/);
  }
});

test('保存成功但旧文件清理失败时明确返回待清理状态，重试只保留新内容', async () => {
  const { directory, storage } = await setup();
  const { entry } = await storage.save(draft('OLD_CLEANUP_MARKER'), options);
  directory.state.failRemove = '/重逢的片刻.txt';
  const result = await storage.updateContent(entry.id, '新内容', confirmation(storage, entry));
  assert.equal(result.cleanupPending, true);
  const reopened = new VaultStorage({}); await reopened.attach(directory, false);
  assert.equal(reopened.entries[0].original, '新内容');
  assert(reopened.entries[0].cleanup);
  directory.state.failRemove = '';
  await reopened.cleanupContent(entry.id);
  assert.equal(reopened.entries[0].cleanup, undefined);
  for (const value of Object.values(await filesIn(directory))) assert.doesNotMatch(value, /OLD_CLEANUP_MARKER/);
});

test('过期编辑、切换收藏库和原文被外部改变时拒绝覆盖', async () => {
  const { directory, storage } = await setup();
  const { entry } = await storage.save(draft('原内容'), options);
  const stale = confirmation(storage, entry);
  const changed = await storage.updateContent(entry.id, '别处已保存', stale);
  const writes = directory.state.writes;
  await assert.rejects(storage.updateContent(entry.id, '过期草稿', stale), /别处修改/);
  await assert.rejects(storage.updateContent(entry.id, '错误库草稿', { ...confirmation(storage, changed.entry), expectedLibraryId: 'other' }), /更换了收藏库/);
  assert.equal(directory.state.writes, writes);
  const recordDir = await (await directory.getDirectoryHandle('items')).getDirectoryHandle(entry.id);
  const active = await (await recordDir.getDirectoryHandle('content')).getDirectoryHandle(changed.entry.content.storageId);
  (await active.getFileHandle(changed.entry.content.originalFile)).value = '外部手动改变';
  await assert.rejects(storage.updateContent(entry.id, '不得覆盖', confirmation(storage, changed.entry)), /外部修改/);
  assert.equal(directory.state.writes, writes);
});

test('编辑索引拒绝目录越界，旧内容清理保留未知文件夹和文件', async () => {
  const { directory, storage } = await setup();
  const { entry } = await storage.save(draft('原文'), options);
  const recordDir = await (await directory.getDirectoryHandle('items')).getDirectoryHandle(entry.id);
  const foreign = await (await recordDir.getDirectoryHandle('content', { create: true })).getDirectoryHandle('unknown', { create: true });
  (await foreign.getFileHandle('keep.txt', { create: true })).value = '保留未知文件';
  const result = await storage.updateContent(entry.id, '新原文', confirmation(storage, entry));
  assert.equal((await foreign.getFileHandle('keep.txt')).value, '保留未知文件');
  assert.throws(() => validateEntry({ ...result.entry, content: { ...result.entry.content, storageId: '../other' } }, entry.id), /内容目录/);
  recordDir.removeEntry = undefined;
  const writes = directory.state.writes;
  await assert.rejects(storage.updateContent(entry.id, '缺少清理接口时不得写入', confirmation(storage, result.entry)), /无法清理旧内容/);
  assert.equal(directory.state.writes, writes);
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

test('新收藏的原文、显示副本和多 HTML 页面均按标题命名，完整标题仍保留在记录中', async () => {
  const { directory, storage } = await setup();
  const input = draft();
  input.pages.push({ label: '第二页', kind: 'source', html: '<div>SECOND_NAMED_PAGE</div>' });
  const title = '雪夜/重逢';
  const { entry } = await storage.save(input, { ...options, title });
  const files = await filesIn(await (await directory.getDirectoryHandle('items')).getDirectoryHandle(entry.id));
  assert.equal(entry.title, title);
  assert.equal(files['/雪夜_重逢.txt'], input.original);
  assert.equal(files['/雪夜_重逢.html'], input.rendered);
  assert.equal(files['/pages/雪夜_重逢.html'], input.pages[0].html);
  assert.equal(files['/pages/雪夜_重逢 - 页面2.html'], input.pages[1].html);
  assert.equal(files['/original.txt'], undefined);
  const reopened = new VaultStorage({}); await reopened.attach(directory, false);
  assert.equal(reopened.entries[0].title, title);
  assert.equal(await reopened.readPage(reopened.entries[0], 1), input.pages[1].html);
});

test('同名、大小写相似及特殊字符替换后同名的收藏互不覆盖', async () => {
  const { directory, storage } = await setup();
  const titles = ['同名收藏', '同名收藏', 'Story', 'story', '故事/雪', '故事\\雪'];
  const saved = [];
  for (const [index, title] of titles.entries()) saved.push((await storage.save(draft(`不同正文 ${index}`), { ...options, title })).entry);
  assert.equal(new Set(saved.map(entry => entry.id)).size, titles.length);
  const reopened = new VaultStorage({}); await reopened.attach(directory, false);
  for (const [index, entry] of saved.entries()) {
    assert.equal(reopened.entries.find(item => item.id === entry.id).original, `不同正文 ${index}`);
    assert.equal(entry.content.originalFile, `${titleFileBase(titles[index])}.txt`);
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
  const write = async (dir, name, text) => { (await dir.getFileHandle(name, { create: true })).value = text; };
  let active = item;
  if (schemaVersion === 2) {
    record.content.storageId = 'old-content';
    active = await (await item.getDirectoryHandle('content', { create: true })).getDirectoryHandle('old-content', { create: true });
    await write(active, '.owned.json', JSON.stringify({ product: 'tavern-vault', entryId: id, storageId: 'old-content' }));
  }
  for (const target of pendingCleanup ? [item, active] : [active]) {
    await write(target, 'original.txt', original);
    await write(target, 'rendered.html', rendered);
    const pageDirectory = await target.getDirectoryHandle('pages', { create: true });
    for (const [index, text] of pages.entries()) await write(pageDirectory, `page-${index + 1}.html`, text);
  }
  if (pendingCleanup) record.cleanup = { legacyPageCount: pages.length };
  await write(item, 'entry.json', JSON.stringify(record));
  return { record, original, rendered, pages, item };
}

test('格式 1 和 2 的旧库读取与新增收藏共存，连接或刷新不会改名旧文件', async () => {
  const { directory, storage } = await setup();
  const old = [await legacyFixture(directory, 1), await legacyFixture(directory, 2)];
  const before = await filesIn(directory);
  await storage.load();
  assert.equal(storage.entries.length, 2);
  assert.deepEqual(await filesIn(directory), before);
  for (const fixture of old) {
    const entry = storage.entries.find(item => item.id === fixture.record.id);
    assert.equal(entry.original, fixture.original);
    assert.equal(await storage.readPage(entry, 1), fixture.pages[1]);
    assert.equal(await storage.readPage(entry, -1), fixture.rendered);
  }
  await storage.save(draft('新增内容'), options);
  const after = await filesIn(directory);
  for (const [name, value] of Object.entries(before)) assert.equal(after[name], value);
});

test('旧格式确认编辑后转为标题文件名，连同先前待清理文件一起删除，不保留旧版本', async () => {
  for (const version of [1, 2]) {
    const { directory, storage } = await setup();
    const fixture = await legacyFixture(directory, version, version === 2);
    await storage.load();
    const entry = storage.entries[0];
    const result = await storage.updateContent(entry.id, '<div>新的当前内容</div>', confirmation(storage, entry));
    assert.equal(result.cleanupPending, false);
    assert.equal(result.entry.content.originalFile, '以前的收藏.txt');
    assert.equal(result.entry.schemaVersion, 3);
    assert.deepEqual(result.entry.source, fixture.record.source);
    const reopened = new VaultStorage({}); await reopened.attach(directory, false);
    assert.equal(reopened.entries[0].original, '<div>新的当前内容</div>');
    for (const [name, value] of Object.entries(await filesIn(fixture.item))) {
      assert.doesNotMatch(name, /original\.txt|rendered\.html|page-[12]\.html/);
      assert.doesNotMatch(value, /LEGACY_(BODY|SNAPSHOT|PAGE)_MARKER/);
    }
  }
});

test('旧收藏明确保存新标题后同步改名，原文与显示快照及页面不重新生成', async () => {
  for (const version of [1, 2]) {
    const { directory, storage } = await setup();
    const fixture = await legacyFixture(directory, version);
    await storage.load();
    const entry = storage.entries[0];
    const renamed = await storage.edit(entry.id, { ...options, title: '新标题', expectedToken: editToken(entry), expectedLibraryId: storage.meta.libraryId });
    assert.equal(renamed.content.originalFile, '新标题.txt');
    assert.equal(renamed.cleanup, undefined);
    assert.equal(renamed.savedAt, entry.savedAt);
    assert.equal(renamed.editedAt, undefined);
    assert.deepEqual(renamed.source, entry.source);
    assert.deepEqual(renamed.futureField, fixture.record.futureField);
    assert.equal(await storage.readPage(renamed, -1), fixture.rendered);
    assert.equal(await storage.readPage(renamed, 1), fixture.pages[1]);
    const reopened = new VaultStorage({}); await reopened.attach(directory, false);
    assert.equal(reopened.entries[0].original, fixture.original);
    const files = await filesIn(fixture.item);
    assert(!Object.keys(files).some(name => /original\.txt|rendered\.html|page-[12]\.html/.test(name)));
  }
});

test('标题改名写入或提交失败仍读取原记录，重试后只保留新名称且不覆盖未知文件', async () => {
  for (const suffix of ['/新标题.txt', '/pages/新标题.html', '/entry.json']) {
    const { directory, storage } = await setup();
    const { entry } = await storage.save(draft(), options);
    const item = await (await directory.getDirectoryHandle('items')).getDirectoryHandle(entry.id);
    (await item.getFileHandle('新标题.txt', { create: true })).value = '用户放入的未知文件';
    directory.state.fail = suffix;
    await assert.rejects(storage.edit(entry.id, { ...options, title: '新标题' }));
    directory.state.fail = '';
    const reopened = new VaultStorage({}); await reopened.attach(directory, false);
    assert.equal(reopened.entries[0].title, entry.title);
    assert.equal(reopened.entries[0].original, entry.original);
    const renamed = await reopened.edit(entry.id, { ...options, title: '新标题' });
    assert.equal(renamed.title, '新标题');
    assert.equal((await item.getFileHandle('新标题.txt')).value, '用户放入的未知文件');
    assert.equal(item.children.has('重逢的片刻.txt'), false);
    const content = await item.getDirectoryHandle('content');
    assert.equal([...content.children.values()].filter(handle => handle.kind === 'directory').length, 1);
  }
});

test('标题改名清理失败可以重载后重试，未同步的整理草稿不能覆盖新记录', async () => {
  const { directory, storage } = await setup();
  const { entry } = await storage.save(draft(), options);
  const expectedToken = editToken(entry);
  directory.state.failRemove = '/重逢的片刻.txt';
  const renamed = await storage.edit(entry.id, { ...options, title: '新的标题', expectedToken });
  assert(renamed.cleanup);
  const reopened = new VaultStorage({}); await reopened.attach(directory, false);
  assert.equal(reopened.entries[0].title, '新的标题');
  assert.equal(reopened.entries[0].original, entry.original);
  const writes = directory.state.writes;
  await assert.rejects(reopened.edit(entry.id, { ...options, title: '过期整理', expectedToken }), /别处修改/);
  await assert.rejects(reopened.edit(entry.id, { ...options, title: '换库整理', expectedLibraryId: 'other' }), /更换了收藏库/);
  assert.equal(directory.state.writes, writes);
  directory.state.failRemove = '';
  await reopened.cleanupContent(entry.id);
  const files = await filesIn(directory);
  assert(!Object.keys(files).some(name => name.endsWith('/重逢的片刻.txt') || name.endsWith('/重逢的片刻.html')));
  assert.equal(reopened.entries[0].cleanup, undefined);
});

test('标题文件索引和清理记录拒绝越界路径与伪造名称', async () => {
  const { storage } = await setup();
  const { entry } = await storage.save(draft(), options);
  for (const change of [{ originalFile: '../private.txt' }, { renderedFile: '/other.html' }, { fileBase: '../outside' }, { fileBase: '另一个标题' }]) {
    assert.throws(() => validateEntry({ ...entry, content: { ...entry.content, ...change } }, entry.id), /文件名|文件路径/);
  }
  assert.throws(() => validateEntry({ ...entry, content: { ...entry.content, storageId: 'safe' },
    cleanup: { legacyPageCount: 1, legacyFileBase: '../outside' } }, entry.id), /清理记录/);
});
