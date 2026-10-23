/* 储藏库 v0.5.0 | SillyTavern 原生扩展 | 无远程代码依赖 */
// src/core.js
const VERSION = '0.5.0';
const PRODUCT = 'tavern-vault';
const SCHEMA_VERSION = 1;
const UNFILED = 'uncategorized';
const META_FILE = 'tavern-vault.json';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalized(value) {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase();
}

function safeId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
}

function titleFileBase(title) {
  let name = String(title ?? '').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*\u202a-\u202e\u2066-\u2069\ud800-\udfff]/gu, '_')
    .trim().replace(/[. ]+$/g, '');
  if (!name) name = '未命名收藏';
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/i.test(name.split('.')[0].trimEnd())) name = `_${name}`;
  // Leave room for extensions and page suffixes on common local filesystems.
  const encoder = new TextEncoder();
  if (name.length > 120 || encoder.encode(name).length > 180) {
    let short = '';
    let bytes = 0;
    for (const char of name) {
      const size = encoder.encode(char).length;
      if (short.length + char.length + 1 > 120 || bytes + size + 3 > 180) break;
      short += char; bytes += size;
    }
    name = `${short.replace(/[. ]+$/g, '')}…`;
  }
  return name;
}

function safeFileBase(value) {
  return typeof value === 'string' && value.length > 0 && titleFileBase(value) === value;
}

function contentFileNames(fileBase, pageCount) {
  return {
    originalFile: fileBase == null ? 'original.txt' : `${fileBase}.txt`,
    renderedFile: fileBase == null ? 'rendered.html' : `${fileBase}.html`,
    pageFiles: Array.from({ length: pageCount }, (_, index) => fileBase == null
      ? `pages/page-${index + 1}.html`
      : `pages/${fileBase}${index ? ` - 页面${index + 1}` : ''}.html`),
  };
}

function compactSource(source) {
  return { chatId: String(source.chatId || source.chatName || ''),
    characterName: String(source.characterName || source.characterOrGroupName || source.speakerName || '未取得角色'),
    messageId: source.messageId };
}

function safeTextFile(name) {
  return typeof name === 'string' && name.endsWith('.txt') && name.length <= 150 &&
    !/[\u0000-\u001f<>:"/\\|?*]/u.test(name) && name !== '.txt' && !/[. ]$/.test(name.slice(0, -4)) &&
    !/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)(?:\.|$)/i.test(name);
}

function newId() {
  return crypto.randomUUID();
}

async function digest(text) {
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(result), n => n.toString(16).padStart(2, '0')).join('');
}

function validateMeta(value) {
  assert(value?.product === PRODUCT && [1, 2].includes(value.schemaVersion),
    '这个文件夹不是受支持的储藏库，或文件格式版本不同。请另选文件夹。');
  assert(safeId(value.libraryId) && Number.isSafeInteger(value.revision) && value.revision >= 0,
    '收藏库配置损坏，已停止写入；原文件保持不变。');
  assert(Array.isArray(value.categories), '收藏库分类记录损坏，已停止写入。');
  const ids = new Set();
  const names = new Set();
  for (const category of value.categories) {
    assert(category && safeId(category.id) && typeof category.name === 'string' &&
      category.name.trim().length > 0 && category.name.length <= 80 &&
      !ids.has(category.id) && !names.has(normalized(category.name)), '收藏库中存在损坏或重复的分类。');
    ids.add(category.id);
    names.add(normalized(category.name));
  }
  assert(ids.has(UNFILED), '收藏库缺少“未分类”记录，已停止写入。');
  if (value.schemaVersion === 2) {
    assert(Array.isArray(value.entries) && Array.isArray(value.deleted), '收藏库的文件清单损坏，已停止写入。');
    const entryIds = new Set();
    const files = new Set();
    for (const record of [...value.entries, ...value.deleted.map(item => item?.entry)]) {
      validateEntry(record, record?.id);
      assert(!entryIds.has(record.id), '收藏库中存在重复的收藏编号。');
      entryIds.add(record.id);
    }
    for (const record of value.entries) {
      assert(record.schemaVersion === 4 && !files.has(normalized(record.content.originalFile)), '收藏库中存在重复或无效的 TXT 文件名。');
      files.add(normalized(record.content.originalFile));
    }
  }
  return value;
}

function validateEntry(value, directoryId) {
  assert([1, 2, 3, 4].includes(value?.schemaVersion) && safeId(value.id) && value.id === directoryId,
    '收藏记录的编号或格式无效。');
  assert(typeof value.title === 'string' && value.title.length <= 160 && safeId(value.categoryId),
    '收藏的标题或分类无效。');
  assert(value.source && typeof value.source.chatId === 'string' &&
    Number.isSafeInteger(value.source.messageId) && value.source.messageId >= 0 &&
    (value.schemaVersion === 4 ? typeof value.source.characterName === 'string' :
      Number.isSafeInteger(value.source.swipeId) && value.source.swipeId >= 0 && typeof value.source.speakerName === 'string'), '收藏来源记录不完整。');
  if (value.source.selection != null) {
    const selection = value.source.selection;
    assert(typeof selection.includeTag === 'string' && Array.isArray(selection.excludeTags) &&
      selection.excludeTags.every(tag => typeof tag === 'string') &&
      Number.isSafeInteger(selection.includedCount) && selection.includedCount >= 0 &&
      Number.isSafeInteger(selection.excludedCount) && selection.excludedCount >= 0, '收藏的标签筛选记录损坏。');
  }
  assert(typeof value.savedAt === 'string' && Number.isFinite(Date.parse(value.savedAt)), '收藏时间无效。');
  assert(typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)), '收藏修改时间无效。');
  assert(value.content && /^[a-f0-9]{64}$/.test(value.content.originalSha256) &&
    Array.isArray(value.content.pages) && value.content.pages.length <= 100, '收藏内容索引无效。');
  assert(Array.isArray(value.content.warnings) && value.content.warnings.every(note => typeof note === 'string'), '收藏页面说明记录无效。');
  if (value.schemaVersion === 4) {
    assert(safeTextFile(value.content.originalFile) && value.content.storageId == null && value.content.renderedFile == null &&
      value.content.pages.every(page => page && typeof page.label === 'string' && page.file == null), '收藏的 TXT 文件索引无效。');
    if (value.cleanup != null) {
      assert(Array.isArray(value.cleanup.files) && value.cleanup.files.every(file => safeTextFile(file.name) && /^[a-f0-9]{64}$/.test(file.sha256)), '收藏清理记录无效。');
      if (value.cleanup.legacy != null) {
        assert([1, 2, 3].includes(value.cleanup.legacy.schemaVersion) && value.cleanup.legacy.id === value.id, '旧收藏清理编号无效。');
        validateEntry(value.cleanup.legacy, value.id);
      }
    }
    return value;
  }
  assert(value.schemaVersion === 3
    ? safeFileBase(value.content.fileBase) && value.content.fileBase === titleFileBase(value.title)
    : value.content.fileBase == null, '收藏文件名无效。');
  const names = contentFileNames(value.content.fileBase, value.content.pages.length);
  assert(value.content.originalFile === names.originalFile && value.content.renderedFile === names.renderedFile,
    '收藏内容文件路径无效。');
  assert(value.schemaVersion === 1 ? value.content.storageId == null
    : value.schemaVersion === 2 ? safeId(value.content.storageId)
    : value.content.storageId == null || safeId(value.content.storageId),
    '收藏内容目录无效。');
  if (value.cleanup != null) assert(value.schemaVersion >= 2 && safeId(value.content.storageId) &&
    Number.isSafeInteger(value.cleanup.legacyPageCount) && value.cleanup.legacyPageCount >= -1 &&
    value.cleanup.legacyPageCount <= 100 && (value.cleanup.legacyFileBase == null ||
      (value.schemaVersion === 3 && value.cleanup.legacyPageCount >= 0 && safeFileBase(value.cleanup.legacyFileBase))),
  '收藏清理记录无效。');
  assert(value.content.pages.every((p, index) =>
    p && p.file === names.pageFiles[index] && typeof p.label === 'string'), '收藏页面路径无效。');
  assert(Array.isArray(value.content.warnings) && value.content.warnings.every(note => typeof note === 'string'), '收藏页面说明记录无效。');
  return value;
}

function editToken(entry) {
  return JSON.stringify([entry.updatedAt, entry.title, entry.categoryId, entry.source, entry.content]);
}

function sourceLabel(source) {
  return `${source.chatName || source.chatId || '未取得聊天名'} · 楼层 #${source.messageId}`;
}

function sameSnapshot(a, b) {
  return a.content.originalSha256 === b.content.originalSha256 &&
    a.source.chatId === b.source.chatId &&
    a.source.characterOrGroupId === b.source.characterOrGroupId &&
    a.source.origin === b.source.origin &&
    a.source.messageId === b.source.messageId && a.source.swipeId === b.source.swipeId;
}

