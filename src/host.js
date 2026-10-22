import { assert, PRODUCT, friendlyError } from './core.js';

export function createTavernHost(mainWindow) {
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

export function installEntrances(host, ui) {
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

export function reportStartupError(mainWindow, error) {
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
