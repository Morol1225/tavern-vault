import { PRODUCT, SCHEMA_VERSION, UNFILED, META_FILE, assert, normalized, safeId, newId, digest, validateMeta, validateEntry, sameSnapshot, extractHtmlPages, editToken } from './core.js';

async function readFile(directory, name) {
  return (await (await directory.getFileHandle(name)).getFile()).text();
}

async function optionalFile(directory, name) {
  try { return await readFile(directory, name); }
  catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
}

async function contentDirectory(directory, entry) {
  return entry.content.storageId
    ? (await directory.getDirectoryHandle('content')).getDirectoryHandle(entry.content.storageId)
    : directory;
}

async function removeIfPresent(directory, name, options) {
  try { await directory.removeEntry(name, options); }
  catch (error) { if (error.name !== 'NotFoundError') throw error; }
}

async function writeFile(directory, name, text) {
  const handle = await directory.getFileHandle(name, { create: true });
  let stream;
  try {
    stream = await handle.createWritable();
    await stream.write(text);
    await stream.close();
    assert(await (await handle.getFile()).text() === text, '写入后核对失败，未标记为保存成功。');
  } catch (error) {
    try { await stream?.abort(); } catch { /* The stream may already be closed. */ }
    throw error;
  }
}

async function mapLimited(values, action, limit = 6) {
  let index = 0;
  const results = new Array(values.length);
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (index < values.length) { const at = index++; results[at] = await action(values[at]); }
  }));
  return results;
}

export class VaultStorage {
  constructor(environment = globalThis) {
    this.environment = environment;
    this.directory = null;
    this.meta = null;
    this.entries = [];
    this.issues = [];
    this.queue = Promise.resolve();
  }

  get connected() { return Boolean(this.directory && this.meta); }

  async permission(request = false) {
    if (!this.directory) return false;
    const options = { mode: 'readwrite' };
    if (await this.directory.queryPermission(options) === 'granted') return true;
    return request && await this.directory.requestPermission(options) === 'granted';
  }

  async attach(directory, initialize = true) {
    assert(directory?.kind === 'directory', '请选择一个文件夹。');
    const prior = { directory: this.directory, meta: this.meta, entries: this.entries, issues: this.issues };
    try {
      assert(await directory.queryPermission({ mode: 'readwrite' }) === 'granted', '尚未获得文件夹的读写权限，请重新授权。');
      let raw = await optionalFile(directory, META_FILE);
      if (raw === null) {
        assert(initialize, '未找到收藏库标识文件，请重新选择原收藏文件夹。');
        let collision = false;
        try { await directory.getDirectoryHandle('items'); collision = true; }
        catch (error) { if (error.name !== 'NotFoundError') throw error; }
        assert(!collision, '此文件夹已存在 items 目录，无法确认归属。请选择一个空文件夹以保留已有文件。');
        const meta = { product: PRODUCT, schemaVersion: SCHEMA_VERSION, libraryId: newId(), revision: 0,
          createdAt: new Date().toISOString(), categories: [{ id: UNFILED, name: '未分类' }] };
        raw = JSON.stringify(meta, null, 2);
        await directory.getDirectoryHandle('items', { create: true });
        await writeFile(directory, META_FILE, raw);
      }
      this.meta = validateMeta(JSON.parse(raw));
      this.directory = directory;
      await this.load();
    } catch (error) { Object.assign(this, prior); throw error; }
  }

  async load() {
    assert(this.directory, '请先选择收藏文件夹。');
    assert(await this.permission(), '文件夹需要重新授权，请点击“重新授权”。');
    const meta = validateMeta(JSON.parse(await readFile(this.directory, META_FILE)));
    const items = await this.directory.getDirectoryHandle('items');
    const directories = [];
    for await (const item of items.values()) if (item.kind === 'directory' && safeId(item.name)) directories.push(item);
    const issues = [];
    const entries = await mapLimited(directories, async directory => {
      try {
        const raw = await optionalFile(directory, 'entry.json');
        if (raw === null) { issues.push({ id: directory.name, message: '未完成的收藏，已略过' }); return null; }
        const record = validateEntry(JSON.parse(raw), directory.name);
        const original = await readFile(await contentDirectory(directory, record), 'original.txt');
        assert(await digest(original) === record.content.originalSha256, '原文已变动，校验不一致');
        return { ...record, original };
      } catch (error) {
        if (['NotAllowedError', 'SecurityError'].includes(error.name)) throw error;
        issues.push({ id: directory.name, message: error.message || '无法读取' });
        return null;
      }
    });
    this.meta = meta;
    this.entries = entries.filter(Boolean).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    this.issues = issues;
    return this.entries;
  }

