import { MemoryDirectory } from '../tests/memory-fs.mjs';

const htmlPage = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
body{margin:0!important;padding:28px;background:#f2eee2;color:#3f4f3b;font-family:Georgia,"Microsoft YaHei",serif}.ticket{max-width:520px;margin:12px auto;padding:38px;background:#fffcf0;border:1px solid #d4d9bc;border-radius:3px;box-shadow:0 6px 20px #69754c12}h1{font-size:30px;font-weight:500;letter-spacing:.08em}p{font-size:14px;line-height:2;color:#7c826c}button{border:1px solid #7b8f5c;border-radius:4px;background:#4f6945;color:#fff8dc;padding:11px 20px;cursor:pointer}.lamp{font-size:36px;filter:grayscale(1);transition:filter .2s}body.lit .lamp{filter:none}small{color:#9b9e88}#status{min-height:32px}
</style></head><body><article class="ticket"><small>雾港，深夜十一点</small><h1>给晚归的旅人</h1><p>如果你看见这封信，<br>就替我把窗边的灯点亮吧。</p><p>今夜的风很轻，<br>故事可以等明天再讲。</p><p class="lamp">🕯️</p><button id="light">点亮一盏灯</button><p id="status">窗边还暗着。</p></article><script>document.getElementById('light').addEventListener('click',()=>{document.body.classList.toggle('lit');const lit=document.body.classList.contains('lit');document.getElementById('status').textContent=lit?'灯已点亮，欢迎回家。':'窗边还暗着。';document.getElementById('light').textContent=lit?'让灯歇一会儿':'点亮一盏灯';});<\/script></body></html>`;
const chats = [
  { name: '雾港手记 - 重逢', character: '守灯人', messages: [
    { name: '守灯人', role: 'assistant', swipes: ['雨停的时候，街角的小咖啡馆还亮着灯。\n\n他把你常坐的位置留了出来，杯子里的热气缓缓升起。\n\n“好久不见。”他说，没有追问你这些天去了哪里。', '窗边的风铃响了一声。\n\n他抬起头，看见你站在门外，手里的书停在了同一页。'], swipe_id: 0 },
    { name: '守灯人', role: 'assistant', swipes: [`给晚归的旅人\n\n\`\`\`html\n${htmlPage}\n\`\`\``], swipe_id: 0 },
    { name: '你', role: 'user', swipes: ['我想把今晚的故事留在这里，等一个晴天再慢慢读。'], swipe_id: 0 },
  ] },
  { name: '星河夜话 - 归途', character: '星航员', messages: [
    { name: '星航员', role: 'assistant', swipes: ['舷窗外的星河安静地流淌。\n\n“再过两站，就是家了。”\n\n导航台上的小灯闪了两下，像是在回应这句迟到了很久的话。'], swipe_id: 0 },
    { name: '星航员', role: 'assistant', swipes: ['双页便笺\n```html\n<div style="padding:40px;background:#eee9df;color:#46604b"><h1>第一张便笺</h1><button onclick="this.textContent=\'已收好\'">收好这句话</button></div>\n```\n```html\n<div style="padding:40px;background:#e8eddc;color:#46604b"><h1>第二张便笺</h1><details><summary>打开看看</summary><p>旅途总有终点，故事还会继续。</p></details></div>\n```'], swipe_id: 0 },
  ] },
];
for (const chat of chats) for (const message of chat.messages) {
  message.mes = message.swipes[message.swipe_id];
  message.is_user = message.role === 'user';
}
let active = 0;
const directory = new MemoryDirectory();
const eventListeners = new Map();
const eventTypes = { APP_READY: 'app_ready', CHAT_CHANGED: 'chat_id_changed', USER_MESSAGE_RENDERED: 'user_message_rendered',
  CHARACTER_MESSAGE_RENDERED: 'character_message_rendered', MESSAGE_UPDATED: 'message_updated', MESSAGE_SWIPED: 'message_swiped', MORE_MESSAGES_LOADED: 'more_messages_loaded' };
const eventSource = {
  on(name, listener) { if (!eventListeners.has(name)) eventListeners.set(name, new Set()); eventListeners.get(name).add(listener); },
  removeListener(name, listener) { eventListeners.get(name)?.delete(listener); },
};
const context = () => ({ chatId: chats[active].name, characterId: 0, groupId: '', name2: chats[active].character,
  characters: [{ name: chats[active].character, avatar: `synthetic-character-${active}.png` }], groups: [], chat: chats[active].messages, eventTypes, eventSource });
window.SillyTavern = { getContext: context };
window.showDirectoryPicker = async () => directory;
const preferences = new Map();
Object.defineProperty(window, 'indexedDB', { value: {
  open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { close() {}, transaction() {
        const transaction = {};
        transaction.objectStore = () => ({ get(key) { const r = { result: preferences.get(key) }; setTimeout(() => transaction.oncomplete?.(), 0); return r; },
          put(value, key) { preferences.set(key, value); const r = { result: key }; setTimeout(() => transaction.oncomplete?.(), 0); return r; } });
        return transaction;
      } };
      request.onsuccess?.();
    });
    return request;
  },
} });

function renderChat() {
  document.querySelector('.chat-title').textContent = `当前合成聊天：${chats[active].name}`;
  const chat = document.getElementById('chat'); chat.replaceChildren();
  chats[active].messages.forEach((message, index) => {
    const row = document.createElement('article'); row.className = 'mes'; row.setAttribute('mesid', index);
    const title = document.createElement('h2'); title.textContent = `${message.name} · 楼层 #${index}`;
    const body = document.createElement('div'); body.className = 'mes_text'; body.textContent = message.mes;
    const controls = document.createElement('div'); controls.className = 'mes_buttons'; row.append(title, body, controls); chat.append(row);
  });
}
let extension;
let reloadCount = 0;
async function loadScript() {
  extension?.onDisable();
  extension = await import(`/index.js?preview=${++reloadCount}`);
  extension.onActivate();
}
window.previewListenerCount = () => [...eventListeners.values()].reduce((sum, set) => sum + set.size, 0);
window.previewVaultFiles = () => {
  const result = {};
  function visit(dir) { for (const handle of dir.children.values()) { if (handle.kind === 'file') result[handle.path] = handle.value; else visit(handle); } }
  visit(directory);
  return result;
};
window.previewTaggedFloor = () => {
  const message = chats[active].messages[1];
  message.mes = '<thinking>OUTSIDE_FILTER_MARKER</thinking>\n<content><image>EXCLUDED_IMAGE_MARKER</image>\n<div><button id="kept-button" onclick="this.textContent=\'已保留交互\'">保留按钮</button><p>保留的故事</p></div>\n<image><div>EXCLUDED_SECOND_MARKER</div></image></content>尾部不收藏';
  renderChat();
};
document.getElementById('disable-extension').onclick = () => extension?.onDisable();
document.getElementById('enable-extension').onclick = () => extension?.onEnable();
document.getElementById('switch-chat').onclick = () => {
  active = (active + 1) % chats.length; renderChat(); eventListeners.get('chat_id_changed')?.forEach(listener => listener());
};
document.getElementById('reload-script').onclick = loadScript;
renderChat(); await loadScript();