function titleFromText(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/<[^>]*>/g, ' ')
    .replace(/[#*_~`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || '未命名收藏';
}

function extractHtmlPages(text) {
  const pages = [];
  const fence = /(?:^|\n)[ \t]*(`{3,}|~{3,})[ \t]*(?:html|htm)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\1[ \t]*(?=\r?\n|$)/gi;
  for (const match of String(text).matchAll(fence)) {
    if (/<(?:!doctype|html|head|body|style|script|div|main|section|article|svg|button|p|span|a|details|form|table|input|canvas)\b/i.test(match[2])) {
      pages.push({ html: match[2], label: `页面 ${pages.length + 1}`, kind: 'source' });
    }
  }
  if (!pages.length) {
    const full = [...String(text).matchAll(/(?:<!doctype\s+html[^>]*>\s*)?<html\b[\s\S]*?<\/html\s*>/gi)];
    if (full.length) for (const match of full) pages.push({ html: match[0], label: `页面 ${pages.length + 1}`, kind: 'source' });
    else if (/^\s*<(?:!doctype|html|head|body|style|script|div|main|section|article|svg|button|p|span|a|details|form|table|input|canvas)\b/i.test(text)) {
      pages.push({ html: String(text), label: '页面 1', kind: 'source' });
    }
  }
  return pages.slice(0, 100);
}

function friendlyError(error) {
  if (error?.name === 'AbortError') return '已取消，尚未保存。';
  if (error?.name === 'NotAllowedError') return '文件夹读写权限未获准。请点击“重新授权”，再重试；收藏草稿仍保留。';
  if (error?.name === 'SecurityError') return '浏览器未允许访问文件夹。请使用电脑 Chrome/Edge，并通过 localhost 或 HTTPS 打开酒馆，然后点击选择文件夹。';
  if (error?.name === 'QuotaExceededError') return '磁盘空间不足，收藏未保存成功。请释放空间后重试。';
  if (error?.name === 'NotFoundError') return '文件夹或文件已被移动、删除。请重新选择收藏文件夹。';
  return error?.message || '操作未完成，请重试。';
}


// src/storage.js

async function readFile(directory, name) { return (await (await directory.getFileHandle(name)).getFile()).text(); }
async function optionalFile(directory, name) {
  try { return await readFile(directory, name); }
  catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
}
async function writeFile(directory, name, text) {
  const handle = await directory.getFileHandle(name, { create: true });
  let stream;
  try {
    stream = await handle.createWritable(); await stream.write(text); await stream.close();
    assert(await (await handle.getFile()).text() === text, '写入后核对失败，请重新读取文件夹确认。');
  } catch (error) { try { await stream?.abort(); } catch { /* Already closed. */ } throw error; }
}
async function removeIfPresent(directory, name, options) {
  try { await directory.removeEntry(name, options); }
  catch (error) { if (error.name !== 'NotFoundError') throw error; }
}
async function legacyContent(directory, record) {
  return record.content.storageId ? (await directory.getDirectoryHandle('content')).getDirectoryHandle(record.content.storageId) : directory;
}
function recordOnly(entry) { const { original, externalChanged, ...record } = entry; return record; }
function pageIndex(original) { return extractHtmlPages(original).map(page => ({ label: page.label, kind: page.kind })); }
function plainPreview(original) {
  const escaped = original.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<pre style="white-space:pre-wrap">${escaped}</pre>`;
}

class VaultStorage {
  constructor(environment = globalThis) {
    this.environment = environment; this.directory = null; this.meta = null;
    this.entries = []; this.issues = []; this.fileNames = []; this.queue = Promise.resolve();
  }
  get connected() { return Boolean(this.directory && this.meta); }
  get legacyCount() { return this.entries.filter(entry => entry.schemaVersion !== 4).length; }
  get pendingDeleteCount() { return this.meta?.deleted?.length || 0; }
  async permission(request = false) {
    if (!this.directory) return false;
    const options = { mode: 'readwrite' };
    return await this.directory.queryPermission(options) === 'granted' || request && await this.directory.requestPermission(options) === 'granted';
  }
  async attach(directory, initialize = true) {
    assert(directory?.kind === 'directory', '请选择一个文件夹。');
    const prior = { directory: this.directory, meta: this.meta, entries: this.entries, issues: this.issues, fileNames: this.fileNames };
    try {
      assert(await directory.queryPermission({ mode: 'readwrite' }) === 'granted', '尚未获得文件夹的读写权限，请重新授权。');
      let raw = await optionalFile(directory, META_FILE);
      if (raw === null) {
        assert(initialize, '未找到收藏库标识文件，请重新选择原收藏文件夹。');
        let collision = false;
        try { await directory.getDirectoryHandle('items'); collision = true; } catch (error) { if (error.name !== 'NotFoundError') throw error; }
        assert(!collision, '此文件夹已存在 items 目录，无法确认归属。请选择一个空文件夹以保留已有文件。');
        const meta = { product: PRODUCT, schemaVersion: 2, libraryId: newId(), revision: 0, createdAt: new Date().toISOString(),
          categories: [{ id: UNFILED, name: '未分类' }], entries: [], deleted: [] };
        raw = JSON.stringify(meta, null, 2);
        await directory.getDirectoryHandle('items', { create: true }); await writeFile(directory, META_FILE, raw);
      }
      this.meta = validateMeta(JSON.parse(raw)); this.directory = directory; await this.load();
    } catch (error) { Object.assign(this, prior); throw error; }
  }
  async readRecord(record) {
    validateEntry(record, record.id);
    const items = await this.directory.getDirectoryHandle('items');
    const directory = record.schemaVersion === 4 ? items : await legacyContent(await items.getDirectoryHandle(record.id), record);
    const original = await readFile(directory, record.content.originalFile);
    const sha256 = await digest(original);
    if (record.schemaVersion !== 4) assert(sha256 === record.content.originalSha256, '原文已变动，校验不一致');
    return record.schemaVersion === 4 ? { ...record, original, content: { ...record.content, originalSha256: sha256, pages: pageIndex(original) } }
      : { ...record, original };
  }
  async load() {
    assert(this.directory && await this.permission(), '文件夹需要重新授权，请点击“重新授权”。');
    const meta = validateMeta(JSON.parse(await readFile(this.directory, META_FILE)));
    const items = await this.directory.getDirectoryHandle('items');
    const records = [...(meta.entries || [])];
    const ignored = new Set([...records.map(entry => entry.id), ...(meta.deleted || []).map(item => item.entry.id)]);
    const issues = []; const names = [];
    for await (const handle of items.values()) {
      names.push(handle.name);
      if (handle.kind !== 'directory' || !safeId(handle.name) || ignored.has(handle.name)) continue;
      try {
        const raw = await optionalFile(handle, 'entry.json');
        if (raw === null) continue;
        const entry = validateEntry(JSON.parse(raw), handle.name);
        assert(entry.schemaVersion !== 4, 'TXT 收藏应登记在收藏库配置中。'); records.push(entry);
      } catch (error) { if (['NotAllowedError', 'SecurityError'].includes(error.name)) throw error; issues.push({ id: handle.name, message: error.message }); }
    }
    const entries = [];
    for (const record of records) {
      try { entries.push(await this.readRecord(record)); }
      catch (error) { if (['NotAllowedError', 'SecurityError'].includes(error.name)) throw error; issues.push({ id: record.id, message: error.message }); }
    }
    this.meta = meta; this.entries = entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt)); this.issues = issues; this.fileNames = names;
    return this.entries;
  }
  mutate(action) {
    const run = async () => {
      assert(this.connected && await this.permission(), '请先连接收藏文件夹，或点击“重新授权”。');
      const execute = async () => { this.meta = validateMeta(JSON.parse(await readFile(this.directory, META_FILE))); return action(); };
      const locks = this.environment.navigator?.locks;
      return locks ? locks.request(`${PRODUCT}:${this.meta.libraryId}`, execute) : execute();
    };
    const result = this.queue.then(run, run); this.queue = result.catch(() => {}); return result;
  }
  async writeIndex(changes) {
    const next = { ...this.meta, schemaVersion: 2, entries: this.meta.entries || [], deleted: this.meta.deleted || [], ...changes, revision: this.meta.revision + 1 };
    validateMeta(next);
    const raw = JSON.stringify(next, null, 2);
    try { await writeFile(this.directory, META_FILE, raw); }
    catch (error) { if (await optionalFile(this.directory, META_FILE).catch(() => null) !== raw) throw error; }
    this.meta = next; return next;
  }
  async ensureCategory({ categoryId = UNFILED, newCategory = '' } = {}) {
    if (!newCategory.trim()) { assert(this.meta.categories.some(c => c.id === categoryId), '所选分类已经不存在，请重新选择。'); return categoryId; }
    const name = newCategory.trim(); assert(name.length <= 80, '分类名称最多 80 个字符。');
    const existing = this.meta.categories.find(c => normalized(c.name) === normalized(name)); if (existing) return existing.id;
    const category = { id: newId(), name }; await this.writeIndex({ categories: [...this.meta.categories, category] }); return category.id;
  }
  addCategory(name) { return this.mutate(() => this.ensureCategory({ newCategory: name })); }
  previewFileName(title, entryId) {
    const currentEntry = this.entries.find(entry => entry.id === entryId && entry.schemaVersion === 4);
    const current = currentEntry?.content.originalFile;
    if (currentEntry && title === currentEntry.title) return current;
    const base = titleFileBase(title); const name = `${base}.txt`;
    if (current && normalized(current) === normalized(name)) return current;
    const reserved = [...(this.meta?.entries || []), ...(this.meta?.deleted || []).map(item => item.entry)]
      .filter(entry => entry.schemaVersion === 4).flatMap(entry => [entry.content.originalFile, ...(entry.cleanup?.files || []).map(file => file.name)]);
    const occupied = new Set([...this.fileNames, ...reserved].map(normalized));
    let index = 2; let candidate = name;
    while (occupied.has(normalized(candidate))) { assert(index < 100000, '同名文件过多，请换个标题。'); candidate = `${base} (${index++}).txt`; }
    return candidate;
  }
  async getRecord(id) {
    assert(safeId(id), '收藏编号无效。');
    assert(!(this.meta.deleted || []).some(item => item.entry.id === id), '这条收藏已经删除。');
    const indexed = this.meta.entries?.find(entry => entry.id === id);
    if (indexed) return this.readRecord(indexed);
    const item = await (await this.directory.getDirectoryHandle('items')).getDirectoryHandle(id);
    return this.readRecord(validateEntry(JSON.parse(await readFile(item, 'entry.json')), id));
  }
  checkExpected(entry, options) {
    if (options.expectedLibraryId != null) assert(options.expectedLibraryId === this.meta.libraryId, '操作期间更换了收藏库，尚未保存。请连接原收藏文件夹后重试。');
    if (options.expectedToken != null) assert(options.expectedToken === editToken(entry), '这条收藏已在别处修改，请取消并重新读取；当前草稿尚未保存。');
  }
  async makeFlat(entry, original, title, filename, categoryId = entry.categoryId) {
    const now = new Date().toISOString();
    const record = { ...recordOnly(entry), schemaVersion: 4, title, categoryId, updatedAt: now,
      source: compactSource(entry.source), content: { originalFile: filename, originalSha256: await digest(original), pages: pageIndex(original), warnings: [] } };
    const cleanup = entry.schemaVersion === 4 ? entry.cleanup && { ...entry.cleanup, files: [...entry.cleanup.files] }
      : { files: [], legacy: recordOnly(entry) };
    if (entry.schemaVersion === 4 && filename !== entry.content.originalFile) {
      record.cleanup = cleanup || { files: [] };
      record.cleanup.files.push({ name: entry.content.originalFile, sha256: entry.content.originalSha256 });
    } else if (cleanup) record.cleanup = cleanup;
    else delete record.cleanup;
    validateEntry(record, record.id); return record;
  }
  async writeRecord(record, original, newFile, writeBody = true) {
    const items = await this.directory.getDirectoryHandle('items');
    try {
      if (writeBody) await writeFile(items, record.content.originalFile, original);
      const entries = [...(this.meta.entries || []).filter(entry => entry.id !== record.id), record];
      await this.writeIndex({ entries });
    } catch (error) {
      if (newFile) {
        // Remove only the new file created for this attempt, never an existing user file.
        const disk = await optionalFile(this.directory, META_FILE).catch(() => null);
        let committed = false;
        try { committed = JSON.parse(disk)?.entries?.some(entry => entry.id === record.id && entry.content.originalFile === record.content.originalFile); } catch { /* Unknown result: keep the file. */ }
        if (disk && !committed) {
          const value = await optionalFile(items, record.content.originalFile).catch(() => null);
          if (value === '' || value === original) await removeIfPresent(items, record.content.originalFile).catch(() => {});
        }
      } else if (writeBody) {
        const value = await optionalFile(items, record.content.originalFile).catch(() => null);
        if (value === original) throw new Error('正文已写入 TXT，但收藏记录更新失败。请重新读取，打开编辑后再次确认保存以补全记录。', { cause: error });
      }
      throw error;
    }
    let active = record; let cleanupPending = false;
    if (record.cleanup) { try { active = await this.finishCleanup(record); } catch { cleanupPending = true; } }
    const entry = { ...active, original };
    this.entries = [entry, ...this.entries.filter(item => item.id !== entry.id)].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    await this.refreshNames(); return { entry, cleanupPending };
  }
  async refreshNames() {
    this.fileNames = [];
    for await (const handle of (await this.directory.getDirectoryHandle('items')).values()) this.fileNames.push(handle.name);
  }
  save(draft, options) {
    return this.mutate(async () => {
      assert(typeof draft.original === 'string', '收藏草稿缺少原文。'); await this.load();
      const source = compactSource(draft.source); const hash = await digest(draft.original);
      const duplicate = this.entries.find(entry => { const other = compactSource(entry.source); return entry.content.originalSha256 === hash &&
        other.chatId === source.chatId && other.characterName === source.characterName && other.messageId === source.messageId; });
      if (duplicate) return { entry: duplicate, duplicate: true };
      const title = String(options.title || '').trim(); assert(title && title.length <= 160, '请填写标题，最多 160 个字符。');
      const categoryId = await this.ensureCategory(options); const now = new Date().toISOString();
      const record = { schemaVersion: 4, id: newId(), title, categoryId, savedAt: now, updatedAt: now, source,
        content: { originalFile: this.previewFileName(title), originalSha256: hash, pages: pageIndex(draft.original), warnings: [] } };
      validateEntry(record, record.id);
      return { ...await this.writeRecord(record, draft.original, true), duplicate: false };
    });
  }
  edit(id, options) {
    return this.mutate(async () => {
      const entry = await this.getRecord(id); this.checkExpected(entry, options);
      const title = String(options.title || '').trim(); assert(title && title.length <= 160, '请填写标题，最多 160 个字符。');
      const categoryId = await this.ensureCategory(options); await this.refreshNames();
      if (title === entry.title && entry.schemaVersion !== 4) {
        const item = await (await this.directory.getDirectoryHandle('items')).getDirectoryHandle(id);
        const next = { ...recordOnly(entry), categoryId, updatedAt: new Date().toISOString() };
        await writeFile(item, 'entry.json', JSON.stringify(next, null, 2));
        Object.assign(this.entries.find(item => item.id === id) || {}, next); return next;
      }
      const filename = title === entry.title && entry.schemaVersion === 4 ? entry.content.originalFile : this.previewFileName(title, id);
      const next = await this.makeFlat(entry, entry.original, title, filename, categoryId);
      return (await this.writeRecord(next, entry.original, entry.schemaVersion !== 4 || filename !== entry.content.originalFile,
        entry.schemaVersion !== 4 || filename !== entry.content.originalFile)).entry;
    });
  }
  async updateContent(id, original, options = {}) {
    assert(options.confirmed === true, '尚未确认保存，磁盘内容未修改。');
    assert(typeof original === 'string' && original.trim(), '收藏内容不能为空。');
    return this.mutate(async () => {
      assert(options.expectedLibraryId === this.meta.libraryId, '编辑期间更换了收藏库，尚未保存。');
      const entry = await this.getRecord(id); this.checkExpected(entry, options);
      const indexed = this.meta.entries?.find(item => item.id === id);
      if (original === entry.original && (!indexed || indexed.content.originalSha256 === entry.content.originalSha256)) return { entry, unchanged: true, cleanupPending: Boolean(entry.cleanup) };
      await this.refreshNames();
      const filename = entry.schemaVersion === 4 ? entry.content.originalFile : this.previewFileName(entry.title);
      const next = await this.makeFlat(entry, original, entry.title, filename); next.editedAt = new Date().toISOString();
      return { ...await this.writeRecord(next, original, entry.schemaVersion !== 4, original !== entry.original || entry.schemaVersion !== 4), unchanged: false };
    });
  }
  async removeLegacy(record) {
    const items = await this.directory.getDirectoryHandle('items'); let item;
    try { item = await items.getDirectoryHandle(record.id); } catch (error) { if (error.name === 'NotFoundError') return; throw error; }
    const marker = await optionalFile(item, 'entry.json');
    if (marker) assert(editToken(validateEntry(JSON.parse(marker), record.id)) === editToken(record), '旧收藏已变化，已停止清理，请重新读取。');
    const cleanFiles = async (directory, names, verify = true) => {
      const text = await optionalFile(directory, names.originalFile);
      if (verify && text !== null) assert(await digest(text) === record.content.originalSha256, '旧 TXT 已被外部修改，已保留，请检查文件夹。');
      await removeIfPresent(directory, names.originalFile); await removeIfPresent(directory, names.renderedFile);
      let pages;
      try { pages = await directory.getDirectoryHandle('pages'); } catch (error) { if (error.name !== 'NotFoundError') throw error; }
      if (pages) {
        for (const name of names.pageFiles) await removeIfPresent(pages, name.slice(6));
        let empty = true; for await (const handle of pages.values()) { empty = false; break; }
        if (empty) await removeIfPresent(directory, 'pages');
      }
    };
    if (!record.content.storageId) await cleanFiles(item, contentFileNames(record.content.fileBase, record.content.pages.length));
    if (record.cleanup?.legacyPageCount >= 0) await cleanFiles(item, contentFileNames(record.cleanup.legacyFileBase, record.cleanup.legacyPageCount), false);
    let content;
    try { content = await item.getDirectoryHandle('content'); } catch (error) { if (error.name !== 'NotFoundError') throw error; }
    if (content) {
      for await (const directory of content.values()) {
        if (directory.kind !== 'directory' || !safeId(directory.name)) continue;
        const raw = await optionalFile(directory, '.owned.json'); let owner;
        try { owner = JSON.parse(raw); } catch { continue; }
        if (owner?.product === PRODUCT && owner.entryId === record.id && owner.storageId === directory.name) {
          if (directory.name === record.content.storageId) {
            const original = await optionalFile(directory, record.content.originalFile);
            if (original !== null) assert(await digest(original) === record.content.originalSha256, '旧内容已被外部修改，已停止清理。');
          }
          await content.removeEntry(directory.name, { recursive: true });
        }
      }
      let empty = true; for await (const handle of content.values()) { empty = false; break; }
      if (empty) await item.removeEntry('content');
    }
    for await (const handle of item.values()) assert(handle.name === 'entry.json', '旧目录内有额外文件，已保留；请自行检查后重试清理。');
    await removeIfPresent(item, 'entry.json'); await items.removeEntry(record.id);
  }
  async removeFlatFiles(entry, includeCurrent = false) {
    const files = [...(entry.cleanup?.files || [])];
    if (includeCurrent) files.push({ name: entry.content.originalFile, sha256: entry.content.originalSha256 });
    const items = await this.directory.getDirectoryHandle('items');
    for (const file of files) {
      assert(!(this.meta.entries || []).some(other => normalized(other.content.originalFile) === normalized(file.name)), '文件仍被收藏引用，已停止清理。');
      const original = await optionalFile(items, file.name);
      if (original !== null) { assert(await digest(original) === file.sha256, '文件已被外部修改，已停止清理，请检查后重试。'); await items.removeEntry(file.name); }
    }
    if (entry.cleanup?.legacy) await this.removeLegacy(entry.cleanup.legacy);
  }
  async finishCleanup(record) {
    if (!record.cleanup) return record;
    await this.removeFlatFiles(record);
    const clean = { ...record }; delete clean.cleanup;
    await this.writeIndex({ entries: this.meta.entries.map(entry => entry.id === record.id ? clean : entry) }); return clean;
  }
  cleanupContent(id) {
    return this.mutate(async () => {
      const entry = await this.getRecord(id);
      assert(entry.schemaVersion === 4, '请先把旧收藏整理为 TXT。');
      const clean = await this.finishCleanup(recordOnly(entry));
      this.entries = this.entries.map(value => value.id === id ? { ...clean, original: entry.original } : value);
      await this.refreshNames(); return clean;
    });
  }
  async migrate(options = {}) {
    assert(options.confirmed === true, '尚未确认整理，文件未修改。');
    return this.mutate(async () => {
      assert(options.expectedLibraryId === this.meta.libraryId, '整理期间更换了收藏库，已停止。');
      await this.load(); const ids = this.entries.filter(entry => entry.schemaVersion !== 4).map(entry => entry.id);
      let converted = 0; let cleanupPending = 0;
      for (const id of ids) {
        const entry = await this.getRecord(id); await this.refreshNames();
        const next = await this.makeFlat(entry, entry.original, entry.title, this.previewFileName(entry.title));
        const result = await this.writeRecord(next, entry.original, true); converted++;
        if (result.cleanupPending) cleanupPending++;
      }
      return { converted, cleanupPending };
    });
  }
  async delete(id, options = {}) {
    assert(options.confirmed === true, '尚未确认删除，本地文件未修改。');
    return this.mutate(async () => {
      assert(options.expectedLibraryId === this.meta.libraryId, '删除期间更换了收藏库，已停止。');
      const entry = await this.getRecord(id); this.checkExpected(entry, options);
      await this.writeIndex({ entries: (this.meta.entries || []).filter(item => item.id !== id),
        deleted: [...(this.meta.deleted || []), { entry: recordOnly(entry), deletedAt: new Date().toISOString() }] });
      this.entries = this.entries.filter(item => item.id !== id);
      await this.finishDeletions(); await this.refreshNames(); return { cleanupPending: this.pendingDeleteCount > 0 };
    });
  }
  async finishDeletions() {
    for (const tombstone of [...(this.meta.deleted || [])]) {
      try {
        if (tombstone.entry.schemaVersion === 4) await this.removeFlatFiles(tombstone.entry, true);
        else await this.removeLegacy(tombstone.entry);
        await this.writeIndex({ deleted: this.meta.deleted.filter(item => item.entry.id !== tombstone.entry.id) });
      } catch { /* Keep the pending operation visible for an explicit retry. */ }
    }
  }
  retryDeletions() { return this.mutate(async () => { await this.finishDeletions(); await this.refreshNames(); return this.pendingDeleteCount; }); }
  async readPage(entry, index = -1) {
    validateEntry(entry, entry.id);
    if (entry.schemaVersion === 4) {
      const original = await readFile(await this.directory.getDirectoryHandle('items'), entry.content.originalFile);
      assert(await digest(original) === entry.content.originalSha256, 'TXT 内容已变化，请重新读取文件夹。');
      if (index === -1) return plainPreview(original);
      const pages = extractHtmlPages(original); assert(Number.isInteger(index) && index >= 0 && index < pages.length, '页面编号无效。'); return pages[index].html;
    }
    const item = await (await this.directory.getDirectoryHandle('items')).getDirectoryHandle(entry.id);
    const directory = await legacyContent(item, entry);
    if (index === -1) return readFile(directory, entry.content.renderedFile);
    assert(Number.isInteger(index) && index >= 0 && index < entry.content.pages.length, '页面编号无效。');
    return readFile(await directory.getDirectoryHandle('pages'), entry.content.pages[index].file.slice(6));
  }
}

