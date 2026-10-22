import { assert, extractHtmlPages, titleFromText, VERSION } from './core.js';

export function captureFloor(host, messageId) {
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

export function preparePreview(html, origin, document) {
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
  return `<!doctype html>\n${page.documentElement.outerHTML}`;
}
