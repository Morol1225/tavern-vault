import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert(process.env.TAVERN_VAULT_PLAYWRIGHT, 'Set TAVERN_VAULT_PLAYWRIGHT to the installed Playwright index.mjs.');
const { chromium } = await import(pathToFileURL(process.env.TAVERN_VAULT_PLAYWRIGHT).href);
const evidenceRoot = path.join(root, 'docs', 'screenshots');
await fs.mkdir(evidenceRoot, { recursive: true });
const server = spawn(process.execPath, ['scripts/preview.mjs'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let browser;
const results = [];
const errors = [];
const url = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Preview did not start')), 15000);
  server.stdout.on('data', data => {
    const match = String(data).match(/PREVIEW_URL=(\S+)/);
    if (match) { clearTimeout(timeout); resolve(match[1]); }
  });
  server.on('error', reject);
  server.on('exit', code => { if (code) reject(new Error(`Preview exited: ${code}`)); });
});
const passed = name => { results.push({ name, result: 'passed' }); console.log(`PASS ${name}`); };
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', colorScheme: 'light' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.getByRole('button', { name: '打开储藏库', exact: true }).waitFor();
  assert.equal(await page.locator('#chat [data-tv-owned="floor"]').count(), 3);
  assert.equal(await page.evaluate(() => typeof window.TavernHelper), 'undefined');
  assert.equal(await page.locator('#tavern-vault-settings').count(), 1);
  const settingsButton = page.getByRole('button', { name: '从扩展设置打开储藏库', exact: true });
  const settingsLayout = await settingsButton.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, textLines: range.getClientRects().length, whiteSpace: getComputedStyle(element).whiteSpace };
  });
  assert.equal(settingsLayout.textLines, 1, `扩展设置入口应横向显示：${JSON.stringify(settingsLayout)}`);
  await page.locator('#extensions_settings2').screenshot({ path: path.join(evidenceRoot, 'settings-entry.png') });
  await settingsButton.click();
  await page.getByRole('button', { name: '关闭储藏库', exact: true }).click();
  passed('应用酒馆 min-content 按钮样式后，扩展设置入口保持一行并能打开储藏库');
  const listenerCount = await page.evaluate(() => window.previewListenerCount());
  await page.getByRole('button', { name: '禁用扩展', exact: true }).click();
  assert.equal(await page.locator('#tavern-vault-root').count(), 0);
  assert.equal(await page.locator('#chat [data-tv-owned="floor"]').count(), 0);
  assert.equal(await page.locator('#tavern-vault-settings').count(), 0);
  assert.equal(await page.evaluate(() => window.previewListenerCount()), 0);
  await page.getByRole('button', { name: '启用扩展', exact: true }).click();
  await page.getByRole('button', { name: '打开储藏库', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.previewListenerCount()), listenerCount);
  passed('不安装酒馆助手也能启动；禁用清理全部入口与事件，再启用不重复');
  await page.getByRole('button', { name: '收藏楼层 #0', exact: true }).click();
  const form = page.locator('#tavern-vault-root .sheet');
  const draftedTitle = await form.locator('.title-input').inputValue();
  await form.getByRole('button', { name: '保存到文件夹', exact: true }).click();
  await page.getByText('请先选择收藏文件夹，草稿会保留在这个收藏栏中。', { exact: true }).first().waitFor();
  assert.equal(await form.locator('.title-input').inputValue(), draftedTitle);
  passed('未选文件夹时不丢失收藏草稿、不报告保存成功');
  await form.getByRole('button', { name: '选择文件夹', exact: true }).click();
  await page.locator('#tavern-vault-root .connection-dot.connected').waitFor();
  assert.equal(await form.locator('.form-error').isVisible(), false);
  await form.locator('.title-input').fill('雨停后的重逢');
  await form.locator('[data-action="toggle-category"]').click();
  await form.locator('.new-category-input').fill('剧情片段');
  await page.screenshot({ path: path.join(evidenceRoot, 'collector-desktop.png') });
  await form.getByRole('button', { name: '保存到文件夹', exact: true }).click();
  await page.locator('#tavern-vault-root .sheet-veil').waitFor({ state: 'hidden' });
  assert.match(await page.locator('#tavern-vault-root .reader-origin').textContent(), /雾港手记 - 重逢.*守灯人.*楼层 #0/);
  passed('每楼收藏、新建分类、来源与原文在实际界面中关联');
  const beforeNoop = await page.evaluate(() => window.previewVaultFiles());
  assert(Object.entries(beforeNoop).some(([name, text]) => name.endsWith('/雨停后的重逢.txt') && text.includes('\r\n')));
  assert(Object.keys(beforeNoop).filter(name => name.startsWith('/items/')).every(name => /^\/items\/[^/]+\/[^/]+\.txt$/.test(name)));
  assert.equal(Object.keys(beforeNoop).length, 2);
  passed('每条收藏只生成 items/分类名/标题.txt，不生成 HTML、JSON 或编号子目录');
  await page.locator('#tavern-vault-root .reader-title').dblclick();
  await form.getByRole('button', { name: '确认保存到本地', exact: true }).click();
  await page.locator('#tavern-vault-root .sheet-veil').waitFor({ state: 'hidden' });
  assert.deepEqual(await page.evaluate(() => window.previewVaultFiles()), beforeNoop);

  await page.getByRole('button', { name: '关闭储藏库', exact: true }).click();
  await page.getByRole('button', { name: '收藏楼层 #1', exact: true }).click();
  await form.locator('.title-input').fill('给晚归的旅人');
  await form.locator('[data-action="toggle-category"]').click();
  await form.locator('.new-category-input').fill('HTML 页面');
  await form.getByRole('button', { name: '保存到文件夹', exact: true }).click();
  await page.locator('#tavern-vault-root .sheet-veil').waitFor({ state: 'hidden' });
  const htmlFrame = page.frameLocator('#tavern-vault-root .content iframe');
  await htmlFrame.getByRole('button', { name: '点亮一盏灯', exact: true }).click();
  assert.equal(await htmlFrame.locator('#status').textContent(), '灯已点亮，欢迎回家。');
  assert.equal(await page.locator('#tavern-vault-root .content iframe').getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await htmlFrame.locator('body').evaluate(() => { try { return Boolean(window.parent.document.body); } catch { return false; } }), false);
  passed('保存的 HTML 自身脚本可交互，同时无法直接读取宿主 DOM');
  await page.screenshot({ path: path.join(evidenceRoot, 'library-desktop.png') });
  const readingLayout = () => page.locator('#tavern-vault-root .reader').evaluate(element => {
    const box = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    return { reader: box(element), content: box(element.querySelector('.content')), iframe: box(element.querySelector('iframe')) };
  });
  const expandedReading = { normal: await readingLayout(), narrow: [] };
  const filesBeforeExpand = await page.evaluate(() => window.previewVaultFiles());
  await page.getByRole('button', { name: /展开.*阅读区|展开正文/ }).click();
  expandedReading.expanded = await readingLayout();
  const expanded = expandedReading.expanded;
  assert(Math.abs(expanded.content.y - expanded.reader.y) <= 1 && Math.abs(expanded.content.height - expanded.reader.height) <= 1,
    `展开后正文应占满右侧阅读区：${JSON.stringify(expandedReading)}`);
  assert(Math.abs(expanded.iframe.width - expanded.reader.width) <= 1 && Math.abs(expanded.iframe.height - expanded.reader.height) <= 1);
  assert(Math.abs(expanded.reader.x - expandedReading.normal.reader.x) <= 1);
  assert.equal(await page.locator('#tavern-vault-root .sidebar').isVisible(), true);
  assert.equal(await page.locator('#tavern-vault-root .list-pane').isVisible(), true);
  await page.screenshot({ path: path.join(evidenceRoot, 'library-expanded.png'), animations: 'disabled' });
  assert.equal(await htmlFrame.locator('#status').textContent(), '灯已点亮，欢迎回家。');
  await htmlFrame.getByRole('button', { name: '让灯歇一会儿', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.locator('#tavern-vault-root .surface:not(.expanded)').waitFor();
  assert.equal(await htmlFrame.locator('#status').textContent(), '窗边还暗着。');
  await page.getByRole('button', { name: /展开.*阅读区|展开正文/ }).click();
  await page.getByRole('button', { name: '还原阅读区', exact: true }).click();
  assert.equal(await page.locator('#tavern-vault-root .reader-heading').isVisible(), true);
  assert.deepEqual(await page.evaluate(() => window.previewVaultFiles()), filesBeforeExpand);
  passed('展开正文占满右侧区域，分类列表保留；还原和 iframe 内 Escape 不重载页面或改动文件');
  await page.getByRole('tab', { name: '原文', exact: true }).click();
  assert.match(await page.locator('#tavern-vault-root .content pre').textContent(), /addEventListener\('click'/);
  assert.match(await page.locator('#tavern-vault-root .content pre').textContent(), /```html/);
  assert.equal(await page.getByRole('tab', { name: '来源详情', exact: true }).count(), 0);
  assert.match(await page.locator('#tavern-vault-root .reader-origin').textContent(), /雾港手记.*守灯人.*楼层 #1/);
  await page.getByRole('tab', { name: '原文', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: '页面', exact: true }).getAttribute('aria-selected'), 'true');
  passed('来源只在标题旁显示聊天、角色、楼层与收藏时间，没有单独来源页；原文视图不执行源码');

  await page.getByRole('button', { name: '整理', exact: true }).click();
  await form.locator('.title-input').fill('<img src=x onerror="window.__vaultInjected=1">');
  await form.getByRole('button', { name: '保存整理', exact: true }).click();
  await page.locator('#tavern-vault-root .sheet-veil').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#tavern-vault-root .reader-title img').count(), 0);
  assert.match(await page.locator('#tavern-vault-root .reader-title').textContent(), /^<img/);
  assert.equal(await page.evaluate(() => window.__vaultInjected), undefined);
  passed('标题中的 HTML 作为文字显示，不插入管理界面执行');
  await page.getByRole('button', { name: '整理', exact: true }).click();
  await form.locator('.title-input').fill('给晚归的旅人');
  await form.getByRole('button', { name: '保存整理', exact: true }).click();
  await page.locator('#tavern-vault-root .sheet-veil').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '关闭储藏库', exact: true }).click();
  await page.getByRole('button', { name: '换一段聊天', exact: true }).click();
  await page.getByRole('button', { name: '收藏楼层 #0', exact: true }).click();
  await form.locator('.title-input').fill('星河与归途');
  await form.locator('.category-select').selectOption({ label: '剧情片段' });
  await form.getByRole('button', { name: '保存到文件夹', exact: true }).click();
  await page.locator('#tavern-vault-root .sheet-veil').waitFor({ state: 'hidden' });
  assert.match(await page.locator('#tavern-vault-root .reader-origin').textContent(), /星河夜话 - 归途.*楼层 #0/);
  await page.getByRole('searchbox', { name: '搜索收藏' }).fill('雾港手记');
  assert.equal(await page.locator('#tavern-vault-root .item').count(), 2);
  await page.getByRole('searchbox', { name: '搜索收藏' }).fill('不存在的字串');
  await page.getByText('没有找到匹配内容', { exact: true }).waitFor();
  await page.getByRole('searchbox', { name: '搜索收藏' }).fill('');
  passed('跨聊天收藏、复用旧分类、按来源搜索和无结果状态');

  await page.getByRole('button', { name: '关闭储藏库', exact: true }).click();
  await page.getByRole('button', { name: '重载扩展', exact: true }).click();
  await page.getByRole('button', { name: '打开储藏库', exact: true }).waitFor();
  await page.getByRole('button', { name: '打开储藏库', exact: true }).click();
  await page.locator('#tavern-vault-root .item').first().waitFor();
  assert.equal(await page.locator('#tavern-vault-root').count(), 1);
  assert.equal(await page.locator('#chat [data-tv-owned="floor"]').count(), 2);
  assert.equal(await page.locator('#tavern-vault-root .item').count(), 3);
  passed('扩展重载后恢复同一模拟库，入口和楼层按钮无重复');

  await page.getByRole('button', { name: '收藏楼层', exact: true }).click();
  const floorForm = page.locator('#tavern-vault-root .number-sheet');
  await floorForm.locator('.floor-input').fill('1');
  await floorForm.getByRole('button', { name: '下一步', exact: true }).click();
  await form.locator('.title-input').fill('归途中的双页便笺');
  await form.locator('.category-select').selectOption({ label: 'HTML 页面' });
  await form.getByRole('button', { name: '保存到文件夹', exact: true }).click();
  await page.locator('#tavern-vault-root .sheet-veil').waitFor({ state: 'hidden' });
  await page.getByRole('combobox', { name: '选择 HTML 页面' }).selectOption('1');
  await page.frameLocator('#tavern-vault-root .content iframe').getByText('第二张便笺', { exact: true }).waitFor();
  passed('按楼层编号收藏和多 HTML 页面切换');
  await page.getByRole('button', { name: '关闭储藏库', exact: true }).click();
  await page.getByRole('button', { name: '打开储藏库', exact: true }).click();
  await page.frameLocator('#tavern-vault-root .content iframe').getByText('第二张便笺', { exact: true }).waitFor();
  passed('关闭重开后重新装载页面，不停留在空白阅读区');

  await page.getByRole('button', { name: '关闭储藏库', exact: true }).click();
  await page.evaluate(() => window.previewTaggedFloor());
  await page.getByRole('button', { name: '收藏楼层 #1', exact: true }).click();
  const beforeFiltering = await page.evaluate(() => Object.keys(window.previewVaultFiles()).length);
  await form.locator('.include-tag-input').fill('<absent>');
  await form.getByRole('button', { name: '保存到文件夹', exact: true }).click();
  assert.match(await form.locator('.form-error').textContent(), /没有找到 <absent>/);
  assert.equal(await page.evaluate(() => Object.keys(window.previewVaultFiles()).length), beforeFiltering);
  await form.locator('.include-tag-input').fill('<content>');
  await form.locator('.exclude-tags-input').fill('<image>');
  const filteredPreview = await form.locator('.selection-preview').textContent();
  assert.match(filteredPreview, /保留的故事/);
  assert.doesNotMatch(filteredPreview, /EXCLUDED_|OUTSIDE_FILTER_MARKER|尾部不收藏/);
  assert.doesNotMatch(await form.locator('.title-input').inputValue(), /EXCLUDED_|OUTSIDE_FILTER_MARKER/);
  await form.locator('.title-input').fill('按标签留下的故事');
  await page.screenshot({ path: path.join(evidenceRoot, 'collector-desktop.png') });
  await form.getByRole('button', { name: '保存到文件夹', exact: true }).click();
  await page.locator('#tavern-vault-root .sheet-veil').waitFor({ state: 'hidden' });
  await page.frameLocator('#tavern-vault-root .content iframe').getByRole('button', { name: '保留按钮', exact: true }).click();
  await page.frameLocator('#tavern-vault-root .content iframe').getByRole('button', { name: '已保留交互', exact: true }).waitFor();
  const savedFiltered = await page.evaluate(() => {
    const files = window.previewVaultFiles();
    const record = JSON.parse(files['/tavern-vault.json']).entries.find(entry => entry.title === '按标签留下的故事');
    return { record, files: [[`/items/${record.content.folder}/${record.content.originalFile}`, files[`/items/${record.content.folder}/${record.content.originalFile}`]]] };
  });
  assert.deepEqual(Object.keys(savedFiltered.record.source).sort(), ['characterName', 'chatId', 'messageId']);
  for (const text of Object.values(await page.evaluate(() => window.previewVaultFiles()))) assert.doesNotMatch(text, /EXCLUDED_|OUTSIDE_FILTER_MARKER|尾部不收藏/);
  passed('先提取再排除：实时预览、缺失标签阻止写入、HTML 交互及所有保存文件无排除内容残留');

  // Edits remain memory-only drafts until the user activates the explicit confirmation button.
  const filteredId = savedFiltered.record.id;
  const beforeEditFiles = await page.evaluate(() => window.previewVaultFiles());
  const originalFiltered = savedFiltered.files.find(([name]) => name.endsWith(`/${savedFiltered.record.content.originalFile}`))[1];
  await page.locator('#tavern-vault-root .reader-title').dblclick();
  const editor = page.locator('#tavern-vault-root .body-input');
  await editor.waitFor({ state: 'visible' });
  assert.equal(await editor.inputValue(), originalFiltered);
  await editor.fill('DRAFT_MUST_NOT_SAVE');
  await editor.press('Enter');
  await form.locator('.submit-button').focus();
  assert.deepEqual(await page.evaluate(() => window.previewVaultFiles()), beforeEditFiles);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '编辑内容', exact: true }).click();
  assert.equal(await editor.inputValue(), originalFiltered);
  await editor.fill('CANCELLED_DRAFT_MUST_NOT_SAVE');
  await form.getByRole('button', { name: '取消', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.previewVaultFiles()), beforeEditFiles);
  passed('双击打开编辑；输入、失焦、Escape 和取消均不写入本地，重开仍为原内容');

  await page.getByRole('tab', { name: '页面', exact: true }).click();
  const editFrame = page.frameLocator('#tavern-vault-root .content iframe');
  await editFrame.getByText('保留的故事', { exact: true }).dblclick();
  await editor.waitFor({ state: 'visible' });
  const updatedHtml = '<div><p id="edited-story">编辑后的故事</p><button id="edited-button" onclick="this.textContent=\'修改后的交互可用\'">测试修改后的按钮</button></div>';
  await editor.fill(updatedHtml);
  assert.deepEqual(await page.evaluate(() => window.previewVaultFiles()), beforeEditFiles);
  await page.screenshot({ path: path.join(evidenceRoot, 'editor-desktop.png'), animations: 'disabled' });
  await form.getByRole('button', { name: '确认保存到本地', exact: true }).click();
  await page.locator('#tavern-vault-root .sheet-veil').waitFor({ state: 'hidden' });
  await page.frameLocator('#tavern-vault-root .content iframe').getByRole('button', { name: '测试修改后的按钮', exact: true }).click();
  await page.frameLocator('#tavern-vault-root .content iframe').getByRole('button', { name: '修改后的交互可用', exact: true }).waitFor();
  await page.frameLocator('#tavern-vault-root .content iframe').getByRole('button', { name: '修改后的交互可用', exact: true }).dblclick();
  assert.equal(await page.locator('#tavern-vault-root .sheet-veil').isVisible(), false);
  const editedFiles = await page.evaluate(() => window.previewVaultFiles());
  const editedRecord = JSON.parse(editedFiles['/tavern-vault.json']).entries.find(entry => entry.id === filteredId);
  assert.deepEqual(editedRecord.source, savedFiltered.record.source);
  assert.equal(editedRecord.savedAt, savedFiltered.record.savedAt);
  assert.equal(editedRecord.cleanup, undefined);
  assert(editedRecord.editedAt);
  assert.equal(editedFiles[`/items/${editedRecord.content.folder}/${editedRecord.content.originalFile}`], updatedHtml);
  for (const text of Object.values(editedFiles)) assert.doesNotMatch(text, /保留的故事|DRAFT_MUST_NOT_SAVE|CANCELLED_DRAFT/);
  passed('HTML 正文双击进入源码编辑；确认后原文和交互页面同步、旧内容清除，页面按钮双击保持自身交互');

  // The page bridge can request opening a draft only; foreign or unrelated messages are ignored.
  await page.evaluate(() => window.postMessage({ type: 'tavern-vault:edit-content', token: 'foreign-token' }, location.origin));
  assert.equal(await page.locator('#tavern-vault-root .sheet-veil').isVisible(), false);
  await page.locator('#tavern-vault-root .item').filter({ hasText: '雨停后的重逢' }).dblclick();
  await editor.waitFor({ state: 'visible' });
  await editor.fill('编辑后的重逢故事');
  await form.getByRole('button', { name: '确认保存到本地', exact: true }).click();
  await page.locator('#tavern-vault-root .sheet-veil').waitFor({ state: 'hidden' });
  await page.getByRole('tab', { name: '原文', exact: true }).click();
  await page.locator('#tavern-vault-root .content pre').dblclick();
  assert.equal(await editor.inputValue(), '编辑后的重逢故事');
  await form.getByRole('button', { name: '关闭收藏栏', exact: true }).click();
  await page.getByRole('button', { name: '关闭储藏库', exact: true }).click();
  await page.getByRole('button', { name: '重载扩展', exact: true }).click();
  await page.getByRole('button', { name: '打开储藏库', exact: true }).waitFor();
  await page.getByRole('button', { name: '打开储藏库', exact: true }).click();
  await page.locator('#tavern-vault-root .item').filter({ hasText: '雨停后的重逢' }).click();
  await page.getByRole('tab', { name: '原文', exact: true }).click();
  assert.equal(await page.locator('#tavern-vault-root .content pre').textContent(), '编辑后的重逢故事');
  passed('列表双击与原文双击均能编辑，重载后从同一文件夹恢复修改，外来消息不能打开编辑栏');

  await page.locator('#tavern-vault-root .item').filter({ hasText: '星河与归途' }).dblclick();
  const priorFailureFiles = await page.evaluate(() => window.previewVaultFiles());
  await editor.fill('写入重试后的归途');
  await page.evaluate(() => window.previewFsFailure({ fail: '/星河与归途.txt' }));
  await form.getByRole('button', { name: '确认保存到本地', exact: true }).click();
  await form.locator('.form-error').waitFor({ state: 'visible' });
  assert.match(await form.locator('.form-error').textContent(), /磁盘空间不足/);
  assert.equal(await editor.inputValue(), '写入重试后的归途');
  assert.deepEqual(await page.evaluate(() => window.previewVaultFiles()), priorFailureFiles);
  await page.evaluate(() => window.previewFsFailure({ fail: '' }));
  await form.getByRole('button', { name: '确认保存到本地', exact: true }).click();
  await page.locator('#tavern-vault-root .sheet-veil').waitFor({ state: 'hidden' });
  const afterRetry = await page.evaluate(() => window.previewVaultFiles());
  assert.equal(afterRetry['/items/剧情片段/星河与归途.txt'], '写入重试后的归途');
  passed('写入失败保留编辑草稿与原 TXT，重试确认后直接替换同一个 TXT');

  const beforeRename = await page.evaluate(() => window.previewVaultFiles());
  await page.getByRole('button', { name: '整理', exact: true }).click();
  await form.locator('.title-input').fill('归途/续章');
  assert.equal(await form.locator('.file-hint').textContent(), '本地原文：items/剧情片段/归途_续章.txt');
  await form.getByRole('button', { name: '取消', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.previewVaultFiles()), beforeRename);
  await page.getByRole('button', { name: '整理', exact: true }).click();
  await form.locator('.title-input').fill('归途/续章');
  await form.getByRole('button', { name: '保存整理', exact: true }).click();
  await page.locator('#tavern-vault-root .sheet-veil').waitFor({ state: 'hidden' });
  const afterRename = await page.evaluate(() => window.previewVaultFiles());
  const renamedRecord = JSON.parse(afterRename['/tavern-vault.json']).entries.find(entry => entry.title === '归途/续章');
  assert(renamedRecord);
  assert.equal(renamedRecord.content.originalFile, '归途_续章.txt');
  assert.equal(afterRename['/items/剧情片段/归途_续章.txt'], '写入重试后的归途');
  assert.equal(afterRename['/items/剧情片段/星河与归途.txt'], undefined);
  await page.getByRole('button', { name: '关闭储藏库', exact: true }).click();
  await page.getByRole('button', { name: '重载扩展', exact: true }).click();
  await page.getByRole('button', { name: '打开储藏库', exact: true }).click();
  await page.locator('#tavern-vault-root .item').filter({ hasText: '归途/续章' }).click();
  await page.getByRole('tab', { name: '原文', exact: true }).click();
  assert.equal(await page.locator('#tavern-vault-root .content pre').textContent(), '写入重试后的归途');
  passed('整理时预览安全文件名，取消不写盘，确认后同步改名、清理旧名称并可重载恢复');

  const beforeCategory = await page.evaluate(() => window.previewVaultFiles());
  await page.getByRole('button', { name: '整理', exact: true }).click();
  await form.locator('.category-select').selectOption({ label: 'HTML 页面' });
  assert.equal(await form.locator('.file-hint').textContent(), '本地原文：items/HTML 页面/归途_续章.txt');
  await form.getByRole('button', { name: '取消', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.previewVaultFiles()), beforeCategory);
  await page.getByRole('button', { name: '整理', exact: true }).click();
  await form.locator('.category-select').selectOption({ label: 'HTML 页面' });
  await form.getByRole('button', { name: '保存整理', exact: true }).click();
  await page.locator('#tavern-vault-root .sheet-veil').waitFor({ state: 'hidden' });
  const afterCategory = await page.evaluate(() => window.previewVaultFiles());
  assert.equal(afterCategory['/items/剧情片段/归途_续章.txt'], undefined);
  assert.equal(afterCategory['/items/HTML 页面/归途_续章.txt'], '写入重试后的归途');
  const movedRecord = JSON.parse(afterCategory['/tavern-vault.json']).entries.find(entry => entry.title === '归途/续章');
  assert.equal(movedRecord.content.folder, 'HTML 页面');
  assert.deepEqual(movedRecord.source, renamedRecord.source);
  assert.equal(movedRecord.savedAt, renamedRecord.savedAt);
  passed('改分类实时显示分类路径，取消不搬动；确认后 TXT 移到目标分类，原文和简要来源保留');

  const beforeDelete = await page.evaluate(() => window.previewVaultFiles());
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '删除收藏', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.previewVaultFiles()), beforeDelete);
  await page.evaluate(() => window.previewFsFailure({ failRemove: '/归途_续章.txt' }));
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '删除收藏', exact: true }).click();
  await page.getByRole('button', { name: '重试清理已删除文件', exact: true }).waitFor();
  assert.equal(await page.locator('#tavern-vault-root .item').filter({ hasText: '归途/续章' }).count(), 0);
  await page.evaluate(() => window.previewFsFailure({ failRemove: '' }));
  await page.getByRole('button', { name: '重试清理已删除文件', exact: true }).click();
  await page.getByRole('button', { name: '重试清理已删除文件', exact: true }).waitFor({ state: 'hidden' });
  assert.equal((await page.evaluate(() => window.previewVaultFiles()))['/items/HTML 页面/归途_续章.txt'], undefined);
  passed('删除按钮可见，取消保留文件；确认删除移除收藏，文件清理失败可明确重试');

  await page.evaluate(() => window.previewLegacyRecord());
  await page.getByRole('button', { name: '重新读取文件夹', exact: true }).click();
  const migrateButton = page.getByRole('button', { name: '按分类整理旧收藏', exact: true });
  await migrateButton.waitFor();
  const beforeMigrate = await page.evaluate(() => window.previewVaultFiles());
  page.once('dialog', dialog => dialog.dismiss()); await migrateButton.click();
  assert.deepEqual(await page.evaluate(() => window.previewVaultFiles()), beforeMigrate);
  page.once('dialog', dialog => dialog.accept()); await migrateButton.click();
  await migrateButton.waitFor({ state: 'hidden' });
  const afterMigrate = await page.evaluate(() => window.previewVaultFiles());
  assert(afterMigrate['/items/未分类/旧时的片刻.txt']);
  assert(!Object.keys(afterMigrate).some(name => name.startsWith('/items/legacy-demo/')));
  await page.locator('#tavern-vault-root .item').filter({ hasText: '旧时的片刻' }).click();
  await page.getByRole('tab', { name: '页面', exact: true }).click();
  await page.frameLocator('#tavern-vault-root .content iframe').getByRole('button', { name: '旧页按钮', exact: true }).click();
  await page.frameLocator('#tavern-vault-root .content iframe').getByRole('button', { name: '123', exact: true }).waitFor();
  passed('旧库整理取消不改文件，确认后变为 items/分类名/标题.txt，清理旧目录并保留源码页面交互');

  const dimensions = [];
  for (const width of [390, 320]) {
    const narrow = await context.newPage();
    await narrow.setViewportSize({ width, height: 844 });
    narrow.on('pageerror', error => errors.push(error.message));
    await narrow.goto(url);
    assert.equal(await narrow.getByRole('button', { name: '从扩展设置打开储藏库', exact: true }).evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element); return range.getClientRects().length;
    }), 1);
    await narrow.getByRole('button', { name: '收藏楼层 #1', exact: true }).click();
    const narrowForm = narrow.locator('#tavern-vault-root .sheet');
    await narrowForm.getByRole('button', { name: '选择文件夹', exact: true }).click();
    await narrow.locator('#tavern-vault-root .connection-dot.connected').waitFor();
    await narrowForm.locator('.title-input').fill('给晚归的旅人');
    await narrowForm.locator('.include-tag-input').fill('<missing>');
    assert.match(await narrowForm.locator('.selection-status').textContent(), /没有找到/);
    assert(await narrowForm.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    await narrowForm.locator('.include-tag-input').fill('');
    await narrowForm.locator('.title-input').focus();
    const saveBounds = await narrowForm.locator('.submit-button').boundingBox();
    assert(saveBounds.y >= 0 && saveBounds.y + saveBounds.height <= 844, '窄窗中保存按钮应留在可见范围');
    await narrowForm.getByRole('button', { name: '保存到文件夹', exact: true }).click();
    await narrow.locator('#tavern-vault-root .sheet-veil').waitFor({ state: 'hidden' });
    const frame = narrow.frameLocator('#tavern-vault-root .content iframe');
    await frame.getByRole('button', { name: '点亮一盏灯', exact: true }).click();
    assert.equal(await frame.locator('#status').textContent(), '灯已点亮，欢迎回家。');
    await frame.locator('body').evaluate(() => window.scrollTo(0, 0));
    dimensions.push(await narrow.locator('#tavern-vault-root .surface').evaluate(element => ({
      viewport: window.innerWidth, width: element.getBoundingClientRect().width, scroll: element.scrollWidth, client: element.clientWidth,
    })));
    await narrow.screenshot({ path: path.join(evidenceRoot, `library-${width}.png`) });
    await narrow.getByRole('button', { name: '展开正文', exact: true }).click();
    const narrowExpanded = await narrow.locator('#tavern-vault-root .reader').evaluate(element => {
      const reader = element.getBoundingClientRect();
      const frame = element.querySelector('iframe').getBoundingClientRect();
      return { width: innerWidth, readerHeight: reader.height, frameHeight: frame.height, readerWidth: reader.width, frameWidth: frame.width, topGap: frame.y - reader.y };
    });
    assert(Math.abs(narrowExpanded.readerHeight - narrowExpanded.frameHeight) <= 1 && Math.abs(narrowExpanded.readerWidth - narrowExpanded.frameWidth) <= 1 && Math.abs(narrowExpanded.topGap) <= 1);
    expandedReading.narrow.push(narrowExpanded);
    if (width === 320) await narrow.screenshot({ path: path.join(evidenceRoot, 'library-expanded-320.png'), animations: 'disabled' });
    await narrow.getByRole('button', { name: '还原阅读区', exact: true }).click();
    assert.equal(await frame.locator('#status').textContent(), '灯已点亮，欢迎回家。');
    const narrowFiles = await narrow.evaluate(() => window.previewVaultFiles());
    await narrow.getByRole('button', { name: '编辑内容', exact: true }).click();
    await narrow.locator('#tavern-vault-root .body-input').fill('窄窗取消的编辑草稿');
    assert(await narrowForm.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    const confirmBounds = await narrowForm.locator('.submit-button').boundingBox();
    assert(confirmBounds.y >= 0 && confirmBounds.y + confirmBounds.height <= 844);
    if (width === 320) await narrow.screenshot({ path: path.join(evidenceRoot, 'editor-320.png'), animations: 'disabled' });
    await narrow.keyboard.press('Escape');
    assert.deepEqual(await narrow.evaluate(() => window.previewVaultFiles()), narrowFiles);
    await narrow.getByRole('button', { name: '返回列表', exact: true }).click();
    assert.equal(await narrow.locator('#tavern-vault-root .list-pane').isVisible(), true);
    await narrow.getByRole('button', { name: '收藏楼层', exact: true }).click();
    await narrow.keyboard.press('Escape');
    assert.equal(await narrow.locator('#tavern-vault-root .number-veil').isVisible(), false);
    await narrow.close();
  }
  assert(dimensions.every(item => item.scroll <= item.client + 1));
  passed('390px 和 320px 窄窗无管理界面横向溢出，可阅读 HTML、返回列表、按 Escape 关闭弹层');
  assert.deepEqual(errors, []);
  passed('上述测试无未处理页面脚本异常');
  const nativePage = await context.newPage();
  await nativePage.goto(new URL('native-fs.html', url).href);
  const nativeFs = await nativePage.evaluate(async () => {
    const { VaultStorage, DirectoryMemory } = await import('/src/storage.js');
    const originDirectory = await navigator.storage.getDirectory();
    const directory = await originDirectory.getDirectoryHandle(`vault-check-${crypto.randomUUID()}`, { create: true });
    const nativePermissionMethods = typeof directory.queryPermission === 'function';
    const adapt = handle => nativePermissionMethods ? handle : new Proxy(handle, {
      get(target, key) {
        if (key === 'queryPermission' || key === 'requestPermission') return async () => 'granted';
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const storage = new VaultStorage(window);
    await storage.attach(adapt(directory));
    const original = '原生文件系统\r\n```html\n<button>原生保存</button>\n```';
    const result = await storage.save({ original, rendered: '<p>原生文件</p>',
      source: { chatId: '原生文件读写测试', chatName: '原生文件读写测试', messageId: 17, swipeId: 0,
        speakerName: '合成测试', role: 'assistant', characterOrGroupId: 'native-test', origin: location.origin },
      pages: [{ label: '交互页', html: '<button>原生保存</button>', kind: 'source' }], warnings: [] },
      { title: '原生读写记录', newCategory: '文件系统检查' });
    const memory = new DirectoryMemory(window);
    await memory.set(directory);
    const restoredHandle = await memory.get();
    const restored = new VaultStorage(window);
    await restored.attach(adapt(restoredHandle), false);
    if (restored.entries[0].original !== original || restored.entries[0].id !== result.entry.id) throw new Error('原生文件恢复不一致');
    if (await restored.readPage(restored.entries[0], 0) !== '<button>原生保存</button>') throw new Error('原生 HTML 恢复不一致');
    const { editToken } = await import('/src/core.js');
    const edited = await restored.updateContent(result.entry.id, '<div>原生编辑已保存</div>', {
      confirmed: true, expectedToken: editToken(restored.entries[0]), expectedLibraryId: restored.meta.libraryId });
    if (edited.cleanupPending) throw new Error('原生旧文件清理未完成');
    const afterEdit = new VaultStorage(window); await afterEdit.attach(adapt(restoredHandle), false);
    if (afterEdit.entries[0].original !== '<div>原生编辑已保存</div>') throw new Error('原生编辑恢复失败');
    const itemDirectory = await directory.getDirectoryHandle('items');
    const renamed = await afterEdit.edit(result.entry.id, { title: '原生/改名', categoryId: afterEdit.entries[0].categoryId,
      expectedToken: editToken(afterEdit.entries[0]), expectedLibraryId: afterEdit.meta.libraryId });
    if (renamed.cleanup || renamed.content.originalFile !== '原生_改名.txt') throw new Error('原生标题改名失败');
    const namedDirectory = await itemDirectory.getDirectoryHandle(renamed.content.folder);
    if (await (await (await namedDirectory.getFileHandle('原生_改名.txt')).getFile()).text() !== '<div>原生编辑已保存</div>') throw new Error('原生标题文件内容不一致');
    const afterRename = new VaultStorage(window); await afterRename.attach(adapt(restoredHandle), false);
    if (afterRename.entries[0].title !== '原生/改名' || await afterRename.readPage(afterRename.entries[0], 0) !== '<div>原生编辑已保存</div>') throw new Error('原生改名重读失败');
    const moved = await afterRename.edit(result.entry.id, { title: renamed.title, newCategory: '原生移动分类',
      expectedToken: editToken(afterRename.entries[0]), expectedLibraryId: afterRename.meta.libraryId });
    if (moved.cleanup || moved.content.folder !== '原生移动分类') throw new Error('原生分类移动失败');
    const movedDirectory = await itemDirectory.getDirectoryHandle('原生移动分类');
    if (await (await (await movedDirectory.getFileHandle(moved.content.originalFile)).getFile()).text() !== '<div>原生编辑已保存</div>') throw new Error('原生移动内容不一致');
    let oldNameExists = false;
    try { await namedDirectory.getFileHandle(renamed.content.originalFile); oldNameExists = true; } catch (error) { if (error.name !== 'NotFoundError') throw error; }
    if (oldNameExists) throw new Error('原分类还保留旧 TXT');
    const afterMove = new VaultStorage(window); await afterMove.attach(adapt(restoredHandle), false);
    if (afterMove.entries[0].content.folder !== '原生移动分类') throw new Error('原生移动重载失败');
    const deleted = await afterMove.delete(result.entry.id, { confirmed: true, expectedToken: editToken(afterMove.entries[0]), expectedLibraryId: afterMove.meta.libraryId });
    if (deleted.cleanupPending) throw new Error('原生 TXT 删除失败');
    for await (const handle of itemDirectory.values()) {
      if (handle.kind !== 'directory') throw new Error('删除后仍有收藏文件');
      for await (const child of handle.values()) throw new Error('分类内仍有收藏文件');
    }
    return { categoryFolderRoundTrip: true, categoryMoveRoundTrip: true, deleteRoundTrip: true, categoryTextOnly: true, namedFilesRoundTrip: true, titleRenameRoundTrip: true, confirmedEditRoundTrip: true, oldContentRemoved: true, kind: 'origin-private-file-system', directoryHandleNative: true, nativePermissionMethods,
      originalRestored: true, pagesRestored: true, nativeIndexedDbHandleRoundTrip: true,
      userChosenExternalFolder: false };
  });
  await nativePage.close();
  passed('浏览器原生文件系统实际写入、重读与 IndexedDB 目录句柄恢复（不是外部文件夹授权）');
  const build = JSON.parse(await fs.readFile(path.join(root, 'dist/build-manifest.json'), 'utf8'));
  const evidence = { date: new Date().toISOString(), kind: 'synthetic-browser', productVersion: '0.6.0', browser: browser.version(),
    realSillyTavern: false, fileSystem: 'in-memory FileSystemDirectoryHandle adapter', build,
    results, errors, dimensions, settingsLayout, expandedReading, nativeFs, screenshots: {} };
  for (const name of await fs.readdir(evidenceRoot)) if (name.endsWith('.png')) {
    evidence.screenshots[name] = crypto.createHash('sha256').update(await fs.readFile(path.join(evidenceRoot, name))).digest('hex');
  }
  await fs.writeFile(path.join(root, 'docs/browser-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ passed: results.length, errors, dimensions, browser: browser.version() }));
} catch (error) {
  console.error(error);
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) await page.screenshot({ path: path.join(root, '.checks', 'browser-failure.png') }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