class DirectoryMemory {
  constructor(environment) { this.environment = environment; }
  async database() {
    return new Promise((resolve, reject) => {
      const request = this.environment.indexedDB.open(`${PRODUCT}-directory`, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('preferences');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async access(mode, action) {
    const db = await this.database();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('preferences', mode);
        const request = action(transaction.objectStore('preferences'));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('无法记住文件夹。'));
      });
    } finally { db.close(); }
  }
  get() { return this.access('readonly', store => store.get('directory')); }
  set(directory) { return this.access('readwrite', store => store.put(directory, 'directory')); }
}


// src/capture.js

function captureFloor(host, messageId) {
  assert(Number.isSafeInteger(messageId) && messageId >= 0, '请输入有效的楼层编号，例如 12。');
  const context = host.context();
  const chatId = String(context.getCurrentChatId?.() || context.chatId || '');
  assert(chatId, '请先打开一段聊天，再收藏楼层。');
  const message = host.readMessage(messageId);
  assert(message && message.message_id === messageId, '没有找到这个楼层，请检查编号。');
  const swipeId = Number.isSafeInteger(message.swipe_id) ? message.swipe_id : 0;
  const original = message.message;
  assert(typeof original === 'string', '没有取得当前消息版本的原文。');
  const isGroup = Boolean(context.groupId);
  const character = context.characters?.[context.characterId];
  const group = Array.isArray(context.groups) ? context.groups.find(g => String(g.id) === String(context.groupId)) : null;
  let origin = '';
  try { origin = host.window.location.origin; } catch { /* Optional relative resource base. */ }
  const source = {
    chatId, chatName: chatId.replace(/\.jsonl$/i, ''), messageId, swipeId,
    characterOrGroupId: String(isGroup ? `group:${context.groupId}` : (character?.avatar || context.characterId || '')),
    characterOrGroupName: String(isGroup ? (group?.name || '') : (character?.name || context.name2 || '')),
    speakerName: String(message.name || ''), role: String(message.role || ''),
    capturedAt: new Date().toISOString(), origin,
    tavernVersion: host.versions.tavern, helperVersion: host.versions.helper, vaultVersion: VERSION,
  };
  const warnings = [];
  // Copy only. Re-running macro/format APIs can execute write-capable macros.
  const processed = original;
  let pages = extractHtmlPages(original);
  let rendered = '';
  try {
    const displayed = host.displayedMessage?.(messageId);
    if (displayed) {
      const clone = displayed.cloneNode(true);
      clone.querySelectorAll('[data-tv-owned]').forEach(node => node.remove());
      const originals = Array.from(displayed.querySelectorAll('iframe'));
      const clones = Array.from(clone.querySelectorAll('iframe'));
      const extractFrames = pages.length === 0;
      originals.forEach((frame, index) => {
        let html = frame.getAttribute('srcdoc');
        if (!html && extractFrames) {
          try { html = frame.contentDocument?.documentElement?.outerHTML || ''; } catch { /* Cross-origin. */ }
        }
        const savedPage = pages[index]?.html || html;
        if (savedPage && clones[index]) {
          clones[index].removeAttribute('src');
          clones[index].setAttribute('srcdoc', savedPage);
          clones[index].setAttribute('sandbox', 'allow-scripts');
          if (extractFrames && html) pages.push({ html, label: `页面 ${pages.length + 1}`, kind: 'displayed-frame' });
        }
      });
      rendered = clone.innerHTML;
    }
  } catch { warnings.push('未能复制当前显示快照，已保留原文和可提取的 HTML。'); }
  if (!rendered) {
    const escaped = original.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    rendered = `<pre style="white-space:pre-wrap">${escaped}</pre>`;
    warnings.push('此楼层没有可读取的显示快照，已保存原文和可提取的 HTML；需要显示外观时，可先在聊天中显示此楼层后另存。');
  }
  if (pages.some(page => /\{\{/.test(page.html))) warnings.push('页面保留了原文中的酒馆宏；收藏不会为此重新执行宏，部分占位内容可能仍按源码显示。');
  if (pages.some(page => /(?:getVariables|SillyTavern|TavernHelper|\bMvu\b|generateRaw|window\.parent|window\.top)/.test(page.html))) {
    warnings.push('页面含酒馆或父窗口依赖；收藏预览只提供页面自身交互，这些功能可能无法运行。');
  }
  if (/(?:src|href)\s*=\s*["'](?:https?:)?\/\/|\bfetch\s*\(|@import\b/.test(processed)) {
    warnings.push('页面含外部资源或网络请求；资源尚未下载，离线时可能缺失。');
  }
  return { original, rendered, pages, source, warnings, suggestedTitle: titleFromText(original) };
}

function preparePreview(html, origin, document, editBridge = null) {
  const parser = new document.defaultView.DOMParser();
  const page = parser.parseFromString(html, 'text/html');
  page.querySelectorAll('base').forEach(base => base.remove());
  if (/^https?:\/\//.test(origin)) {
    const base = page.createElement('base');
    base.href = `${origin}/`;
    page.head.prepend(base);
  }
  const charset = page.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  page.head.prepend(charset);
  const style = page.createElement('style');
  style.textContent = 'html{color-scheme:light dark}body{margin:20px;font-family:system-ui,"Microsoft YaHei",sans-serif;line-height:1.8;overflow-wrap:anywhere}img,video,canvas,svg{max-width:100%}iframe{max-width:100%;border:0}pre{white-space:pre-wrap;overflow-wrap:anywhere}';
  page.head.prepend(style);
  if (editBridge && /^https?:\/\//.test(editBridge.targetOrigin)) {
    const bridge = page.createElement('script');
    const payload = JSON.stringify({ type: 'tavern-vault:edit-content', token: editBridge.token });
    const restorePayload = JSON.stringify({ type: 'tavern-vault:restore-reader', token: editBridge.token });
    bridge.textContent = `window.addEventListener('dblclick',event=>{if(event.isTrusted&&event.target instanceof Element&&!event.target.closest('button,a,input,textarea,select,summary,[role="button"],[contenteditable]'))window.parent.postMessage(${payload},${JSON.stringify(editBridge.targetOrigin)});},true);window.addEventListener('keydown',event=>{if(event.isTrusted&&event.key==='Escape'&&!event.defaultPrevented)window.parent.postMessage(${restorePayload},${JSON.stringify(editBridge.targetOrigin)});});`;
    page.head.prepend(bridge);
  }
  return `<!doctype html>\n${page.documentElement.outerHTML}`;
}


// src/selection.js

function normalizeTag(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const tag = text.replace(/^<\s*\/?\s*/, '').replace(/\s*\/?\s*>$/, '').trim();
  assert(/^[\p{L}_][\p{L}\p{N}_.:-]*$/u.test(tag), '请填写标签名，例如 content 或 <content>，不要填写属性或正则表达式。');
  return tag.toLowerCase();
}

function exclusionTags(value) {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(/[\s,，、;；]+/u);
  return [...new Set(parts.map(normalizeTag).filter(Boolean))];
}

// Match textual tags without parsing/reformatting the message as HTML. Keep byte-for-byte
// source slices, including fences, macros, attributes and line endings inside kept regions.
function tagRanges(text, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokens = new RegExp(`<\\s*(/?)\\s*${escaped}(?=[\\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>`, 'giu');
  const ranges = [];
  let start = null;
  let depth = 0;
  for (const match of text.matchAll(tokens)) {
    const closing = Boolean(match[1]);
    const selfClosing = /\/\s*>$/.test(match[0]);
    if (closing) {
      assert(depth > 0, `标签 <${tag}> 没有正确配对，请检查原回复后再收藏。`);
      depth--;
      if (depth === 0) {
        ranges.push({ start: start.index, innerStart: start.end, innerEnd: match.index, end: match.index + match[0].length });
        start = null;
      }
    } else if (selfClosing) {
      if (depth === 0) ranges.push({ start: match.index, innerStart: match.index + match[0].length, innerEnd: match.index + match[0].length, end: match.index + match[0].length });
    } else {
      if (depth === 0) start = { index: match.index, end: match.index + match[0].length };
      depth++;
    }
  }
  assert(depth === 0, `标签 <${tag}> 没有闭合，请检查原回复后再收藏。`);
  return ranges;
}

function selectContent(text, options = {}) {
  assert(typeof text === 'string', '没有取得可筛选的原文。');
  const includeTag = normalizeTag(options.includeTag);
  const excludeTags = exclusionTags(options.excludeTags);
  const active = Boolean(includeTag || excludeTags.length);
  let result = text;
  let includedCount = 0;
  if (includeTag) {
    const includes = tagRanges(text, includeTag);
    assert(includes.length, `没有找到 <${includeTag}> 标签，尚未保存。请修改标签名或清空提取规则。`);
    includedCount = includes.length;
    result = includes.map(range => text.slice(range.innerStart, range.innerEnd)).join('\n\n');
  }
  const removed = excludeTags.flatMap(tag => tagRanges(result, tag)).sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const range of removed) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ start: range.start, end: range.end });
  }
  let kept = '';
  let position = 0;
  for (const range of merged) { kept += result.slice(position, range.start); position = range.end; }
  result = kept + result.slice(position);
  assert(!active || result.trim(), '筛选后没有可收藏的内容，请调整提取或排除标签。');
  return { text: result, active, rules: { includeTag, excludeTags, includedCount, excludedCount: merged.length } };
}

function selectDraft(draft, options = {}) {
  const selected = selectContent(draft.original, options);
  if (!selected.active) return draft;
  const escaped = selected.text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const pages = extractHtmlPages(selected.text);
  // Never reuse an unfiltered display snapshot or frame: those may contain excluded data.
  return {
    original: selected.text,
    rendered: `<pre style="white-space:pre-wrap">${escaped}</pre>`,
    pages,
    source: { ...draft.source, selection: selected.rules },
    warnings: [
      '此收藏按标签筛选后保存。显示快照根据筛选后的原文生成；独立 HTML 页面也只从筛选结果提取。',
      ...(pages.length ? ['页面自身交互可用；依赖酒馆或外部资源的功能可能无法运行。'] : []),
    ],
    suggestedTitle: titleFromText(selected.text),
  };
}


