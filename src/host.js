import { assert, PRODUCT, friendlyError } from './core.js';

export function createTavernHost(scriptWindow) {
  let mainWindow;
  try {
    mainWindow = scriptWindow.parent;
    assert(mainWindow?.document?.body, '无法访问酒馆主界面。');
  } catch { throw new Error('储藏库需要在酒馆助手的全局脚本中运行，并允许同源界面访问。'); }
  const parentHelper = mainWindow.TavernHelper || {};
  // Explicit bindings also cover helper globals declared lexically in the script iframe.
  const api = {
    getChatMessages: typeof getChatMessages === 'function' ? getChatMessages : parentHelper.getChatMessages,
    retrieveDisplayedMessage: typeof retrieveDisplayedMessage === 'function' ? retrieveDisplayedMessage : parentHelper.retrieveDisplayedMessage,
    eventOn: typeof eventOn === 'function' ? eventOn : null,
    events: typeof tavern_events !== 'undefined' ? tavern_events : null,
    getButtonEvent: typeof getButtonEvent === 'function' ? getButtonEvent : null,
    appendButtons: typeof appendInexistentScriptButtons === 'function' ? appendInexistentScriptButtons : null,
  };
  assert(typeof api.getChatMessages === 'function', '没有检测到酒馆助手的楼层读取接口。请在助手的全局脚本库启用本脚本。');
  const context = () => {
    if (typeof SillyTavern !== 'undefined' && Array.isArray(SillyTavern.chat)) return SillyTavern;
    const value = mainWindow.SillyTavern?.getContext?.();
    assert(value, '无法取得酒馆当前聊天信息。');
    return value;
  };
  const versions = { tavern: '', helper: '' };
  try { if (typeof getTavernVersion === 'function') versions.tavern = getTavernVersion(); } catch { /* Optional diagnostic. */ }
  try { if (typeof getTavernHelperVersion === 'function') versions.helper = getTavernHelperVersion(); } catch { /* Optional diagnostic. */ }
  return { window: mainWindow, document: mainWindow.document, api, context, versions,
    lastMessageId: () => context().chat.length - 1 };
}

export function installEntrances(host, ui) {
  const doc = host.document;
  const disposers = [];
  const ownedButtons = new Set();
  let scheduled = false;
  let destroyed = false;
  function addFloorButtons() {
    scheduled = false;
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
  }
  function schedule() {
    if (!scheduled && !destroyed) {
      scheduled = true;
      host.window.requestAnimationFrame(addFloorButtons);
    }
  }
  const chat = doc.getElementById('chat');
  if (chat) {
    const observer = new host.window.MutationObserver(schedule);
    observer.observe(chat, { childList: true, subtree: true, attributes: true, attributeFilter: ['mesid'] });
    disposers.push(() => observer.disconnect());
  }
  if (host.api.eventOn && host.api.events) {
    for (const name of ['CHAT_CHANGED', 'USER_MESSAGE_RENDERED', 'CHARACTER_MESSAGE_RENDERED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED']) {
      if (host.api.events[name]) {
        const subscription = host.api.eventOn(host.api.events[name], schedule);
        disposers.push(() => subscription.stop());
      }
    }
  }
  if (host.api.appendButtons && host.api.getButtonEvent && host.api.eventOn) {
    host.api.appendButtons([{ name: '储藏库', visible: true }]);
    const subscription = host.api.eventOn(host.api.getButtonEvent('储藏库'), () => ui.open());
    disposers.push(() => subscription.stop());
  }
  addFloorButtons();
  return () => { destroyed = true; disposers.forEach(stop => stop()); ownedButtons.forEach(button => button.remove()); };
}

export function reportStartupError(scriptWindow, error) {
  const text = `储藏库未能启动：${friendlyError(error)}`;
  try {
    const hostWindow = scriptWindow.parent;
    if (hostWindow.toastr?.error) hostWindow.toastr.error(text);
    else hostWindow.alert(text);
  } catch { console.error(`${PRODUCT}: startup failed`); }
}
