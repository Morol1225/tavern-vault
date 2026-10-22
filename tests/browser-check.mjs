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
  assert.match(await page.locator('#tavern-vault-root .reader-origin').textContent(), /雾港手记 - 重逢 · 楼层 #0/);
  passed('每楼收藏、新建分类、来源与原文在实际界面中关联');

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
  await page.getByRole('tab', { name: '原文', exact: true }).click();
  assert.match(await page.locator('#tavern-vault-root .content pre').textContent(), /addEventListener\('click'/);
  assert.match(await page.locator('#tavern-vault-root .content pre').textContent(), /```html/);
  await page.getByRole('tab', { name: '来源详情', exact: true }).click();
  assert.match(await page.locator('#tavern-vault-root .content').textContent(), /雾港手记 - 重逢/);
  await page.getByRole('tab', { name: '原文', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: '来源详情', exact: true }).getAttribute('aria-selected'), 'true');
  passed('原文视图不执行源码，来源详情保持原聊天与楼层');

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
  assert.match(await page.locator('#tavern-vault-root .reader-origin').textContent(), /星河夜话 - 归途 · 楼层 #0/);
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
    const marker = Object.entries(files).find(([name, body]) => name.endsWith('/entry.json') && JSON.parse(body).title === '按标签留下的故事');
    const prefix = marker[0].slice(0, -'entry.json'.length);
    return { record: JSON.parse(marker[1]), files: Object.entries(files).filter(([name]) => name.startsWith(prefix)) };
  });
  assert.equal(savedFiltered.record.source.selection.includeTag, 'content');
  assert.deepEqual(savedFiltered.record.source.selection.excludeTags, ['image']);
  for (const [, text] of savedFiltered.files) assert.doesNotMatch(text, /EXCLUDED_|OUTSIDE_FILTER_MARKER|尾部不收藏/);
  await page.getByRole('tab', { name: '来源详情', exact: true }).click();
  assert.match(await page.locator('#tavern-vault-root .content').textContent(), /<content>[\s\S]*<image>/);
  passed('先提取再排除：实时预览、缺失标签阻止写入、HTML 交互及所有保存文件无排除内容残留');

  const dimensions = [];
  for (const width of [390, 320]) {
    const narrow = await context.newPage();
    await narrow.setViewportSize({ width, height: 844 });
    narrow.on('pageerror', error => errors.push(error.message));
    await narrow.goto(url);
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
    const original = '原生文件系统\r\n逐字恢复：<script>const x = 1;<\/script>';
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
    return { kind: 'origin-private-file-system', directoryHandleNative: true, nativePermissionMethods,
      originalRestored: true, pagesRestored: true, nativeIndexedDbHandleRoundTrip: true,
      userChosenExternalFolder: false };
  });
  await nativePage.close();
  passed('浏览器原生文件系统实际写入、重读与 IndexedDB 目录句柄恢复（不是外部文件夹授权）');
  const build = JSON.parse(await fs.readFile(path.join(root, 'dist/build-manifest.json'), 'utf8'));
  const evidence = { date: new Date().toISOString(), kind: 'synthetic-browser', productVersion: '0.2.0', browser: browser.version(),
    realSillyTavern: false, fileSystem: 'in-memory FileSystemDirectoryHandle adapter', build,
    results, errors, dimensions, nativeFs, screenshots: {} };
  for (const name of await fs.readdir(evidenceRoot)) if (name.endsWith('.png')) {
    evidence.screenshots[name] = crypto.createHash('sha256').update(await fs.readFile(path.join(evidenceRoot, name))).digest('hex');
  }
  await fs.writeFile(path.join(root, 'docs/browser-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ passed: results.length, errors, dimensions, browser: browser.version() }));
} catch (error) {
  console.error(error);
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) await page.screenshot({ path: path.join(evidenceRoot, 'failure.png') }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