// src/host.js

function createTavernHost(mainWindow) {
  assert(mainWindow?.document?.body && typeof mainWindow.SillyTavern?.getContext === 'function',
    '储藏库需要由酒馆的扩展管理器加载。没有取得 SillyTavern.getContext。');
  const context = () => {
    const value = mainWindow.SillyTavern.getContext();
    assert(Array.isArray(value?.chat), '无法取得酒馆当前聊天。请更新酒馆后重试。');
    return value;
  };
  const initial = context();
  const events = initial.eventTypes || initial.event_types;
  assert(typeof initial.eventSource?.on === 'function' && typeof initial.eventSource?.removeListener === 'function' && events?.CHAT_CHANGED,
    '酒馆缺少聊天事件接口。请使用支持原生扩展生命周期的酒馆版本。');
  return {
    window: mainWindow, document: mainWindow.document, context, events,
    versions: { tavern: '', helper: null },
    lastMessageId: () => context().chat.length - 1,
    readMessage(id) {
      const message = context().chat[id];
      if (!message) return null;
      return { message_id: id, message: message.mes, name: message.name || '',
        role: message.is_user ? 'user' : message.extra?.type === 'narrator' ? 'system' : 'assistant',
        swipe_id: Number.isSafeInteger(message.swipe_id) && message.swipe_id >= 0 ? message.swipe_id : 0 };
    },
    displayedMessage(id) {
      if (!Number.isSafeInteger(id) || id < 0) return null;
      return mainWindow.document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);
    },
    subscribe(event, listener) {
      initial.eventSource.on(event, listener);
      return () => initial.eventSource.removeListener(event, listener);
    },
  };
}

function installEntrances(host, ui) {
  const doc = host.document;
  const disposers = [];
  const ownedButtons = new Set();
  let settingsRow;
  let scheduled = null;
  let destroyed = false;
  function addEntrances() {
    scheduled = null;
    if (destroyed) return;
    doc.querySelectorAll('#chat .mes[mesid]').forEach(message => {
      if (message.querySelector('[data-tv-owned="floor"]')) return;
      const id = Number(message.getAttribute('mesid'));
      if (!Number.isSafeInteger(id) || id < 0) return;
      const controls = message.querySelector('.mes_buttons') || message.querySelector('.mes_text');
      if (!controls) return;
      const button = doc.createElement('button');
      button.type = 'button';
      button.dataset.tvOwned = 'floor';
      button.title = `收藏楼层 #${id}`;
      button.setAttribute('aria-label', button.title);
      button.textContent = '☆ 收藏';
      button.style.cssText = 'appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:28px;margin:3px 5px;padding:3px 9px;border:1px solid currentColor;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;opacity:.85;';
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); ui.collect(id, button); });
      controls.append(button);
      ownedButtons.add(button);
    });
    for (const button of ownedButtons) if (!button.isConnected) ownedButtons.delete(button);
    const settings = doc.querySelector('#extensions_settings2') || doc.querySelector('#extensions_settings');
    if (settings && !settingsRow?.isConnected) {
      settingsRow = doc.createElement('div');
      settingsRow.id = 'tavern-vault-settings';
      settingsRow.dataset.tvOwned = 'settings';
      settingsRow.style.cssText = 'display:flex;align-items:center;width:100%;min-width:0;box-sizing:border-box;';
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'menu_button';
      // The host uses width:min-content for menu_button; keep this CJK label on one line.
      button.style.cssText = 'display:inline-flex;flex:0 0 auto;width:auto;min-width:max-content;white-space:nowrap;writing-mode:horizontal-tb;';
      button.textContent = '储藏库 · 打开收藏';
      button.setAttribute('aria-label', '从扩展设置打开储藏库');
      button.addEventListener('click', () => ui.open(button));
      settingsRow.append(button);
      settings.append(settingsRow);
    }
  }
  function schedule() {
    if (scheduled === null && !destroyed) scheduled = host.window.requestAnimationFrame(addEntrances);
  }
  const observer = new host.window.MutationObserver(schedule);
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['mesid'] });
  disposers.push(() => observer.disconnect());
  for (const name of ['APP_READY', 'CHAT_CHANGED', 'USER_MESSAGE_RENDERED', 'CHARACTER_MESSAGE_RENDERED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED', 'MORE_MESSAGES_LOADED']) {
    if (host.events[name]) disposers.push(host.subscribe(host.events[name], schedule));
  }
  addEntrances();
  return () => {
    destroyed = true;
    if (scheduled !== null) host.window.cancelAnimationFrame(scheduled);
    disposers.forEach(stop => stop());
    ownedButtons.forEach(button => button.remove());
    settingsRow?.remove();
  };
}

function reportStartupError(mainWindow, error) {
  const text = `储藏库未能启动：${friendlyError(error)}`;
  if (mainWindow.toastr?.error) mainWindow.toastr.error(text);
  else if (mainWindow.document?.body) {
    mainWindow.document.getElementById('tavern-vault-error')?.remove();
    const message = mainWindow.document.createElement('p');
    message.id = 'tavern-vault-error';
    message.setAttribute('role', 'alert');
    message.textContent = text;
    mainWindow.document.body.append(message);
  } else console.error(`${PRODUCT}: startup failed`);
}


// src/ui.js

const ICON_PATHS = {
  shelf: '<path d="M4 4h16v16H4zM4 12h16M8 4v8m5-8v8m4 2v6M8 14v6"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
  folder: '<path d="M3 7h7l2-3h8a1 1 0 0 1 1 1v14H3z"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 10a8 8 0 1 0-1 7M20 4v6h-6"/>',
  arrow: '<path d="m10 5-7 7 7 7M3 12h18"/>',
  expand: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.bookmark}</svg>`;
}

const SHELL = `
<button class="launcher" data-action="open" type="button" aria-label="打开储藏库">${icon('shelf')}<span>储藏库</span></button>
<div class="veil" hidden>
  <section class="surface" role="dialog" aria-modal="true" aria-label="储藏库" tabindex="-1">
    <header class="topbar">
      <div class="brand"><span class="brand-icon">${icon('shelf')}</span><div><h1>储藏库</h1><p>把值得留下的片刻，妥善收藏。</p></div></div>
      <div class="top-actions">
        <button data-action="collect-number" type="button" class="soft">${icon('plus')}<span>收藏楼层</span></button>
        <button data-action="refresh" type="button" class="icon-button" title="重新读取文件夹" aria-label="重新读取文件夹">${icon('refresh')}</button>
        <button data-action="close" type="button" class="icon-button" title="关闭" aria-label="关闭储藏库">${icon('close')}</button>
      </div>
    </header>
    <div class="body">
      <aside class="sidebar">
        <div class="side-heading"><h2>我的收藏</h2><span class="count">0</span></div>
        <nav class="categories" aria-label="收藏分类"></nav>
        <button data-action="new-category" type="button" class="add-category">${icon('plus')}新建分类</button>
        <div class="folder-box">
          <span class="folder-icon">${icon('folder')}</span><h3 class="folder-name">还没有连接文件夹</h3>
          <p class="folder-status">收藏会保存在你选择的电脑文件夹里。</p>
          <button data-action="connect" type="button" class="connect">选择收藏文件夹</button>
          <button data-action="choose" type="button" class="change-folder" hidden>换个文件夹</button>
          <button data-action="migrate" type="button" class="connect" hidden>旧收藏整理为 TXT</button>
          <button data-action="retry-deletions" type="button" class="connect" hidden>重试清理已删除文件</button>
        </div>
      </aside>
      <section class="list-pane" aria-label="收藏列表">
        <div class="list-heading"><h2 class="filter-name">全部收藏</h2><span class="result-count"></span></div>
        <label class="search">${icon('search')}<input type="search" placeholder="搜索内容、标题或聊天" aria-label="搜索收藏" autocomplete="off"></label>
        <div class="items" role="list"></div>
      </section>
      <section class="reader" aria-label="收藏阅读区">
        <button class="restore-reader" data-action="restore-reader" type="button" aria-label="还原阅读区" title="还原阅读区" hidden>${icon('expand')}<span>还原</span></button>
        <div class="reader-empty">
          <div class="empty-illustration">${icon('bookmark')}<i></i><i></i><i></i></div>
          <h2>留住一段喜欢的对话</h2><p>连接收藏文件夹后，点击聊天楼层旁的“收藏”。<br>留下的文字和页面，都可以在这里慢慢读。</p>
          <button class="primary" data-action="connect" type="button">${icon('folder')}选择收藏文件夹</button>
        </div>
        <div class="reader-filled" hidden>
          <header class="reader-heading">
            <div class="reader-tools"><button data-action="back-list" type="button" class="text-button back-list">${icon('arrow')}返回列表</button><span class="reader-category"></span><div class="reader-secondary"><button data-action="edit-content" type="button" class="text-button">编辑内容</button><button data-action="edit" type="button" class="text-button">整理</button><button data-action="delete" type="button" class="text-button danger-button">删除收藏</button><button data-action="expand" type="button" class="icon-button" aria-label="展开正文" title="展开正文" aria-expanded="false" aria-controls="tv-content">${icon('expand')}</button></div></div>
            <div class="reader-title-row"><h2 class="reader-title"></h2><p class="reader-origin"></p></div><div class="cleanup-note" hidden><span>新内容已保存，旧文件清理尚未完成。</span><button type="button" data-action="cleanup-content" class="text-button">重试清理</button></div>
          </header>
          <div class="viewbar"><div role="tablist" aria-label="收藏查看方式"><button type="button" role="tab" data-view="page" aria-selected="true">页面</button><button type="button" role="tab" data-view="original" aria-selected="false">原文</button></div><button type="button" data-action="reload-page" class="text-button" title="重新运行当前页面" aria-label="重新运行当前页面">${icon('refresh')}</button></div>
          <div class="page-tools"><label>查看<select class="page-select" aria-label="选择 HTML 页面"></select></label><span>独立预览</span></div>
          <div class="content" role="tabpanel" tabindex="0"></div><div class="page-notes" hidden></div>
        </div>
      </section>
    </div>
    <footer class="statusbar"><span class="connection-dot"></span><span class="notice" role="status" aria-live="polite">请选择收藏文件夹。</span><span class="issue-count"></span></footer>
    <div class="sheet-veil" hidden>
      <form class="sheet" role="dialog" aria-modal="true" aria-labelledby="tv-sheet-title">
        <header><span class="sheet-symbol">${icon('bookmark')}</span><div><h2 id="tv-sheet-title">收藏楼层</h2><p class="sheet-intro">保存此刻的内容，以后随时重读。</p></div><button type="button" data-action="cancel-form" class="icon-button" aria-label="关闭收藏栏">${icon('close')}</button></header>
        <p class="draft-source"></p><p class="draft-summary"></p>
        <label class="field title-field"><span class="title-label">收藏标题</span><input class="title-input" required maxlength="160" autocomplete="off"><small class="file-hint"></small></label>
        <div class="category-fields"><label class="field">归入分类<select class="category-select"></select></label><button type="button" class="new-category-toggle text-button" data-action="toggle-category">${icon('plus')}新建分类</button><label class="field new-category-field" hidden>新分类名称<input class="new-category-input" maxlength="80" autocomplete="off" placeholder="例如：喜欢的剧情"></label></div>
        <section class="editor-fields" hidden>
          <p class="editor-help">编辑文字或 HTML 源码。点击“确认保存到本地”前只修改草稿；确认后替换本地内容，不保留旧版本。</p>
          <label class="field">收藏内容<textarea class="body-input" aria-label="编辑收藏内容" spellcheck="false" rows="14" required disabled></textarea></label>
          <p class="editor-state" role="status" aria-live="polite">内容尚未修改。</p>
        </section>
        <section class="selection-fields" aria-label="收藏内容筛选">
          <div class="selection-heading"><h3>只留下想收藏的部分</h3><span>可选 · 留空保存整楼</span></div>
          <div class="selection-inputs"><label class="field">只提取这个标签内的内容<input class="include-tag-input" autocomplete="off" placeholder="例如：<content>" aria-describedby="tv-selection-help"></label><label class="field">再排除这些标签及其内容<input class="exclude-tags-input" autocomplete="off" placeholder="例如：<image>，thinking" aria-describedby="tv-selection-help"></label></div>
          <p id="tv-selection-help" class="selection-help">先提取，再排除。提取标签本身不保存；多个同名片段一起保留。排除多个标签时，用逗号分隔。</p>
          <p class="selection-status" role="status" aria-live="polite"></p><pre class="selection-preview" tabindex="0" aria-label="待保存原文预览"></pre>
        </section>
        <div class="sheet-folder"><span class="sheet-folder-name">保存前，请先选择收藏文件夹。</span><button type="button" data-action="connect" class="text-button">选择 / 授权文件夹</button></div>
        <p class="form-error" role="alert" hidden></p>
        <footer><button type="button" data-action="cancel-form" class="secondary">取消</button><button type="submit" class="primary submit-button">保存到文件夹</button></footer>
      </form>
    </div>
    <div class="number-veil" hidden><form class="number-sheet" role="dialog" aria-modal="true" aria-labelledby="tv-number-title"><h2 id="tv-number-title">收藏指定楼层</h2><p>填写酒馆显示的楼层编号，暂未显示的旧楼层也可以收藏。</p><label class="field">楼层编号<input type="number" min="0" step="1" required class="floor-input"></label><p class="floor-error" role="alert" hidden></p><footer><button type="button" data-action="cancel-number" class="secondary">取消</button><button class="primary" type="submit">下一步</button></footer></form></div>
  </section>
