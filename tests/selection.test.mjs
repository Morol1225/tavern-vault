import test from 'node:test';
import assert from 'node:assert/strict';
import { selectContent, selectDraft } from '../src/selection.js';
import { VaultStorage } from '../src/storage.js';
import { MemoryDirectory } from './memory-fs.mjs';

test('先提取 content，再完整排除 image，保留字符与换行', () => {
  const raw = '不收藏<content>\r\n保留 A<image>排除 A</image>\r\n保留 B<image>排除 B</image></content>不收藏';
  const result = selectContent(raw, { includeTag: '<content>', excludeTags: '<image>' });
  assert.equal(result.text, '\r\n保留 A\r\n保留 B');
  assert.deepEqual(result.rules, { includeTag: 'content', excludeTags: ['image'], includedCount: 1, excludedCount: 2 });
});

test('同名嵌套、多段、大小写及带大于号的属性不会提前截断', () => {
  const raw = `<CONTENT data-title="a > b">外<content>里</content>尾</CONTENT>间隔<content>第二段</content>`;
  const result = selectContent(raw, { includeTag: 'content' });
  assert.equal(result.text, '外<content>里</content>尾\n\n第二段');
  assert.equal(result.rules.includedCount, 2);
  assert.equal(selectContent('<正文>汉字</正文>', { includeTag: '正文' }).text, '汉字');
});

test('多个排除标签合并重叠范围，支持自闭合和去重', () => {
  const result = selectContent('A<image>大<think>小</think>图</image>B<image/>C<think>思考</think>D', { excludeTags: '<image>，think image' });
  assert.equal(result.text, 'ABCD');
  assert.deepEqual(result.rules.excludeTags, ['image', 'think']);
  assert.equal(result.rules.excludedCount, 3);
});

test('缺失提取标签、错误配对和空结果均明确报错，缺失排除标签不影响内容', () => {
  assert.throws(() => selectContent('整楼', { includeTag: 'content' }), /没有找到/);
  assert.throws(() => selectContent('<content>正文', { includeTag: 'content' }), /没有闭合/);
  assert.throws(() => selectContent('</image>正文', { excludeTags: 'image' }), /没有正确配对/);
  assert.throws(() => selectContent('<content><image>全删</image></content>', { includeTag: 'content', excludeTags: 'image' }), /没有可收藏/);
  assert.equal(selectContent('保留正文', { excludeTags: 'image' }).text, '保留正文');
});

test('标签名按字面匹配，拒绝属性和正则输入，不误匹配标签名前缀', () => {
  for (const tag of ['content.*', '<content data-x="1">', '<script>正文</script>', 'a|b']) {
    assert.throws(() => selectContent('正文', { includeTag: tag }), /标签名/);
  }
  assert.equal(selectContent('<content-extra>错</content-extra><content>对</content>', { includeTag: 'content' }).text, '对');
  assert.equal(selectContent('<a.b>保留</a.b><axb>不保留</axb>', { includeTag: 'a.b' }).text, '保留');
});

test('未开启规则时，返回同一草稿，保留原显示快照', () => {
  const draft = { original: '\r\n原文', rendered: '原显示', pages: [], source: {} };
  assert.equal(selectDraft(draft, {}), draft);
  assert.equal(selectContent(draft.original).text, draft.original);
});

test('筛选后的草稿不引用未筛选页面、快照、标题或警告，并保留来源', () => {
  const raw = '<content><image>EXCLUDED</image><div><button onclick="this.textContent=1">保留</button></div></content>';
  const draft = { original: raw, rendered: '<div>EXCLUDED_SNAPSHOT</div>', pages: [{ html: 'EXCLUDED_PAGE' }],
    suggestedTitle: 'EXCLUDED_TITLE', warnings: ['EXCLUDED_WARNING'], source: { chatId: '来源聊天', messageId: 8 } };
  const selected = selectDraft(draft, { includeTag: 'content', excludeTags: 'image' });
  assert.doesNotMatch(JSON.stringify(selected), /EXCLUDED/);
  assert.equal(selected.pages.length, 1);
  assert.match(selected.pages[0].html, /onclick/);
  assert.equal(selected.source.messageId, 8);
  assert.equal(selected.source.chatId, '来源聊天');
  assert.equal(draft.original, raw);
});

test('文件夹中的原文、页面、快照和记录均只写入筛选结果，可由新实例恢复', async () => {
  const directory = new MemoryDirectory();
  const storage = new VaultStorage({});
  await storage.attach(directory);
  const selected = selectDraft({ original: 'EXCLUDED_PREFIX<content><image>EXCLUDED_IMAGE</image><div>保留</div></content>',
    rendered: 'EXCLUDED_SNAPSHOT', pages: [{ html: 'EXCLUDED_FRAME' }], warnings: [],
    source: { chatId: '测试聊天', messageId: 4, swipeId: 0, speakerName: '合成', role: 'assistant' } }, { includeTag: 'content', excludeTags: 'image' });
  const saved = await storage.save(selected, { title: selected.suggestedTitle });
  async function checkFiles(dir) {
    for await (const handle of dir.values()) {
      if (handle.kind === 'directory') await checkFiles(handle);
      else assert.doesNotMatch(await (await handle.getFile()).text(), /EXCLUDED/);
    }
  }
  await checkFiles(directory);
  const reopened = new VaultStorage({});
  await reopened.attach(directory, false);
  assert.equal(reopened.entries[0].id, saved.entry.id);
  assert.equal(reopened.entries[0].original, '<div>保留</div>');
  assert.deepEqual(reopened.entries[0].source.selection.excludeTags, ['image']);
  const marker = await (await (await directory.getDirectoryHandle('items')).getDirectoryHandle(saved.entry.id)).getFileHandle('entry.json');
  const invalid = JSON.parse(marker.value);
  invalid.source.selection.excludeTags = '不是数组';
  marker.value = JSON.stringify(invalid);
  await reopened.load();
  assert.equal(reopened.entries.length, 0);
  assert.match(reopened.issues[0].message, /筛选记录损坏/);
});
