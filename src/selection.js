import { assert, extractHtmlPages, titleFromText } from './core.js';

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

export function selectContent(text, options = {}) {
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

export function selectDraft(draft, options = {}) {
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