</div>`;

class VaultUI {
  constructor(host, storage, memory, css) {
    this.host = host;
    this.storage = storage;
    this.memory = memory;
    this.category = '*';
    this.query = '';
    this.selectedId = null;
    this.view = 'page';
    this.pageIndex = 0;
    this.readerToken = 0;
    this.busy = false;
    this.mode = null;
    this.pendingDirectory = null;
    this.alive = true;
    this.connectionEpoch = 0;
    this.node = host.document.createElement('div');
    this.node.id = 'tavern-vault-root';
    this.node.dataset.version = VERSION;
    this.node.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
    this.root = this.node.attachShadow({ mode: 'open' });
    const style = host.document.createElement('style');
    style.textContent = css;
    this.root.append(style);
    const container = host.document.createElement('div');
    container.innerHTML = SHELL;
    this.root.append(container);
    host.document.body.append(this.node);
    this.root.addEventListener('click', event => this.onClick(event));
    this.root.addEventListener('keydown', event => this.onKey(event));
    this.root.addEventListener('dblclick', event => {
      if (event.target.closest('[data-entry],.reader-title,.content pre')) this.openContentEditor();
    });
    this.previewMessage = event => {
      const frame = this.$('.content iframe');
      if (this.alive && this.visible && !this.busy && this.$('.sheet-veil').hidden && event.origin === 'null' &&
        event.source === frame?.contentWindow && this.previewEditToken && event.data?.token === this.previewEditToken) {
        if (event.data.type === 'tavern-vault:edit-content') this.openContentEditor();
        if (event.data.type === 'tavern-vault:restore-reader' && this.$('.surface').classList.contains('expanded')) this.setExpanded(false);
      }
    };
    host.window.addEventListener('message', this.previewMessage);
    this.focusGuard = event => {
      if (!this.visible || !this.alive) return;
      const scope = this.focusScope();
      if (event.composedPath().includes(this.node) && scope.contains(this.root.activeElement)) return;
      const first = Array.from(scope.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]'))
        .find(element => element.getClientRects().length > 0);
      (first || scope).focus();
    };
    host.document.addEventListener('focusin', this.focusGuard, true);
    this.$('.search input').addEventListener('input', event => {
      this.query = event.target.value;
      this.renderList();
    });
    this.$('.page-select').addEventListener('change', event => {
      this.pageIndex = Number(event.target.value);
      this.readerKey = '';
      this.renderReader();
    });
    this.$('.body-input').addEventListener('input', () => {
      this.text('.editor-state', this.$('.body-input').value === this.contentBaseline ? '内容尚未修改。' : '草稿尚未保存，确认后才会更新本地文件。');
    });
    this.$('.title-input').addEventListener('input', () => { this.titleEdited = true; this.updateFilenamePreview(); });
    for (const selector of ['.include-tag-input', '.exclude-tags-input']) this.$(selector).addEventListener('input', () => this.updateSelection());
    this.$('.sheet').addEventListener('submit', event => { event.preventDefault(); this.submitForm(); });
    this.$('.number-sheet').addEventListener('submit', event => {
      event.preventDefault();
      if (this.busy) return;
      const id = Number(this.$('.floor-input').value);
      try {
        const draft = captureFloor(this.host, id);
        this.$('.number-veil').hidden = true;
        this.showForm('new', draft);
      } catch (error) { this.text('.floor-error', friendlyError(error)); this.$('.floor-error').hidden = false; }
    });
    this.render();
    this.$('.content').id = 'tv-content';
    this.root.querySelectorAll('[data-view]').forEach(button => {
      button.id = `tv-tab-${button.dataset.view}`;
      button.setAttribute('aria-controls', 'tv-content');
    });
  }

  $(selector) { return this.root.querySelector(selector); }
  text(selector, text) { this.$(selector).textContent = text; }
  get selected() { return this.storage.entries.find(entry => entry.id === this.selectedId); }
  get visible() { return !this.$('.veil').hidden; }

  notice(message, error = false) {
    this.text('.notice', message);
    this.$('.statusbar').classList.toggle('is-error', error);
  }

  async restore() {
    const epoch = this.connectionEpoch;
    try {
      const directory = await this.memory.get();
      if (!directory || !this.alive || epoch !== this.connectionEpoch) return;
      this.pendingDirectory = directory;
      if (await directory.queryPermission({ mode: 'readwrite' }) === 'granted') {
        await this.withBusy(async () => {
          await this.storage.attach(directory, false);
          this.pendingDirectory = null;
          this.notice('已从电脑文件夹读取收藏。');
        });
      } else this.notice('已记住收藏文件夹。点击“重新授权”即可继续读取。');
      this.render();
    } catch { this.notice('可以重新选择收藏文件夹；磁盘上的收藏不受影响。'); }
  }

  open(opener) {
    if (!this.visible) this.opener = opener || this.host.document.activeElement;
    this.$('.veil').hidden = false;
    this.$('.surface').focus();
    this.renderReader();
  }

  close() {
    if (this.busy) return;
    this.setExpanded(false, false);
    this.$('.veil').hidden = true;
    this.$('.sheet-veil').hidden = true;
    this.clearContentEditor();
    this.$('.number-veil').hidden = true;
    this.readerToken++;
    this.$('.content').replaceChildren();
    this.readerKey = '';
    this.opener?.focus?.();
  }

  async chooseDirectory(forcePicker = false) {
    if (this.busy) return;
    this.connectionEpoch++;
    const directory = this.pendingDirectory || this.storage.directory;
    let selection;
    try {
      // Invoke the permission prompt/picker directly in the original click task.
      if (!forcePicker && directory) {
        selection = directory.requestPermission({ mode: 'readwrite' }).then(state => {
          assert(state === 'granted', '文件夹授权未通过，收藏草稿仍保留。');
          return directory;
        });
      } else {
        assert(this.host.window.isSecureContext && typeof this.host.window.showDirectoryPicker === 'function',
          '当前环境不支持文件夹直读写。请用电脑 Chrome/Edge，并通过 localhost 或 HTTPS 打开酒馆。');
        selection = this.host.window.showDirectoryPicker({ id: 'tavern-vault', mode: 'readwrite' });
      }
    } catch (error) { this.showError(error); return; }
    await this.withBusy(async () => {
      const chosen = await selection;
      await this.storage.attach(chosen, true);
      this.pendingDirectory = null;
      this.$('.form-error').hidden = true;
      try { await this.memory.set(chosen); }
      catch { this.notice('文件夹已连接；浏览器未能记住入口，下次请重新选择同一文件夹。'); this.render(); return; }
      this.notice(`已连接“${chosen.name}”，收藏直接保存在这个电脑文件夹。`);
    });
  }

  showError(error) {
    const message = friendlyError(error);
    this.notice(message, true);
    if (!this.$('.sheet-veil').hidden) { this.text('.form-error', message); this.$('.form-error').hidden = false; }
    this.renderConnection();
  }

  async withBusy(action) {
    if (this.busy) return;
    this.busy = true;
    this.$('.surface').setAttribute('aria-busy', 'true');
    this.updateDisabled();
    try { await action(); }
    catch (error) { this.showError(error); }
    finally {
      this.busy = false;
      this.$('.surface').removeAttribute('aria-busy');
      if (this.alive) { this.updateDisabled(); this.render(); }
    }
  }

  updateDisabled() {
    this.root.querySelectorAll('button').forEach(button => { button.disabled = this.busy; });
    this.$('.body-input').disabled = this.busy || this.mode !== 'content';
    this.$('.submit-button').textContent = this.busy ? '正在处理…' : (this.mode === 'content' ? '确认保存到本地' : this.mode === 'category' ? '新建分类' : this.mode === 'edit' ? '保存整理' : '保存到文件夹');
  }

  async onClick(event) {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) {
      this.view = viewButton.dataset.view;
      this.readerKey = '';
      this.renderReader();
      return;
    }
    const item = event.target.closest('[data-entry]');
    if (item) {
      if (this.selectedId === item.dataset.entry && this.$('.surface').classList.contains('has-selection')) return;
      this.selectedId = item.dataset.entry;
      this.view = 'page';
      this.pageIndex = this.selected?.content.pages.length ? 0 : -1;
      this.$('.surface').classList.add('has-selection');
      // Keep list buttons mounted across the two clicks so native dblclick reaches the same target.
      this.root.querySelectorAll('[data-entry]').forEach(button => {
        const selected = button.dataset.entry === this.selectedId;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      this.renderReader();
      return;
    }
    const category = event.target.closest('[data-category]');
    if (category) { this.category = category.dataset.category; this.render(); return; }
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'open') { this.open(button); this.renderReader(); }
    if (action === 'close') this.close();
    if (action === 'connect') this.chooseDirectory(false);
    if (action === 'choose') this.chooseDirectory(true);
    if (action === 'refresh') {
      this.withBusy(async () => {
        await this.storage.load();
        this.readerKey = '';
        this.notice('已重新读取文件夹。');
      });
    }
    if (action === 'collect-number') {
      this.$('.number-veil').hidden = false;
      this.$('.floor-error').hidden = true;
      this.$('.floor-input').value = String(Math.max(0, this.host.lastMessageId()));
      this.$('.floor-input').focus();
    }
    if (action === 'cancel-number') { this.$('.number-veil').hidden = true; this.$('[data-action="collect-number"]').focus(); }
    if (action === 'cancel-form') this.hideForm();
    if (action === 'new-category') {
      if (!this.storage.connected) { this.notice('请先连接收藏文件夹，再新建分类。', true); return; }
      this.showForm('category');
    }
    if (action === 'toggle-category') {
      const area = this.$('.new-category-field');
      area.hidden = !area.hidden;
      this.$('.category-select').disabled = !area.hidden;
      if (!area.hidden) this.$('.new-category-input').focus();
    }
    if (action === 'delete' && this.selected) {
      const entry = this.selected;
      const options = { confirmed: true, expectedToken: editToken(entry), expectedLibraryId: this.storage.meta.libraryId };
      if (!this.host.window.confirm(`删除“${entry.title}”？\n确认后将删除这条收藏及对应本地文件，不保留旧版本。`)) return;
      this.withBusy(async () => {
        const result = await this.storage.delete(entry.id, options);
        this.selectedId = null; this.readerKey = ''; this.setExpanded(false, false);
        this.notice(result.cleanupPending ? '已移除收藏，本地文件尚未清理完；请点击“重试清理已删除文件”。' : '收藏及对应本地文件已删除。', result.cleanupPending);
      });
    }
    if (action === 'migrate') {
      const expectedLibraryId = this.storage.meta.libraryId;
      if (!this.host.window.confirm(`将 ${this.storage.legacyCount} 条旧收藏整理为 items/标题.txt？\n会保留原文、分类和简要来源，确认后清理旧目录及 HTML 副本。页面改由 TXT 中的代码生成，单独显示副本不再保留。`)) return;
      this.withBusy(async () => {
        const result = await this.storage.migrate({ confirmed: true, expectedLibraryId }); this.readerKey = '';
        this.notice(`已整理 ${result.converted} 条收藏为 TXT。${result.cleanupPending ? '部分旧文件尚未清理，请打开对应记录重试清理。' : '旧目录已清理。'}`, Boolean(result.cleanupPending));
      });
    }
    if (action === 'retry-deletions') this.withBusy(async () => {
      const remaining = await this.storage.retryDeletions();
      this.notice(remaining ? '仍有文件无法清理，请检查文件夹权限或文件是否被外部修改后重试。' : '已删除收藏的本地文件已清理。', Boolean(remaining));
    });
    if (action === 'edit-content') this.openContentEditor();
    if (action === 'cleanup-content' && this.selected) this.withBusy(async () => {
      await this.storage.cleanupContent(this.selected.id);
      this.readerKey = '';
      this.notice('旧内容已清理完成，只保留当前内容。');
    });
    if (action === 'edit' && this.selected) this.showForm('edit', this.selected);
    if (action === 'reload-page') { this.readerKey = ''; this.renderReader(); }
    if (action === 'expand') this.setExpanded(true);
    if (action === 'restore-reader') this.setExpanded(false);
    if (action === 'back-list') {
      this.setExpanded(false, false);
      this.$('.surface').classList.remove('has-selection');
      this.$('.search input').focus();
    }
  }

  setExpanded(expanded, restoreFocus = true) {
    const active = Boolean(expanded && this.selected);
    this.$('.surface').classList.toggle('expanded', active);
    this.$('.restore-reader').hidden = !active;
    this.$('[data-action="expand"]').setAttribute('aria-expanded', String(active));
    if (restoreFocus && this.visible && this.selected) this.$(active ? '.restore-reader' : '[data-action="expand"]').focus();
  }

  onKey(event) {
    if (!this.visible) return;
    if (event.target.matches('[role="tab"]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const tabs = Array.from(this.root.querySelectorAll('[data-view]'));
      const index = tabs.indexOf(event.target);
      const target = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      this.view = target.dataset.view;
      this.readerKey = '';
      this.renderReader();
      target.focus();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (this.busy) return;
      if (!this.$('.sheet-veil').hidden) this.hideForm();
      else if (!this.$('.number-veil').hidden) this.$('.number-veil').hidden = true;
      else if (this.$('.surface').classList.contains('expanded')) this.setExpanded(false);
      else this.close();
    }
    if (event.key === 'Tab') {
      const scope = this.focusScope();
      const focusable = Array.from(scope.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),iframe,[tabindex="0"]')).filter(element => element.getClientRects().length > 0);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (this.root.activeElement === first || !scope.contains(this.root.activeElement))) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && (this.root.activeElement === last || !scope.contains(this.root.activeElement))) { event.preventDefault(); first?.focus(); }
    }
  }

  focusScope() {
    return !this.$('.sheet-veil').hidden ? this.$('.sheet') : !this.$('.number-veil').hidden ? this.$('.number-sheet') : this.$('.surface');
  }

  collect(messageId, opener) {
    if (this.busy) { this.notice('正在保存当前内容，请稍候。'); return; }
    this.open(opener);
    try { this.showForm('new', captureFloor(this.host, messageId)); }
    catch (error) { this.showError(error); }
  }

  openContentEditor() {
    if (this.busy || !this.visible || !this.selected || !this.$('.sheet-veil').hidden || !this.$('.number-veil').hidden) return;
    this.showForm('content', this.selected);
  }

  clearContentEditor() {
    this.$('.body-input').value = '';
    this.contentBaseline = '';
    this.originalEditText = '';
    this.expectedEditToken = null;
    this.editLibraryId = null;
    if (this.mode === 'content') this.draft = null;
  }

  showForm(mode, draft = null) {
    this.formOpener = this.root.activeElement;
    this.mode = mode;
    this.draft = draft;
    this.$('.sheet').classList.toggle('content-editor', mode === 'content');
    this.$('.editor-fields').hidden = mode !== 'content';
    this.$('.title-field').hidden = mode === 'content';
    this.$('.body-input').value = mode === 'content' ? draft.original : '';
    this.contentBaseline = this.$('.body-input').value;
    this.originalEditText = mode === 'content' ? draft.original : '';
    this.expectedEditToken = ['content', 'edit'].includes(mode) ? editToken(draft) : null;
    this.editLibraryId = ['content', 'edit'].includes(mode) ? this.storage.meta?.libraryId : null;
    this.text('.editor-state', '内容尚未修改。');
    this.titleEdited = false;
    this.filteredDraft = null;
    this.selectionError = null;
    this.$('.include-tag-input').value = '';
    this.$('.exclude-tags-input').value = '';
    this.$('.selection-fields').hidden = mode !== 'new';
    this.$('.sheet-veil').hidden = false;
    this.$('.form-error').hidden = true;
    this.$('.new-category-field').hidden = true;
    this.$('.new-category-input').value = '';
    this.$('.category-select').disabled = false;
    this.$('.category-fields').hidden = mode === 'category' || mode === 'content';
    this.$('.draft-source').hidden = mode === 'category';
    this.$('.draft-summary').hidden = mode === 'category';
    this.text('#tv-sheet-title', mode === 'category' ? '新建分类' : mode === 'content' ? '编辑收藏内容' : mode === 'edit' ? '整理收藏' : '收藏楼层');
    this.text('.sheet-intro', mode === 'category' ? '给喜欢的内容一个安放的位置。' : mode === 'content' ? '确认保存后，同步到原收藏文件夹。' : '内容与来源一同保存，原聊天保持不变。');
    this.text('.title-label', mode === 'category' ? '分类名称' : '收藏标题');
    const input = this.$('.title-input');
    input.maxLength = mode === 'category' ? 80 : 160;
    input.value = mode === 'new' ? draft.suggestedTitle : ['edit', 'content'].includes(mode) ? draft.title : '';
    this.updateFilenamePreview();
    if (draft) {
      this.text('.draft-source', sourceLabel(draft.source));
      this.text('.draft-summary', `${compactSource(draft.source).characterName} · ${(draft.original || '').length.toLocaleString()} 字符`);
    }
    if (mode === 'new') this.updateSelection();
    this.populateCategorySelect(['edit', 'content'].includes(mode) ? draft.categoryId : this.category);
    this.renderConnection();
    this.updateDisabled();
    if (mode === 'content') this.$('.body-input').focus();
    else { input.focus(); input.select(); }
  }

  populateCategorySelect(selected) {
    const select = this.$('.category-select');
    const previous = selected || select.value;
    select.replaceChildren();
    for (const category of this.storage.meta?.categories || [{ id: UNFILED, name: '未分类' }]) {
      const option = this.host.document.createElement('option');
      option.value = category.id;
      option.textContent = category.name;
      select.append(option);
    }
    select.value = this.storage.meta?.categories.some(category => category.id === previous) ? previous : UNFILED;
  }

  hideForm() {
    if (this.busy) return;
    this.$('.sheet-veil').hidden = true;
    this.clearContentEditor();
    this.formOpener?.focus?.();
  }

  updateSelection() {
    if (this.mode !== 'new') return;
    try {
      this.filteredDraft = selectDraft(this.draft, { includeTag: this.$('.include-tag-input').value, excludeTags: this.$('.exclude-tags-input').value });
      this.selectionError = null;
      const draft = this.filteredDraft;
      const rules = draft.source.selection;
      this.$('.selection-status').classList.remove('invalid');
      this.text('.selection-status', rules ? `将保存 ${draft.original.length.toLocaleString()} 字符 · 提取 ${rules.includedCount} 段 · 排除 ${rules.excludedCount} 段` : `未设置筛选，将保存整楼 ${draft.original.length.toLocaleString()} 字符。`);
      this.text('.selection-preview', draft.original);
      if (!this.titleEdited) this.$('.title-input').value = draft.suggestedTitle;
      this.$('.form-error').hidden = true;
    } catch (error) {
      this.filteredDraft = null;
      this.selectionError = error;
      this.$('.selection-status').classList.add('invalid');
      this.text('.selection-status', friendlyError(error));
      this.text('.selection-preview', '规则尚未匹配有效内容，当前不能保存。');
      if (!this.titleEdited) this.$('.title-input').value = '未命名收藏';
    }
    this.updateFilenamePreview();
  }

  updateFilenamePreview() {
    this.$('.file-hint').hidden = !['new', 'edit'].includes(this.mode);
    const title = this.$('.title-input').value.trim();
    const file = this.mode === 'edit' && title === this.draft.title && this.draft.schemaVersion !== 4
      ? this.draft.content.originalFile : this.storage.previewFileName(title, this.mode === 'edit' ? this.draft.id : null);
    this.text('.file-hint', `本地原文：${this.mode === 'edit' && title === this.draft.title && this.draft.schemaVersion !== 4 ? '' : 'items/'}${file}`);
  }

  async submitForm() {
    if (this.busy) return;
    if (this.mode === 'new') {
      this.updateSelection();
      if (this.selectionError) { this.showError(this.selectionError); return; }
    }
    const title = this.$('.title-input').value.trim();
    const options = { title, categoryId: this.$('.category-select').value,
      newCategory: this.$('.new-category-field').hidden ? '' : this.$('.new-category-input').value };
    if (!this.$('.new-category-field').hidden && !options.newCategory.trim()) {
      this.showError(new Error('请填写新分类名称，或再次点击“新建分类”选择已有分类。')); return;
    }
    await this.withBusy(async () => {
      assert(this.storage.connected, '请先选择收藏文件夹，草稿会保留在这个收藏栏中。');
      if (this.mode === 'category') {
        assert(title, '请填写分类名称。');
        this.category = await this.storage.addCategory(title);
        this.notice('分类已保存到文件夹。');
      } else if (this.mode === 'content') {
        const input = this.$('.body-input').value;
        // Textareas normalize CRLF on read. Preserve the exact file if the visible text was not edited.
        const original = input === this.contentBaseline ? this.originalEditText : input;
        const result = await this.storage.updateContent(this.draft.id, original, { expectedToken: this.expectedEditToken, expectedLibraryId: this.editLibraryId, confirmed: true });
        this.selectedId = result.entry.id;
        this.category = '*';
        this.view = 'page';
        this.pageIndex = result.entry.content.pages.length ? 0 : -1;
        this.notice(result.unchanged ? '内容没有变化，本地文件未改动。' : result.cleanupPending ? '新内容已保存，但旧文件尚未清理完；请在阅读区重试清理。' : '修改已确认保存到本地，旧内容已清理。', result.cleanupPending);
        this.clearContentEditor();
      } else if (this.mode === 'edit') {
        const result = await this.storage.edit(this.draft.id, { ...options,
          expectedToken: this.expectedEditToken, expectedLibraryId: this.editLibraryId });
        this.category = '*';
        this.notice(result.cleanup ? '整理已保存，但旧文件尚未清理完；请在阅读区重试清理。'
          : result.schemaVersion === 4 ? '整理已保存，文件名与标题同步。' : '整理已保存。', Boolean(result.cleanup));
      } else {
        const result = await this.storage.save(this.filteredDraft, options);
        this.selectedId = result.entry.id;
        this.category = '*';
        this.view = 'page';
        this.pageIndex = result.entry.content.pages.length ? 0 : -1;
        this.$('.surface').classList.add('has-selection');
        this.notice(result.duplicate ? '这份内容已经收藏，为你打开已有记录。' : '已保存到电脑文件夹。');
      }
      this.query = '';
      this.$('.search input').value = '';
      this.readerKey = '';
      this.$('.sheet-veil').hidden = true;
      this.$('[data-action="collect-number"]').focus();
    });
  }

  renderConnection() {
    const directory = this.storage.directory || this.pendingDirectory;
    const connected = this.storage.connected;
    this.text('.folder-name', directory?.name || '还没有连接文件夹');
    this.text('.folder-status', connected ? '直接保存到此电脑文件夹。' : directory ? '重新授权后继续读取原有收藏。' : '收藏会保存在你选择的电脑文件夹里。');
    this.text('.connect', directory ? '重新授权' : '选择收藏文件夹');
    this.$('.change-folder').hidden = !directory;
    this.$('[data-action="migrate"]').hidden = !connected || !this.storage.legacyCount;
    this.$('[data-action="retry-deletions"]').hidden = !connected || !this.storage.pendingDeleteCount;
    this.$('.connection-dot').classList.toggle('connected', connected);
    this.text('.sheet-folder-name', connected ? `保存位置：${directory.name}` : '保存前，请先选择收藏文件夹。');
    this.$('.sheet-folder button').textContent = directory ? '重新授权' : '选择文件夹';
    this.$('.reader-empty .primary').hidden = connected;
    this.text('.issue-count', this.storage.issues.length ? `${this.storage.issues.length} 条损坏或未完成记录已略过` : '');
    this.$('.issue-count').title = this.storage.issues.map(item => `${item.id}: ${item.message}`).join('\n');
  }

  render() {
    this.renderConnection();
    this.text('.count', this.storage.entries.length);
    const nav = this.$('.categories');
    nav.replaceChildren();
    const categories = [{ id: '*', name: '全部收藏' }, ...(this.storage.meta?.categories || [{ id: UNFILED, name: '未分类' }])];
    if (!categories.some(category => category.id === this.category)) this.category = '*';
    for (const category of categories) {
      const button = this.host.document.createElement('button');
      button.type = 'button';
      button.dataset.category = category.id;
      button.className = this.category === category.id ? 'category active' : 'category';
      button.setAttribute('aria-pressed', String(this.category === category.id));
      const symbol = this.host.document.createElement('span');
      symbol.innerHTML = icon(category.id === '*' ? 'shelf' : 'folder');
      const name = this.host.document.createElement('span');
      name.className = 'category-name';
      name.textContent = category.name;
      const count = this.host.document.createElement('span');
      count.className = 'category-count';
      count.textContent = this.storage.entries.filter(entry => category.id === '*' || entry.categoryId === category.id).length;
      button.append(symbol, name, count);
      nav.append(button);
    }
    this.text('.filter-name', categories.find(category => category.id === this.category)?.name || '全部收藏');
    this.populateCategorySelect();
    this.renderList();
    this.updateDisabled();
  }

  renderList() {
    const query = normalized(this.query);
    const entries = this.storage.entries.filter(entry => (this.category === '*' || entry.categoryId === this.category) &&
      (!query || normalized([entry.title, entry.original, sourceLabel(entry.source), compactSource(entry.source).characterName].join('\n')).includes(query)));
    this.text('.result-count', `${entries.length} 条`);
    if (!entries.some(entry => entry.id === this.selectedId)) {
      this.selectedId = entries[0]?.id || null;
      this.pageIndex = this.selected?.content.pages.length ? 0 : -1;
      this.readerKey = '';
    }
    const list = this.$('.items');
    const scrollTop = list.scrollTop;
    list.replaceChildren();
    if (!entries.length) {
      const empty = this.host.document.createElement('div');
      empty.className = 'list-empty';
      const title = this.host.document.createElement('h3');
      title.textContent = query ? '没有找到匹配内容' : this.storage.connected ? '这里还没有收藏' : '等一段值得留下的对话';
      const text = this.host.document.createElement('p');
      text.textContent = query ? '换个关键词试试。' : this.storage.connected ? '点击楼层旁的“收藏”，或上方的“收藏楼层”。' : '先选择收藏文件夹，也可以连接已有收藏库。';
      empty.append(title, text);
      list.append(empty);
    }
    for (const entry of entries) {
      const row = this.host.document.createElement('div');
      row.setAttribute('role', 'listitem');
      const button = this.host.document.createElement('button');
      button.type = 'button';
      button.dataset.entry = entry.id;
      button.className = entry.id === this.selectedId ? 'item selected' : 'item';
      button.setAttribute('aria-pressed', String(entry.id === this.selectedId));
      const title = this.host.document.createElement('h3'); title.textContent = entry.title;
      const source = this.host.document.createElement('p'); source.className = 'item-source'; source.textContent = sourceLabel(entry.source);
      const excerpt = this.host.document.createElement('p'); excerpt.className = 'excerpt';
      const plainText = entry.original.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>|<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
        .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      excerpt.textContent = plainText && normalized(plainText) !== normalized(entry.title) ? plainText.slice(0, 100) : entry.content.pages.length ? `已保存 ${entry.content.pages.length} 个 HTML 页面，可在阅读区打开。` : plainText;
      const footer = this.host.document.createElement('div'); footer.className = 'item-footer';
      const type = this.host.document.createElement('span'); type.className = entry.content.pages.length ? 'type-tag html-tag' : 'type-tag';
      type.textContent = entry.content.pages.length ? 'HTML 页面' : '文字';
      const date = this.host.document.createElement('time'); date.dateTime = entry.savedAt;
      date.textContent = new Date(entry.savedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
      footer.append(type, date); button.append(title, source, excerpt, footer); row.append(button); list.append(row);
    }
    list.scrollTop = scrollTop;
    this.renderReader();
  }

  async renderReader() {
    if (!this.alive) return;
    const entry = this.selected;
    this.$('.reader-empty').hidden = Boolean(entry);
    this.$('.reader-filled').hidden = !entry;
    if (!entry) { this.setExpanded(false, false); this.readerToken++; this.$('.content').replaceChildren(); this.readerKey = ''; return; }
    this.$('.cleanup-note').hidden = !entry.cleanup;
    const key = `${entry.id}:${entry.updatedAt}:${entry.content.storageId || ''}:${this.view}:${this.pageIndex}`;
    if (key === this.readerKey) return;
    this.readerKey = key;
    const token = ++this.readerToken;
    this.previewEditToken = null;
    this.text('.reader-title', entry.title);
    this.text('.reader-category', this.storage.meta?.categories.find(category => category.id === entry.categoryId)?.name || '分类已缺失');
    const source = compactSource(entry.source);
    this.text('.reader-origin', `${source.chatId || '未取得聊天标识'} · ${source.characterName} · 楼层 #${source.messageId} · ${new Date(entry.savedAt).toLocaleString('zh-CN', { hour12: false })}`);
    this.root.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.view === this.view)));
    this.$('.page-tools').hidden = this.view !== 'page';
    this.$('[data-action="reload-page"]').hidden = this.view !== 'page';
    const content = this.$('.content');
    content.setAttribute('aria-labelledby', `tv-tab-${this.view}`);
    content.className = `content ${this.view}-view`;
    content.replaceChildren();
    this.$('.page-notes').hidden = true;
    if (this.view === 'original') {
      const pre = this.host.document.createElement('pre'); pre.textContent = entry.original; content.append(pre); return;
    }
    const select = this.$('.page-select'); select.replaceChildren();
    entry.content.pages.forEach((page, index) => {
      const option = this.host.document.createElement('option'); option.value = String(index); option.textContent = page.label; select.append(option);
    });
    const snapshot = this.host.document.createElement('option'); snapshot.value = '-1'; snapshot.textContent = entry.schemaVersion === 4 ? '文字预览' : '楼层显示快照'; select.append(snapshot);
    if (!entry.content.pages[this.pageIndex]) this.pageIndex = -1;
    select.value = String(this.pageIndex);
    const loading = this.host.document.createElement('p'); loading.className = 'loading'; loading.textContent = '正在读取页面…'; content.append(loading);
    try {
      const html = await this.storage.readPage(entry, this.pageIndex);
      if (!this.alive || token !== this.readerToken || !this.visible) return;
      const frame = this.host.document.createElement('iframe');
      frame.title = `${entry.title} — ${this.pageIndex === -1 ? '显示快照' : entry.content.pages[this.pageIndex].label}`;
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      this.previewEditToken = this.host.window.crypto.randomUUID();
      frame.srcdoc = preparePreview(html, entry.source.origin || '', this.host.document, { token: this.previewEditToken, targetOrigin: this.host.window.location.origin });
      content.replaceChildren(frame);
      const notes = entry.content.warnings || [];
      if (notes.length) { this.text('.page-notes', notes.join(' ')); this.$('.page-notes').hidden = false; }
    } catch (error) {
      if (token !== this.readerToken) return;
      content.replaceChildren();
      const message = this.host.document.createElement('p'); message.className = 'read-error';
      message.textContent = `${friendlyError(error)} 原文仍可切换查看。`;
      content.append(message);
    }
  }

  destroy() {
    this.alive = false;
    this.readerToken++;
    this.host.document.removeEventListener('focusin', this.focusGuard, true);
    this.host.window.removeEventListener('message', this.previewMessage);
    this.clearContentEditor();
    this.node.remove();
  }
}


