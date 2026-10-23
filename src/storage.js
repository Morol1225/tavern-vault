import { PRODUCT, UNFILED, META_FILE, assert, normalized, safeId, newId, digest, validateMeta, validateEntry, extractHtmlPages, editToken, titleFileBase, contentFileNames, compactSource } from './core.js';

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

export class VaultStorage {
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

export class DirectoryMemory {
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
