export const VERSION = '0.6.0';
export const PRODUCT = 'tavern-vault';
export const SCHEMA_VERSION = 1;
export const UNFILED = 'uncategorized';
export const META_FILE = 'tavern-vault.json';

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function normalized(value) {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase();
}

export function safeId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
}

export function titleFileBase(title) {
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

export function safeFolderName(value) {
  if (safeFileBase(value)) return true;
  if (typeof value !== 'string' || value.length > 150) return false;
  const suffix = value.match(/^(.*) \(([2-9]|[1-9]\d{1,4})\)$/u);
  return Boolean(suffix && safeFileBase(suffix[1]));
}

export function textFilePath(entry) {
  return `${entry.content.folder ? `${entry.content.folder}/` : ''}${entry.content.originalFile}`;
}

export function contentFileNames(fileBase, pageCount) {
  return {
    originalFile: fileBase == null ? 'original.txt' : `${fileBase}.txt`,
    renderedFile: fileBase == null ? 'rendered.html' : `${fileBase}.html`,
    pageFiles: Array.from({ length: pageCount }, (_, index) => fileBase == null
      ? `pages/page-${index + 1}.html`
      : `pages/${fileBase}${index ? ` - 页面${index + 1}` : ''}.html`),
  };
}

export function compactSource(source) {
  return { chatId: String(source.chatId || source.chatName || ''),
    characterName: String(source.characterName || source.characterOrGroupName || source.speakerName || '未取得角色'),
    messageId: source.messageId };
}

export function safeTextFile(name) {
  return typeof name === 'string' && name.endsWith('.txt') && name.length <= 150 &&
    !/[\u0000-\u001f<>:"/\\|?*]/u.test(name) && name !== '.txt' && !/[. ]$/.test(name.slice(0, -4)) &&
    !/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)(?:\.|$)/i.test(name);
}

export function newId() {
  return crypto.randomUUID();
}

export async function digest(text) {
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(result), n => n.toString(16).padStart(2, '0')).join('');
}

export function validateMeta(value) {
  assert(value?.product === PRODUCT && [1, 2, 3].includes(value.schemaVersion),
    '这个文件夹不是受支持的储藏库，或文件格式版本不同。请另选文件夹。');
  assert(safeId(value.libraryId) && Number.isSafeInteger(value.revision) && value.revision >= 0,
    '收藏库配置损坏，已停止写入；原文件保持不变。');
  assert(Array.isArray(value.categories), '收藏库分类记录损坏，已停止写入。');
  const ids = new Set();
  const names = new Set();
  const folders = new Set();
  for (const category of value.categories) {
    assert(category && safeId(category.id) && typeof category.name === 'string' &&
      category.name.trim().length > 0 && category.name.length <= 80 &&
      !ids.has(category.id) && !names.has(normalized(category.name)), '收藏库中存在损坏或重复的分类。');
    ids.add(category.id);
    names.add(normalized(category.name));
    if (category.folder != null) {
      assert(safeFolderName(category.folder) && !folders.has(normalized(category.folder)), '分类文件夹无效或重名，已停止写入。');
      folders.add(normalized(category.folder));
    }
  }
  assert(ids.has(UNFILED), '收藏库缺少“未分类”记录，已停止写入。');
  if (value.schemaVersion >= 2) {
    assert(Array.isArray(value.entries) && Array.isArray(value.deleted), '收藏库的文件清单损坏，已停止写入。');
    const entryIds = new Set();
    const files = new Set();
    for (const record of [...value.entries, ...value.deleted.map(item => item?.entry)]) {
      validateEntry(record, record?.id);
      assert(!entryIds.has(record.id), '收藏库中存在重复的收藏编号。');
      entryIds.add(record.id);
    }
    for (const record of value.entries) {
      assert((record.schemaVersion === 4 || value.schemaVersion === 3 && record.schemaVersion === 5) &&
        !files.has(normalized(textFilePath(record))), '收藏库中存在重复或无效的 TXT 文件名。');
      if (record.schemaVersion === 5) assert(value.categories.some(category => category.id === record.categoryId && category.folder === record.content.folder), '收藏与分类文件夹不一致。');
      files.add(normalized(textFilePath(record)));
    }
  }
  return value;
}

export function validateEntry(value, directoryId) {
  assert([1, 2, 3, 4, 5].includes(value?.schemaVersion) && safeId(value.id) && value.id === directoryId,
    '收藏记录的编号或格式无效。');
  assert(typeof value.title === 'string' && value.title.length <= 160 && safeId(value.categoryId),
    '收藏的标题或分类无效。');
  assert(value.source && typeof value.source.chatId === 'string' &&
    Number.isSafeInteger(value.source.messageId) && value.source.messageId >= 0 &&
    (value.schemaVersion >= 4 ? typeof value.source.characterName === 'string' :
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
  if (value.schemaVersion >= 4) {
    assert(safeTextFile(value.content.originalFile) && value.content.storageId == null && value.content.renderedFile == null &&
      value.content.pages.every(page => page && typeof page.label === 'string' && page.file == null), '收藏的 TXT 文件索引无效。');
    assert(value.schemaVersion === 5 ? safeFolderName(value.content.folder) : value.content.folder == null, '收藏的分类文件夹无效。');
    if (value.cleanup != null) {
      assert(Array.isArray(value.cleanup.files) && value.cleanup.files.every(file => safeTextFile(file.name) &&
        (file.folder == null || value.schemaVersion === 5 && safeFolderName(file.folder)) && /^[a-f0-9]{64}$/.test(file.sha256)), '收藏清理记录无效。');
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

export function editToken(entry) {
  return JSON.stringify([entry.updatedAt, entry.title, entry.categoryId, entry.source, entry.content]);
}

export function sourceLabel(source) {
  return `${source.chatName || source.chatId || '未取得聊天名'} · 楼层 #${source.messageId}`;
}

export function sameSnapshot(a, b) {
  return a.content.originalSha256 === b.content.originalSha256 &&
    a.source.chatId === b.source.chatId &&
    a.source.characterOrGroupId === b.source.characterOrGroupId &&
    a.source.origin === b.source.origin &&
    a.source.messageId === b.source.messageId && a.source.swipeId === b.source.swipeId;
}

export function titleFromText(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/<[^>]*>/g, ' ')
    .replace(/[#*_~`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || '未命名收藏';
}

export function extractHtmlPages(text) {
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

export function friendlyError(error) {
  if (error?.name === 'AbortError') return '已取消，尚未保存。';
  if (error?.name === 'NotAllowedError') return '文件夹读写权限未获准。请点击“重新授权”，再重试；收藏草稿仍保留。';
  if (error?.name === 'SecurityError') return '浏览器未允许访问文件夹。请使用电脑 Chrome/Edge，并通过 localhost 或 HTTPS 打开酒馆，然后点击选择文件夹。';
  if (error?.name === 'QuotaExceededError') return '磁盘空间不足，收藏未保存成功。请释放空间后重试。';
  if (error?.name === 'NotFoundError') return '文件夹或文件已被移动、删除。请重新选择收藏文件夹。';
  return error?.message || '操作未完成，请重试。';
}
