export const VERSION = '0.2.0';
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

export function newId() {
  return crypto.randomUUID();
}

export async function digest(text) {
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(result), n => n.toString(16).padStart(2, '0')).join('');
}

export function validateMeta(value) {
  assert(value?.product === PRODUCT && value.schemaVersion === SCHEMA_VERSION,
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
  return value;
}

export function validateEntry(value, directoryId) {
  assert(value?.schemaVersion === SCHEMA_VERSION && safeId(value.id) && value.id === directoryId,
    '收藏记录的编号或格式无效。');
  assert(typeof value.title === 'string' && value.title.length <= 160 && safeId(value.categoryId),
    '收藏的标题或分类无效。');
  assert(value.source && typeof value.source.chatId === 'string' &&
    Number.isSafeInteger(value.source.messageId) && value.source.messageId >= 0 &&
    Number.isSafeInteger(value.source.swipeId) && value.source.swipeId >= 0 &&
    typeof value.source.speakerName === 'string', '收藏来源记录不完整。');
  if (value.source.selection != null) {
    const selection = value.source.selection;
    assert(typeof selection.includeTag === 'string' && Array.isArray(selection.excludeTags) &&
      selection.excludeTags.every(tag => typeof tag === 'string') &&
      Number.isSafeInteger(selection.includedCount) && selection.includedCount >= 0 &&
      Number.isSafeInteger(selection.excludedCount) && selection.excludedCount >= 0, '收藏的标签筛选记录损坏。');
  }
  assert(typeof value.savedAt === 'string' && Number.isFinite(Date.parse(value.savedAt)), '收藏时间无效。');
  assert(typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)), '收藏修改时间无效。');
  assert(value.content?.originalFile === 'original.txt' && value.content?.renderedFile === 'rendered.html' &&
    /^[a-f0-9]{64}$/.test(value.content.originalSha256) && Array.isArray(value.content.pages), '收藏内容索引无效。');
  assert(value.content.pages.length <= 100 && value.content.pages.every((p, index) =>
    p && p.file === `pages/page-${index + 1}.html` && typeof p.label === 'string'), '收藏页面路径无效。');
  assert(Array.isArray(value.content.warnings) && value.content.warnings.every(note => typeof note === 'string'), '收藏页面说明记录无效。');
  return value;
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