// src/entry.js

let configuredCss = '';
let activeInstance;
function configureVault(css) { configuredCss = css; }

function startVault(css = configuredCss, mainWindow = window) {
  let ui;
  let stopEntrances;
  try {
    const host = createTavernHost(mainWindow);
    const instanceKey = '__tavernVaultInstance';
    host.window[instanceKey]?.destroy?.();
    host.document.getElementById('tavern-vault-error')?.remove();
    ui = new VaultUI(host, new VaultStorage(host.window), new DirectoryMemory(host.window), css);
    let destroyed = false;
    const instance = {
      destroy() {
        if (destroyed) return;
        destroyed = true;
        stopEntrances?.();
        ui.destroy();
        mainWindow.removeEventListener('pagehide', instance.destroy);
        if (host.window[instanceKey] === instance) delete host.window[instanceKey];
        if (activeInstance === instance) activeInstance = null;
      },
    };
    host.window[instanceKey] = instance;
    activeInstance = instance;
    mainWindow.addEventListener('pagehide', instance.destroy);
    stopEntrances = installEntrances(host, ui);
    // Restoration is asynchronous and never holds the extension activation hook open.
    queueMicrotask(() => { if (!destroyed) ui.restore(); });
    return instance;
  } catch (error) {
    stopEntrances?.();
    ui?.destroy();
    reportStartupError(mainWindow, error);
    return null;
  }
}

