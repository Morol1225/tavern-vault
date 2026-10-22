import test from 'node:test';
import assert from 'node:assert/strict';
import { createTavernHost } from '../src/host.js';
import { captureFloor } from '../src/capture.js';

function fixture() {
  const listeners = new Map();
  const context = { chatId: '聊天一', characters: [{ name: '角色一', avatar: 'synthetic.png' }], characterId: 0,
    chat: [{ name: '角色一', is_user: false, mes: '当前已经编辑的回复', swipes: ['旧的回复', '未同步的缓存'], swipe_id: 1 }],
    eventTypes: { CHAT_CHANGED: 'chat_changed' },
    eventSource: { on(event, listener) { listeners.set(event, listener); }, removeListener(event, listener) { if (listeners.get(event) === listener) listeners.delete(event); } } };
  const window = { document: { body: {}, querySelector: () => null }, location: { origin: 'http://localhost:8000' },
    SillyTavern: { getContext: () => context } };
  return { window, context, listeners };
}

test('没有助手也可读取原生当前楼层，优先当前 mes 而非旧 swipe 缓存', () => {
  const { window } = fixture();
  const host = createTavernHost(window);
  const draft = captureFloor(host, 0);
  assert.equal(draft.original, '当前已经编辑的回复');
  assert.equal(draft.source.swipeId, 1);
  assert.equal(draft.source.helperVersion, null);
  assert.equal(host.displayedMessage(-1), null);
  assert.throws(() => captureFloor(host, 1), /没有找到/);
});

test('原生事件能取消订阅，后续聊天读取刷新但已捕获来源不变', () => {
  const { window, context, listeners } = fixture();
  const host = createTavernHost(window);
  const original = captureFloor(host, 0);
  const listener = () => {};
  const stop = host.subscribe(host.events.CHAT_CHANGED, listener);
  assert.equal(listeners.size, 1);
  stop();
  assert.equal(listeners.size, 0);
  context.chatId = '聊天二'; context.chat[0].mes = '新聊天正文'; context.chat[0].is_user = true;
  assert.equal(captureFloor(host, 0).source.chatId, '聊天二');
  assert.equal(captureFloor(host, 0).source.role, 'user');
  assert.equal(original.source.chatId, '聊天一');
  assert.equal(original.original, '当前已经编辑的回复');
});

test('宿主接口缺失时给出具体失败原因，兼容官方保留的事件旧名称', () => {
  assert.throws(() => createTavernHost({ document: { body: {} } }), /getContext/);
  const { window, context } = fixture();
  context.event_types = context.eventTypes; delete context.eventTypes;
  assert.equal(createTavernHost(window).events.CHAT_CHANGED, 'chat_changed');
  delete context.eventSource.removeListener;
  assert.throws(() => createTavernHost(window), /缺少聊天事件接口/);
});