  mutate(action) {
    const run = async () => {
      assert(this.connected && await this.permission(), '请先连接收藏文件夹，或点击“重新授权”。');
      const execute = async () => {
        this.meta = validateMeta(JSON.parse(await readFile(this.directory, META_FILE)));
        return action();
      };
      const locks = this.environment.navigator?.locks;
      return locks ? locks.request(`${PRODUCT}:${this.meta.libraryId}`, execute) : execute();
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  async ensureCategory({ categoryId = UNFILED, newCategory = '' } = {}) {
    if (!newCategory.trim()) {
      assert(this.meta.categories.some(c => c.id === categoryId), '所选分类已经不存在，请重新选择。');
      return categoryId;
    }
    const name = newCategory.trim();
    assert(name.length <= 80, '分类名称最多 80 个字符。');
    const existing = this.meta.categories.find(c => normalized(c.name) === normalized(name));
    if (existing) return existing.id;
    const category = { id: newId(), name };
    const next = { ...this.meta, revision: this.meta.revision + 1, categories: [...this.meta.categories, category] };
    await writeFile(this.directory, META_FILE, JSON.stringify(next, null, 2));
    this.meta = next;
    return category.id;
  }

  addCategory(name) { return this.mutate(() => this.ensureCategory({ newCategory: name })); }

  save(draft, options) {
    return this.mutate(async () => {
      assert(typeof draft.original === 'string', '收藏草稿缺少原文。');
      const sha256 = await digest(draft.original);
      await this.load();
      const candidate = { source: draft.source, content: { originalSha256: sha256 } };
      const duplicate = this.entries.find(entry => sameSnapshot(entry, candidate));
      if (duplicate) return { entry: duplicate, duplicate: true };
      const title = String(options.title || '').trim();
      assert(title.length > 0 && title.length <= 160, '请填写标题，最多 160 个字符。');
      const categoryId = await this.ensureCategory(options);
      const id = newId();
      const items = await this.directory.getDirectoryHandle('items');
      const directory = await items.getDirectoryHandle(id, { create: true });
      assert(await optionalFile(directory, 'entry.json') === null, '收藏编号冲突，请重试。');
      const pages = draft.pages || [];
      assert(pages.length <= 100, '一个楼层最多保存 100 个 HTML 页面。');
      const now = new Date().toISOString();
      const record = { schemaVersion: SCHEMA_VERSION, id, title, categoryId, savedAt: now, updatedAt: now,
        source: { ...draft.source }, content: { originalFile: 'original.txt', originalSha256: sha256,
          renderedFile: 'rendered.html', pages: pages.map((page, i) => ({ file: `pages/page-${i + 1}.html`, label: page.label, kind: page.kind })),
          warnings: [...(draft.warnings || [])] } };
      validateEntry(record, id);
      await writeFile(directory, 'original.txt', draft.original);
      await writeFile(directory, 'rendered.html', draft.rendered || '');
      if (pages.length) {
        const pageDirectory = await directory.getDirectoryHandle('pages', { create: true });
        for (const [index, page] of pages.entries()) await writeFile(pageDirectory, `page-${index + 1}.html`, page.html);
      }
      await writeFile(directory, 'entry.json', JSON.stringify(record, null, 2));
      const entry = { ...record, original: draft.original };
      this.entries.unshift(entry);
      return { entry, duplicate: false };
    });
  }

  edit(id, options) {
    return this.mutate(async () => {
      assert(safeId(id), '收藏编号无效。');
      const directory = await (await this.directory.getDirectoryHandle('items')).getDirectoryHandle(id);
      const record = validateEntry(JSON.parse(await readFile(directory, 'entry.json')), id);
      const title = String(options.title || '').trim();
      assert(title && title.length <= 160, '请填写标题，最多 160 个字符。');
      const categoryId = await this.ensureCategory(options);
      const next = { ...record, title, categoryId, updatedAt: new Date().toISOString() };
      await writeFile(directory, 'entry.json', JSON.stringify(next, null, 2));
      const local = this.entries.find(entry => entry.id === id);
      if (local) Object.assign(local, next);
      return next;
    });
  }

  async updateContent(id, original, { expectedToken, expectedLibraryId, confirmed = false } = {}) {
    assert(confirmed === true, '尚未确认保存，磁盘内容未修改。');
    assert(typeof original === 'string' && original.trim(), '收藏内容不能为空。');
    return this.mutate(async () => {
      assert(expectedLibraryId === this.meta.libraryId, '编辑期间更换了收藏库，尚未保存。请连接原收藏文件夹后重试。');
      assert(safeId(id), '收藏编号无效。');
      const directory = await (await this.directory.getDirectoryHandle('items')).getDirectoryHandle(id);
      const before = await readFile(directory, 'entry.json');
      const record = validateEntry(JSON.parse(before), id);
      assert(expectedToken === editToken(record), '这条收藏已在别处修改，请取消编辑并重新读取后再修改；当前草稿尚未保存。');
      const prior = await readFile(await contentDirectory(directory, record), 'original.txt');
      assert(await digest(prior) === record.content.originalSha256, '本地原文已被外部修改，已停止保存。请先重新读取并检查。');
      if (original === prior) return { entry: { ...record, original }, unchanged: true, cleanupPending: Boolean(record.cleanup) };
      assert(typeof directory.removeEntry === 'function', '浏览器无法清理旧内容，已停止保存。请更新电脑 Chrome/Edge 后重试。');
      const storageId = newId();
      const content = await directory.getDirectoryHandle('content', { create: true });
      const staging = await content.getDirectoryHandle(storageId, { create: true });
      const pages = extractHtmlPages(original);
      const escaped = original.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      const now = new Date().toISOString();
      const next = { ...record, schemaVersion: 2, updatedAt: now, editedAt: now,
        content: { ...record.content, storageId, originalSha256: await digest(original),
          pages: pages.map((page, index) => ({ file: `pages/page-${index + 1}.html`, label: page.label, kind: page.kind })),
          warnings: ['此内容由你编辑后保存，显示副本和 HTML 页面均按修改后的原文生成。',
            ...(pages.length ? ['页面自身交互可用；依赖酒馆或外部资源的功能可能无法运行。'] : [])] },
        cleanup: { legacyPageCount: record.content.storageId ? (record.cleanup?.legacyPageCount ?? -1) : record.content.pages.length } };
      validateEntry(next, id);
      let commitAttempted = false;
      try {
        await writeFile(staging, '.owned.json', JSON.stringify({ product: PRODUCT, entryId: id, storageId }));
        await writeFile(staging, 'original.txt', original);
        await writeFile(staging, 'rendered.html', `<pre style="white-space:pre-wrap">${escaped}</pre>`);
        if (pages.length) {
          const pageDirectory = await staging.getDirectoryHandle('pages', { create: true });
          for (const [index, page] of pages.entries()) await writeFile(pageDirectory, `page-${index + 1}.html`, page.html);
        }
        assert(await readFile(directory, 'entry.json') === before, '保存期间收藏已在别处修改，已停止提交，请重新读取。');
        // A single closed file selects the complete content set. Old content is untouched until this commit.
        commitAttempted = true;
        await writeFile(directory, 'entry.json', JSON.stringify(next, null, 2));
      } catch (error) {
        // If closing the marker succeeded but readback failed, the new set might already be active.
        // Never delete it when the commit outcome is uncertain.
        if (!commitAttempted) { try { await content.removeEntry(storageId, { recursive: true }); } catch { /* Report original error. */ } }
        if (commitAttempted) throw new Error('保存结果尚未确认，请重新授权并重新读取收藏，确认当前内容后再编辑；当前草稿仍保留。', { cause: error });
        throw error;
      }
      let active = next;
      let cleanupPending = false;
      try { active = await this.finishContentCleanup(directory, next); }
      catch { cleanupPending = true; }
      const entry = { ...active, original };
      const at = this.entries.findIndex(value => value.id === id);
      if (at >= 0) this.entries[at] = entry;
      return { entry, unchanged: false, cleanupPending };
    });
  }

  async finishContentCleanup(directory, record) {
    if (!record.cleanup) return record;
    const current = validateEntry(JSON.parse(await readFile(directory, 'entry.json')), record.id);
    assert(editToken(current) === editToken(record), '收藏已变化，请重新读取后重试清理。');
    const content = await directory.getDirectoryHandle('content');
    for await (const handle of content.values()) {
      if (handle.kind !== 'directory' || !safeId(handle.name) || handle.name === record.content.storageId) continue;
      const owner = await optionalFile(handle, '.owned.json');
      if (!owner) continue;
      let marker;
      try { marker = JSON.parse(owner); } catch { continue; }
      if (marker.product === PRODUCT && marker.entryId === record.id && marker.storageId === handle.name) {
        await content.removeEntry(handle.name, { recursive: true });
      }
    }
    if (record.cleanup.legacyPageCount >= 0) {
      await removeIfPresent(directory, 'original.txt');
      await removeIfPresent(directory, 'rendered.html');
      let pages;
      try { pages = await directory.getDirectoryHandle('pages'); }
      catch (error) { if (error.name !== 'NotFoundError') throw error; }
      if (pages) for (let index = 0; index < record.cleanup.legacyPageCount; index++) await removeIfPresent(pages, `page-${index + 1}.html`);
    }
    const clean = { ...record };
    delete clean.cleanup;
    await writeFile(directory, 'entry.json', JSON.stringify(clean, null, 2));
    return clean;
  }

  cleanupContent(id) {
    return this.mutate(async () => {
      assert(safeId(id), '收藏编号无效。');
      const directory = await (await this.directory.getDirectoryHandle('items')).getDirectoryHandle(id);
      const record = validateEntry(JSON.parse(await readFile(directory, 'entry.json')), id);
      const clean = await this.finishContentCleanup(directory, record);
      const local = this.entries.find(entry => entry.id === id);
      if (local) { delete local.cleanup; Object.assign(local, clean); }
      return clean;
    });
  }

  async readPage(entry, index = -1) {
    validateEntry(entry, entry.id);
    const item = await (await this.directory.getDirectoryHandle('items')).getDirectoryHandle(entry.id);
    const directory = await contentDirectory(item, entry);
    if (index === -1) return readFile(directory, 'rendered.html');
    assert(Number.isInteger(index) && index >= 0 && index < entry.content.pages.length, '页面编号无效。');
    return readFile(await directory.getDirectoryHandle('pages'), `page-${index + 1}.html`);
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