function onActivate() { startVault(); }
function onEnable() { startVault(); }
function onDisable() { activeInstance?.destroy(); }
function onDelete() { onDisable(); }

configureVault(":host{--paper:#faf8f3;--white:#fffefa;--ink:#253b32;--muted:#778077;--line:#e5e6dd;--green:#274d3d;--green-dark:#1e3c31;--gold:#c6a776;--soft:#edf0e7;--danger:#a24439;font-family:Inter,\"PingFang SC\",\"Microsoft YaHei\",system-ui,sans-serif;font-size:14px;color:var(--ink);line-height:1.55;color-scheme:light}\n*{box-sizing:border-box} [hidden]{display:none!important} button,input,select{font:inherit} button{cursor:pointer} button:disabled{cursor:wait;opacity:.5} button{transition:background .14s,color .14s,border-color .14s} button,select{touch-action:manipulation} h1,h2,h3,p{margin:0} svg{width:19px;height:19px;flex:0 0 auto;vertical-align:middle} input,select{min-width:0;max-width:100%;color:var(--ink)} button:focus-visible,input:focus-visible,select:focus-visible,[tabindex]:focus-visible{outline:3px solid #b9a16e;outline-offset:3px} button{border:0} :host ::selection{background:#dce4cc;color:#203a2c}\n.launcher{position:fixed;right:25px;bottom:96px;pointer-events:auto;display:flex;align-items:center;gap:9px;min-height:45px;padding:10px 18px;background:var(--green-dark);color:#fffbee;border:1px solid #ffffff38;border-radius:14px;box-shadow:0 4px 22px #132b3438;font-size:14px;letter-spacing:.06em}.launcher:hover{background:#38644d}.launcher svg{width:22px;height:22px}\n.veil{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;background:#11271f66;backdrop-filter:blur(7px);pointer-events:auto}.surface{position:relative;display:flex;flex-direction:column;width:min(1480px,96vw);height:min(890px,92dvh);min-height:300px;overflow:hidden;border:1px solid #fff8;border-radius:20px;background:var(--paper);box-shadow:0 20px 100px #0e211c55;animation:tv-enter .18s ease-out}.topbar{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:22px 28px 20px;border-bottom:1px solid var(--line);flex:0 0 auto;background:var(--white)}.brand{display:flex;align-items:center;gap:13px;min-width:0}.brand-icon{display:grid;place-items:center;width:43px;height:47px;background:var(--green);color:#eee6cd;border-radius:10px}.brand-icon svg{width:27px;height:27px}.brand h1{font-family:\"Noto Serif SC\",\"Songti SC\",SimSun,serif;font-size:25px;letter-spacing:.13em;font-weight:600;line-height:1.25}.brand p{font-size:12px;color:var(--muted);margin-top:5px;letter-spacing:.02em}.top-actions{display:flex;gap:11px;align-items:center;flex-shrink:0}.icon-button{display:inline-flex;align-items:center;justify-content:center;background:transparent;color:#6b776d;width:36px;height:36px;border-radius:9px;flex:0 0 auto}.icon-button:hover{background:#e9ede5;color:var(--green-dark)}.soft{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid #dfe4d9;background:#edf0e8;padding:8px 13px;border-radius:9px;color:var(--green);font-weight:550}.soft:hover{background:#dfe7d8}.body{display:grid;grid-template-columns:207px 300px minmax(0,1fr);flex:1;min-height:0;overflow:hidden}.sidebar{display:flex;flex-direction:column;min-width:0;min-height:0;padding:26px 14px 17px;background:var(--green-dark);color:#f0efdc}.side-heading{display:flex;align-items:center;gap:9px;padding:0 14px 18px}.side-heading h2{font-size:13px;font-weight:500;letter-spacing:.08em;color:#d8dfd1}.count{display:inline-flex;align-items:center;justify-content:center;min-width:21px;height:21px;padding:0 5px;border-radius:7px;background:#ffffff13;color:#e1e7d7;font-size:11px}.categories{overflow:auto;min-height:64px;max-height:52%;scrollbar-width:thin}.category{width:100%;display:flex;align-items:center;gap:9px;padding:10px 12px;margin-bottom:4px;border-radius:8px;color:#bdcdbf;background:transparent;text-align:left;min-height:42px}.category svg{width:17px;height:17px}.category:hover{background:#ffffff0b;color:#fff9e9}.category.active{background:#f4f1dd1c;color:#f4e8c8;box-shadow:inset 2px 0 #c7ae7b}.category-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.category-count{font-size:11px;color:#c4cebb}.add-category{display:flex;align-items:center;gap:9px;margin:6px 0 15px;padding:10px 12px;text-align:left;background:none;color:#bbcaba;font-size:12px}.add-category:hover{color:#fff3c8}.add-category svg{width:16px;height:16px}.folder-box{margin-top:auto;border-top:1px solid #ffffff1b;padding:22px 11px 0;color:#d4dfcd;min-width:0}.folder-icon{display:block;color:#cfb88b;margin-bottom:10px}.folder-icon svg{width:24px;height:24px}.folder-name{font-size:13px;font-weight:500;overflow-wrap:anywhere}.folder-status{font-size:11px;line-height:1.7;color:#a8bba9;margin-top:6px}.connect{width:100%;margin-top:15px;min-height:35px;padding:7px 8px;border:1px solid #819d7d66;border-radius:7px;background:#ffffff0c;color:#eef0df;font-size:12px}.connect:hover{background:#ffffff1a}.change-folder{display:block;margin:7px auto 0;padding:4px 8px;background:transparent;color:#b5c5b3;font-size:11px}.change-folder:hover{color:#fff0c5}.list-pane{display:flex;flex-direction:column;min-width:0;min-height:0;background:#f5f4ed;border-right:1px solid var(--line)}.list-heading{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:24px 21px 13px}.list-heading h2{font-size:16px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.result-count{font-size:11px;color:var(--muted);white-space:nowrap}.search{display:flex;gap:8px;align-items:center;background:var(--white);border:1px solid #e1e3d8;border-radius:9px;margin:0 17px 16px;padding:9px 11px;color:#8b9487}.search svg{width:16px;height:16px}.search input{border:0;background:transparent;outline:none!important;min-width:0;width:100%;font-size:12px}.search:focus-within{border-color:#8a9f7f;box-shadow:0 0 0 2px #a7b58a22}.search input::placeholder{color:#949a8e}.items{flex:1;overflow:auto;padding:0 11px 15px;scrollbar-width:thin;scrollbar-color:#c8cec0 transparent}.item{width:100%;display:block;border:1px solid transparent;padding:17px 14px 14px;margin-bottom:6px;border-radius:10px;background:transparent;color:var(--ink);text-align:left}.item:hover{background:#fffdf6}.item.selected{background:var(--white);border-color:#d4ddc9;box-shadow:0 2px 10px #2b4a3110}.item h3{font-size:14px;font-weight:600;line-height:1.6;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}.item-source{color:#638167;font-size:11px;line-height:1.7;margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.excerpt{margin-top:9px;color:#8c9183;font-size:11px;line-height:1.85;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}.item-footer{display:flex;justify-content:space-between;align-items:center;margin-top:15px;font-size:10px;color:#8b9385}.type-tag{color:#727d69;font-size:10px}.html-tag{color:#957c46}.html-tag:before{content:'◇';margin-right:4px}.list-empty{text-align:center;margin:48px 12px;color:#8b9487}.list-empty h3{font-size:13px;font-weight:500;color:#687662}.list-empty p{margin-top:9px;font-size:12px;line-height:1.8}.reader{min-width:0;min-height:0;position:relative;background:var(--white);overflow:hidden}.reader-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:35px;text-align:center}.empty-illustration{position:relative;display:grid;place-items:center;width:106px;height:114px;border-radius:20px;background:#eff1e6;border:1px solid #e3e6d6;color:#8d9e7c;transform:rotate(-5deg);margin-bottom:35px}.empty-illustration:after{content:'';position:absolute;inset:9px -10px -9px 10px;border:1px solid #dde2d0;border-radius:20px;z-index:-1;transform:rotate(11deg)}.empty-illustration svg{width:40px;height:40px;stroke-width:1.1}.empty-illustration i{position:absolute;bottom:20px;width:30px;height:1px;background:#c3cdb5}.empty-illustration i:nth-child(2){bottom:15px;width:22px}.empty-illustration i:nth-child(3){bottom:10px;width:26px}.reader-empty h2{font-family:\"Noto Serif SC\",\"Songti SC\",SimSun,serif;font-size:23px;font-weight:500;color:#4f624c;letter-spacing:.04em}.reader-empty p{font-size:13px;line-height:2;color:#8a9383;margin-top:15px}.reader-empty .primary{margin-top:26px}.reader-filled{height:100%;min-height:0;display:flex;flex-direction:column}.reader-heading{padding:21px 30px 22px;flex:0 0 auto;border-bottom:1px solid #eeeee5}.reader-tools{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:15px;min-height:30px}.reader-category{font-size:11px;color:#818b70;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.reader-secondary{display:flex;gap:8px;align-items:center;margin-left:auto}.reader-secondary .icon-button{width:30px;height:30px}.reader-secondary svg{width:16px;height:16px}.reader-title{font-family:\"Noto Serif SC\",\"Songti SC\",SimSun,serif;font-weight:600;font-size:clamp(20px,2vw,28px);line-height:1.55;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}.reader-origin{margin-top:11px;font-size:12px;color:#557b57;overflow-wrap:anywhere}.reader-date{margin-top:5px;font-size:11px;color:#8b9383;overflow-wrap:anywhere}.viewbar{display:flex;align-items:center;justify-content:space-between;padding:0 26px;border-bottom:1px solid var(--line);background:#fdfcf6;flex:0 0 auto;min-height:46px}.viewbar [role=tablist]{display:flex;gap:22px}.viewbar [role=tab]{font-size:12px;color:#8a9380;background:transparent;padding:13px 0 11px;border-bottom:2px solid transparent}.viewbar [role=tab][aria-selected=true]{color:var(--green);font-weight:600;border-color:#5e7e56}.viewbar [data-action=reload-page]{padding:4px 6px;color:#8c967f}.viewbar svg{width:15px;height:15px}.page-tools{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 25px;background:#f7f7ef;border-bottom:1px solid #e8ebdf;color:#8a9380;font-size:11px;flex:0 0 auto}.page-tools label{display:flex;gap:8px;align-items:center;min-width:0}.page-tools select{max-width:240px;border:0;background:transparent;color:#5b7351;font-size:11px;outline-offset:2px;padding:2px 14px 2px 0}.content{flex:1;min-width:0;min-height:0;overflow:auto;background:var(--white)}.content iframe{display:block;border:0;background:#fff;width:100%;height:100%;min-height:150px;color-scheme:light}.original-view{padding:26px 30px}.content pre{font:13px/2 ui-monospace,SFMono-Regular,Consolas,\"Microsoft YaHei\",monospace;white-space:pre-wrap;overflow-wrap:anywhere;color:#48513e;margin:0}.source-view{padding:25px 30px}.source-view dl{display:grid;grid-template-columns:100px minmax(0,1fr);gap:0;margin:0;font-size:12px}.source-view dt,.source-view dd{margin:0;padding:12px 0;border-bottom:1px solid #eeeee5;overflow-wrap:anywhere}.source-view dt{color:#92987e}.source-view dd{color:#4b6548}.source-note{margin-top:25px;font-size:12px;line-height:1.9;color:#879078}.loading,.read-error{padding:28px;color:#879078;font-size:13px}.read-error{color:var(--danger)}.page-notes{padding:10px 23px;background:#f5f2e7;border-top:1px solid #e9e3ce;font-size:11px;line-height:1.7;color:#87764e;max-height:88px;overflow:auto;flex:0 0 auto}.statusbar{display:flex;align-items:center;gap:8px;min-height:35px;padding:8px 23px;background:#f2f3ea;border-top:1px solid #dfe4d5;font-size:11px;color:#78876b;flex:0 0 auto}.connection-dot{width:6px;height:6px;border-radius:50%;background:#acb39d;flex:0 0 auto}.connection-dot.connected{background:#73935d}.notice{min-width:0;overflow-wrap:anywhere}.issue-count{font-size:10px;margin-left:auto;color:#9c7946;max-width:35%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.is-error{color:var(--danger)}.text-button{display:inline-flex;align-items:center;justify-content:center;gap:5px;background:transparent;color:#6c805d;padding:6px 1px;font-size:12px}.text-button:hover{color:#2c543c}.text-button svg{width:15px;height:15px}.primary,.secondary{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:40px;padding:9px 19px;font-size:13px;border:1px solid transparent;border-radius:8px}.primary{background:var(--green);color:#fcf9eb}.primary:hover{background:#376348}.secondary{background:#f4f3eb;border-color:#dfe3d5;color:#778568}.secondary:hover{background:#e9ecdf}.sheet-veil,.number-veil{position:absolute;inset:0;z-index:4;display:flex;align-items:center;justify-content:center;background:#18352670;backdrop-filter:blur(3px);padding:24px}.sheet,.number-sheet{width:min(100%,510px);max-height:100%;overflow:auto;padding:27px 30px 23px;background:var(--white);border:1px solid #fff7;border-radius:17px;box-shadow:0 15px 60px #132d2f35;animation:tv-enter .16s ease-out}.sheet>header{display:flex;align-items:center;gap:12px;margin-bottom:22px}.sheet>header>.icon-button{margin-left:auto;align-self:flex-start}.sheet h2,.number-sheet h2{font-family:\"Noto Serif SC\",\"Songti SC\",SimSun,serif;font-size:23px;font-weight:600;letter-spacing:.04em}.sheet-intro{font-size:11px;color:#8a9482;margin-top:5px}.sheet-symbol{width:42px;height:46px;border:1px solid #e3e6d7;border-radius:11px;background:#f0f2e6;color:#879871;display:grid;place-items:center;flex:0 0 auto}.sheet-symbol svg{width:24px;height:24px;stroke-width:1.3}.draft-source{font-size:13px;color:#52764b;background:#edf0e5;border:1px solid #e3e7d8;padding:13px 15px 4px;border-radius:8px 8px 0 0;overflow-wrap:anywhere}.draft-summary{font-size:11px;color:#889579;background:#edf0e5;border:1px solid #e3e7d8;border-top:0;padding:3px 15px 12px;border-radius:0 0 8px 8px;margin-bottom:22px;overflow-wrap:anywhere}.field{display:flex;flex-direction:column;gap:8px;font-size:12px;font-weight:500;color:#65765a;margin-bottom:17px}.field input,.field select{width:100%;min-height:42px;padding:10px 12px;border:1px solid #dce2d1;border-radius:7px;background:#fffefa;color:#3b5437;font-size:13px;outline-offset:2px}.field input::placeholder{color:#a2a992}.category-fields{position:relative;margin-bottom:17px}.category-fields>.field:first-child{margin-bottom:3px}.new-category-toggle{margin-left:auto;display:flex;font-size:11px;padding:8px 0}.new-category-field{margin-top:7px;margin-bottom:10px}.sheet-folder{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px dashed #dfe5d4;border-bottom:1px dashed #dfe5d4;padding:10px 0;color:#859278;font-size:11px;overflow-wrap:anywhere}.sheet-folder-name{min-width:0}.sheet-folder button{white-space:nowrap;font-size:11px}.sheet>footer,.number-sheet footer{display:flex;justify-content:flex-end;gap:10px;padding-top:23px}.form-error,.floor-error{margin-top:13px;border-radius:7px;padding:10px 12px;color:var(--danger);background:#faf0e9;font-size:12px;line-height:1.8}.number-sheet{max-width:420px}.number-sheet>p{font-size:12px;color:#87927b;line-height:1.8;margin:12px 0 23px}.number-sheet .floor-input{font-size:16px}.back-list{display:none}\n@keyframes tv-enter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}\n@media(min-width:1500px){.body{grid-template-columns:225px 320px minmax(0,1fr)}.reader-heading{padding-inline:38px}.topbar{padding-inline:30px}.sidebar{padding-inline:17px}}\n@media(max-width:1050px){.body{grid-template-columns:175px 250px minmax(0,1fr)}.sidebar{padding-inline:9px}.reader-heading{padding-inline:22px}.topbar{padding:17px 22px}.brand p{font-size:11px}.reader-title{font-size:21px}.viewbar{padding-inline:20px}.viewbar [role=tablist]{gap:15px}.page-tools{padding-inline:20px}.list-heading{padding-inline:17px}.search{margin-inline:12px}.item{padding:14px 11px}.items{padding-inline:7px}.brand h1{font-size:23px}}\n@media(max-width:820px){.veil{padding:12px}.surface{width:100%;height:94dvh;border-radius:15px}.body{grid-template-columns:175px minmax(0,1fr)}.reader{display:none}.has-selection .body{grid-template-columns:minmax(0,1fr)}.has-selection .sidebar,.has-selection .list-pane{display:none}.has-selection .reader{display:block}.back-list{display:inline-flex}.list-pane{border-right:0}.list-heading{padding:23px 25px 15px}.items{padding-inline:15px}.search{margin-inline:24px}.item{padding:20px}.excerpt{-webkit-line-clamp:2}.brand p{display:none}.topbar{padding:15px 19px}.brand-icon{width:36px;height:39px}.brand-icon svg{width:23px;height:23px}.brand h1{font-size:23px}.top-actions{gap:5px}.reader-heading{padding:15px 26px 22px}.reader-tools{margin-bottom:10px}.reader-title{font-size:25px}.folder-status{font-size:12px}.connect{min-height:40px}.statusbar{padding-inline:17px}.category{min-height:44px}}\n@media(max-width:480px){.veil{padding:0}.surface{height:100dvh;border-radius:0;border:0}.topbar{padding:13px 14px;gap:5px}.brand{gap:9px}.brand-icon{width:32px;height:36px;border-radius:8px}.brand h1{font-size:21px;letter-spacing:.08em}.soft{gap:3px;padding:8px;font-size:12px;min-height:36px}.top-actions{gap:2px}.top-actions .icon-button{width:32px}.body{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}.sidebar{display:grid;grid-template-columns:minmax(0,1fr) auto;padding:10px 14px;gap:4px;max-height:145px}.side-heading{display:none}.categories{display:flex;gap:5px;max-height:none;min-height:44px;overflow-x:auto;scrollbar-width:none}.category{width:auto;min-width:100px;padding:8px 10px;margin:0;font-size:12px}.category.active{box-shadow:inset 0 -2px #c7ae7b}.category-name{max-width:90px}.category-count{margin-left:1px}.category>span:first-child{display:none}.add-category{margin:0;padding:10px 3px;font-size:11px;white-space:nowrap}.folder-box{grid-column:1/-1;display:flex;align-items:center;gap:10px;padding:8px 0 0;margin:0;border-top-color:#ffffff14}.folder-icon,.folder-status,.change-folder{display:none}.folder-name{flex:1;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.connect{width:auto;padding:5px 11px;min-height:32px;margin:0;font-size:11px}.list-heading{padding:18px 20px 12px}.search{margin:0 20px 14px}.search input{font-size:13px}.items{padding-inline:10px}.item{padding:16px 14px;margin-bottom:5px}.item h3{font-size:15px}.item-source,.excerpt{font-size:12px}.has-selection .body{grid-template-rows:minmax(0,1fr)}.reader-heading{padding:12px 20px 18px}.reader-title{font-size:24px}.reader-date{font-size:11px}.reader-origin{font-size:12px}.viewbar{padding-inline:20px}.viewbar [role=tab]{font-size:13px}.content pre{font-size:13px}.original-view,.source-view{padding:22px 20px}.source-view dl{grid-template-columns:88px minmax(0,1fr)}.source-view dt,.source-view dd{font-size:12px}.page-tools{padding-inline:20px}.statusbar{font-size:10px;min-height:33px;padding:7px 14px;align-items:flex-start}.connection-dot{margin-top:5px}.issue-count{display:none}.sheet-veil,.number-veil{padding:14px}.sheet,.number-sheet{padding:23px 20px 20px;border-radius:14px}.sheet h2{font-size:22px}.sheet-intro{font-size:11px}.sheet>header{gap:9px}.sheet-symbol{width:34px;height:40px}.sheet-folder{align-items:flex-start}.sheet-folder button{font-size:11px}.reader-empty{padding:25px}.reader-empty h2{font-size:21px}.reader-empty p{font-size:12px}.launcher{right:16px;bottom:85px}}\n@media(max-height:550px){.surface{height:98dvh}.veil{padding:6px}.topbar{padding-block:10px}.brand p{display:none}.sidebar{padding-top:16px}.folder-box{padding-top:12px}.folder-icon,.folder-status{display:none}.reader-heading{padding-top:9px;padding-bottom:11px}.reader-tools{margin-bottom:5px}.reader-date{margin-top:2px}.reader-title{-webkit-line-clamp:2;font-size:20px}.sheet-veil,.number-veil{padding:9px}.sheet{padding:18px 22px}.sheet>header{margin-bottom:12px}.draft-summary{margin-bottom:12px}.field{margin-bottom:11px}.sheet>footer{padding-top:14px}}\n@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}\n\n.sheet{padding-bottom:0}.sheet>footer{position:sticky;bottom:0;z-index:1;padding:16px 0 20px;margin-top:12px;background:var(--white);border-top:1px solid var(--line)}.selection-fields{margin:18px 0;padding:16px;background:#f1f3e9;border:1px solid #dce2cf;border-radius:10px;min-width:0}.selection-heading{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap}.selection-heading h3{margin:0;font-size:13px;color:#476041}.selection-heading span,.selection-help{font-size:11px;color:#76806b}.selection-inputs{display:grid;grid-template-columns:1fr 1fr;gap:12px}.selection-inputs .field{margin:12px 0 0}.selection-help{line-height:1.7;margin:10px 0}.selection-status{font-size:12px;color:#5a704b;margin:10px 0}.selection-status.invalid{color:#a34b3e}.selection-preview{max-height:125px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#fffef7;border:1px solid #e0e3d5;border-radius:6px;padding:12px;margin:0;font:12px/1.75 ui-monospace,Consolas,monospace;color:#56634d;min-width:0}.selection-inputs input{font-family:ui-monospace,Consolas,monospace}.selection-fields[hidden]{display:none}@media(max-width:560px){.selection-inputs{grid-template-columns:1fr;gap:0}.selection-fields{padding:12px}.selection-preview{max-height:100px}}\n\n.content-editor{width:min(100%,850px)}.editor-fields{min-width:0}.editor-help{font-size:12px;line-height:1.9;color:#7c856e;margin:0 0 14px;padding:12px 14px;background:#f1f3e9;border:1px solid #e0e5d5;border-radius:8px}.field textarea{width:100%;min-width:0;min-height:260px;height:38dvh;resize:vertical;padding:15px;border:1px solid #ccd7c0;border-radius:8px;background:#fffefa;color:#3b5437;font:13px/1.85 ui-monospace,Consolas,\"Microsoft YaHei\",monospace;tab-size:2;outline-offset:2px;white-space:pre-wrap;overflow-wrap:anywhere}.editor-state{font-size:12px;color:#7a876e;margin:0 0 12px}.cleanup-note{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:11px;color:#9a6b36;margin-top:10px}.reader-title{cursor:text}.reader-secondary{flex-wrap:wrap;justify-content:flex-end}.editor-fields[hidden],.cleanup-note[hidden]{display:none}@media(max-width:480px){.field textarea{min-height:220px;font-size:12px;height:34dvh}.content-editor .draft-summary{margin-bottom:15px}.editor-help{font-size:11px}.reader-secondary{gap:9px}.reader-tools{gap:8px;flex-wrap:wrap}}\n\n.expanded .reader-heading,.expanded .viewbar,.expanded .page-tools,.expanded .page-notes{display:none}.restore-reader{position:absolute;top:12px;right:12px;z-index:2;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:7px 12px;border:1px solid #ced9c5;border-radius:9px;background:#fffef7ed;color:var(--green-dark);font-size:12px;box-shadow:0 3px 15px #1c38221a}.restore-reader[hidden]{display:none}.restore-reader svg{width:15px;height:15px}.restore-reader:hover{background:#fffef7;box-shadow:0 4px 17px #1c38222b}.expanded .content{min-height:0;flex:1}.expanded .original-view,.expanded .source-view{padding:24px 30px}@media(max-width:480px){.restore-reader{top:10px;right:10px}.expanded .original-view,.expanded .source-view{padding:20px}}\n\n.file-hint{font-size:11px;font-weight:400;line-height:1.7;color:#879078;overflow-wrap:anywhere}\n\n.reader-title-row{display:flex;align-items:baseline;gap:8px 16px;flex-wrap:wrap}.reader-title-row .reader-title{flex:0 1 auto}.reader-title-row .reader-origin{font-size:11px;line-height:1.8;color:#879078;margin:0;flex:1 1 220px}.danger-button{color:#a05d51}.danger-button:hover{color:#973f34}.reader-secondary{gap:9px}\n");
export { onActivate, onEnable, onDisable, onDelete };
