import { VERSION, UNFILED, sourceLabel, normalized, friendlyError, assert, editToken, compactSource } from './core.js';
import { captureFloor, preparePreview } from './capture.js';
import { selectDraft } from './selection.js';

const ICON_PATHS = {
  shelf: '<path d="M4 4h16v16H4zM4 12h16M8 4v8m5-8v8m4 2v6M8 14v6"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
  folder: '<path d="M3 7h7l2-3h8a1 1 0 0 1 1 1v14H3z"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 10a8 8 0 1 0-1 7M20 4v6h-6"/>',
  arrow: '<path d="m10 5-7 7 7 7M3 12h18"/>',
  expand: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.bookmark}</svg>`;
}

const SHELL = `
<button class="launcher" data-action="open" type="button" aria-label="打开储藏库">${icon('shelf')}<span>储藏库</span></button>
<div class="veil" hidden>
  <section class="surface" role="dialog" aria-modal="true" aria-label="储藏库" tabindex="-1">
    <header class="topbar">
      <div class="brand"><span class="brand-icon">${icon('shelf')}</span><div><h1>储藏库</h1><p>把值得留下的片刻，妥善收藏。</p></div></div>
      <div class="top-actions">
        <button data-action="collect-number" type="button" class="soft">${icon('plus')}<span>收藏楼层</span></button>
        <button data-action="refresh" type="button" class="icon-button" title="重新读取文件夹" aria-label="重新读取文件夹">${icon('refresh')}</button>
        <button data-action="close" type="button" class="icon-button" title="关闭" aria-label="关闭储藏库">${icon('close')}</button>
      </div>
    </header>
    <div class="body">
      <aside class="sidebar">
        <div class="side-heading"><h2>我的收藏</h2><span class="count">0</span></div>
        <nav class="categories" aria-label="收藏分类"></nav>
        <button data-action="new-category" type="button" class="add-category">${icon('plus')}新建分类</button>
        <div class="folder-box">
          <span class="folder-icon">${icon('folder')}</span><h3 class="folder-name">还没有连接文件夹</h3>
          <p class="folder-status">收藏会保存在你选择的电脑文件夹里。</p>
          <button data-action="connect" type="button" class="connect">选择收藏文件夹</button>
          <button data-action="choose" type="button" class="change-folder" hidden>换个文件夹</button>
          <button data-action="migrate" type="button" class="connect" hidden>按分类整理旧收藏</button>
          <button data-action="retry-deletions" type="button" class="connect" hidden>重试清理已删除文件</button>
        </div>
      </aside>
      <section class="list-pane" aria-label="收藏列表">
        <div class="list-heading"><h2 class="filter-name">全部收藏</h2><span class="result-count"></span></div>
        <label class="search">${icon('search')}<input type="search" placeholder="搜索内容、标题或聊天" aria-label="搜索收藏" autocomplete="off"></label>
        <div class="items" role="list"></div>
      </section>
      <section class="reader" aria-label="收藏阅读区">
        <button class="restore-reader" data-action="restore-reader" type="button" aria-label="还原阅读区" title="还原阅读区" hidden>${icon('expand')}<span>还原</span></button>
        <div class="reader-empty">
          <div class="empty-illustration">${icon('bookmark')}<i></i><i></i><i></i></div>
          <h2>留住一段喜欢的对话</h2><p>连接收藏文件夹后，点击聊天楼层旁的“收藏”。<br>留下的文字和页面，都可以在这里慢慢读。</p>
          <button class="primary" data-action="connect" type="button">${icon('folder')}选择收藏文件夹</button>
        </div>
        <div class="reader-filled" hidden>
          <header class="reader-heading">
            <div class="reader-tools"><button data-action="back-list" type="button" class="text-button back-list">${icon('arrow')}返回列表</button><span class="reader-category"></span><div class="reader-secondary"><button data-action="edit-content" type="button" class="text-button">编辑内容</button><button data-action="edit" type="button" class="text-button">整理</button><button data-action="delete" type="button" class="text-button danger-button">删除收藏</button><button data-action="expand" type="button" class="icon-button" aria-label="展开正文" title="展开正文" aria-expanded="false" aria-controls="tv-content">${icon('expand')}</button></div></div>
            <div class="reader-title-row"><h2 class="reader-title"></h2><p class="reader-origin"></p></div><div class="cleanup-note" hidden><span>新内容已保存，旧文件清理尚未完成。</span><button type="button" data-action="cleanup-content" class="text-button">重试清理</button></div>
          </header>
          <div class="viewbar"><div role="tablist" aria-label="收藏查看方式"><button type="button" role="tab" data-view="page" aria-selected="true">页面</button><button type="button" role="tab" data-view="original" aria-selected="false">原文</button></div><button type="button" data-action="reload-page" class="text-button" title="重新运行当前页面" aria-label="重新运行当前页面">${icon('refresh')}</button></div>
          <div class="page-tools"><label>查看<select class="page-select" aria-label="选择 HTML 页面"></select></label><span>独立预览</span></div>
          <div class="content" role="tabpanel" tabindex="0"></div><div class="page-notes" hidden></div>
        </div>
      </section>
    </div>
    <footer class="statusbar"><span class="connection-dot"></span><span class="notice" role="status" aria-live="polite">请选择收藏文件夹。</span><span class="issue-count"></span></footer>
    <div class="sheet-veil" hidden>
      <form class="sheet" role="dialog" aria-modal="true" aria-labelledby="tv-sheet-title">
        <header><span class="sheet-symbol">${icon('bookmark')}</span><div><h2 id="tv-sheet-title">收藏楼层</h2><p class="sheet-intro">保存此刻的内容，以后随时重读。</p></div><button type="button" data-action="cancel-form" class="icon-button" aria-label="关闭收藏栏">${icon('close')}</button></header>
        <p class="draft-source"></p><p class="draft-summary"></p>
        <label class="field title-field"><span class="title-label">收藏标题</span><input class="title-input" required maxlength="160" autocomplete="off"><small class="file-hint"></small></label>
        <div class="category-fields"><label class="field">归入分类<select class="category-select"></select></label><button type="button" class="new-category-toggle text-button" data-action="toggle-category">${icon('plus')}新建分类</button><label class="field new-category-field" hidden>新分类名称<input class="new-category-input" maxlength="80" autocomplete="off" placeholder="例如：喜欢的剧情"></label></div>
        <section class="editor-fields" hidden>
          <p class="editor-help">编辑文字或 HTML 源码。点击“确认保存到本地”前只修改草稿；确认后替换本地内容，不保留旧版本。</p>
          <label class="field">收藏内容<textarea class="body-input" aria-label="编辑收藏内容" spellcheck="false" rows="14" required disabled></textarea></label>
          <p class="editor-state" role="status" aria-live="polite">内容尚未修改。</p>
        </section>
        <section class="selection-fields" aria-label="收藏内容筛选">
          <div class="selection-heading"><h3>只留下想收藏的部分</h3><span>可选 · 留空保存整楼</span></div>
          <div class="selection-inputs"><label class="field">只提取这个标签内的内容<input class="include-tag-input" autocomplete="off" placeholder="例如：<content>" aria-describedby="tv-selection-help"></label><label class="field">再排除这些标签及其内容<input class="exclude-tags-input" autocomplete="off" placeholder="例如：<image>，thinking" aria-describedby="tv-selection-help"></label></div>
          <p id="tv-selection-help" class="selection-help">先提取，再排除。提取标签本身不保存；多个同名片段一起保留。排除多个标签时，用逗号分隔。</p>
          <p class="selection-status" role="status" aria-live="polite"></p><pre class="selection-preview" tabindex="0" aria-label="待保存原文预览"></pre>
        </section>
        <div class="sheet-folder"><span class="sheet-folder-name">保存前，请先选择收藏文件夹。</span><button type="button" data-action="connect" class="text-button">选择 / 授权文件夹</button></div>
        <p class="form-error" role="alert" hidden></p>
        <footer><button type="button" data-action="cancel-form" class="secondary">取消</button><button type="submit" class="primary submit-button">保存到文件夹</button></footer>
      </form>
    </div>
    <div class="number-veil" hidden><form class="number-sheet" role="dialog" aria-modal="true" aria-labelledby="tv-number-title"><h2 id="tv-number-title">收藏指定楼层</h2><p>填写酒馆显示的楼层编号，暂未显示的旧楼层也可以收藏。</p><label class="field">楼层编号<input type="number" min="0" step="1" required class="floor-input"></label><p class="floor-error" role="alert" hidden></p><footer><button type="button" data-action="cancel-number" class="secondary">取消</button><button class="primary" type="submit">下一步</button></footer></form></div>
  </section>
</div>`;

export class VaultUI {
  constructor(host, storage, memory, css) {
    this.host = host;
    this.storage = storage;
    this.memory = memory;
    this.category = '*';
    this.query = '';
    this.selectedId = null;
    this.view = 'page';
    this.pageIndex = 0;
    this.readerToken = 0;
    this.busy = false;
    this.mode = null;
    this.pendingDirectory = null;
    this.alive = true;
    this.connectionEpoch = 0;
    this.node = host.document.createElement('div');
    this.node.id = 'tavern-vault-root';
    this.node.dataset.version = VERSION;
    this.node.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
    this.root = this.node.attachShadow({ mode: 'open' });
    const style = host.document.createElement('style');
    style.textContent = css;
    this.root.append(style);
    const container = host.document.createElement('div');
    container.innerHTML = SHELL;
    this.root.append(container);
    host.document.body.append(this.node);
    this.root.addEventListener('click', event => this.onClick(event));
    this.root.addEventListener('keydown', event => this.onKey(event));
    this.root.addEventListener('dblclick', event => {
      if (event.target.closest('[data-entry],.reader-title,.content pre')) this.openContentEditor();
    });
    this.previewMessage = event => {
      const frame = this.$('.content iframe');
      if (this.alive && this.visible && !this.busy && this.$('.sheet-veil').hidden && event.origin === 'null' &&
        event.source === frame?.contentWindow && this.previewEditToken && event.data?.token === this.previewEditToken) {
        if (event.data.type === 'tavern-vault:edit-content') this.openContentEditor();
        if (event.data.type === 'tavern-vault:restore-reader' && this.$('.surface').classList.contains('expanded')) this.setExpanded(false);
      }
    };
    host.window.addEventListener('message', this.previewMessage);
    this.focusGuard = event => {
      if (!this.visible || !this.alive) return;
      const scope = this.focusScope();
      if (event.composedPath().includes(this.node) && scope.contains(this.root.activeElement)) return;
      const first = Array.from(scope.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]'))
        .find(element => element.getClientRects().length > 0);
      (first || scope).focus();
    };
    host.document.addEventListener('focusin', this.focusGuard, true);
    this.$('.search input').addEventListener('input', event => {
      this.query = event.target.value;
      this.renderList();
    });
    this.$('.page-select').addEventListener('change', event => {
      this.pageIndex = Number(event.target.value);
      this.readerKey = '';
      this.renderReader();
    });
    this.$('.body-input').addEventListener('input', () => {
      this.text('.editor-state', this.$('.body-input').value === this.contentBaseline ? '内容尚未修改。' : '草稿尚未保存，确认后才会更新本地文件。');
    });
    this.$('.title-input').addEventListener('input', () => { this.titleEdited = true; this.updateFilenamePreview(); });
    this.$('.category-select').addEventListener('change', () => this.updateFilenamePreview());
    this.$('.new-category-input').addEventListener('input', () => this.updateFilenamePreview());
    for (const selector of ['.include-tag-input', '.exclude-tags-input']) this.$(selector).addEventListener('input', () => this.updateSelection());
    this.$('.sheet').addEventListener('submit', event => { event.preventDefault(); this.submitForm(); });
    this.$('.number-sheet').addEventListener('submit', event => {
      event.preventDefault();
      if (this.busy) return;
      const id = Number(this.$('.floor-input').value);
      try {
        const draft = captureFloor(this.host, id);
        this.$('.number-veil').hidden = true;
        this.showForm('new', draft);
      } catch (error) { this.text('.floor-error', friendlyError(error)); this.$('.floor-error').hidden = false; }
    });
    this.render();
    this.$('.content').id = 'tv-content';
    this.root.querySelectorAll('[data-view]').forEach(button => {
      button.id = `tv-tab-${button.dataset.view}`;
      button.setAttribute('aria-controls', 'tv-content');
    });
  }

  $(selector) { return this.root.querySelector(selector); }
  text(selector, text) { this.$(selector).textContent = text; }
  get selected() { return this.storage.entries.find(entry => entry.id === this.selectedId); }
  get visible() { return !this.$('.veil').hidden; }

  notice(message, error = false) {
    this.text('.notice', message);
    this.$('.statusbar').classList.toggle('is-error', error);
  }

  async restore() {
    const epoch = this.connectionEpoch;
    try {
      const directory = await this.memory.get();
      if (!directory || !this.alive || epoch !== this.connectionEpoch) return;
      this.pendingDirectory = directory;
      if (await directory.queryPermission({ mode: 'readwrite' }) === 'granted') {
        await this.withBusy(async () => {
          await this.storage.attach(directory, false);
          this.pendingDirectory = null;
          this.notice('已从电脑文件夹读取收藏。');
        });
      } else this.notice('已记住收藏文件夹。点击“重新授权”即可继续读取。');
      this.render();
    } catch { this.notice('可以重新选择收藏文件夹；磁盘上的收藏不受影响。'); }
  }

  open(opener) {
    if (!this.visible) this.opener = opener || this.host.document.activeElement;
    this.$('.veil').hidden = false;
    this.$('.surface').focus();
    this.renderReader();
  }

  close() {
    if (this.busy) return;
    this.setExpanded(false, false);
    this.$('.veil').hidden = true;
    this.$('.sheet-veil').hidden = true;
    this.clearContentEditor();
    this.$('.number-veil').hidden = true;
    this.readerToken++;
    this.$('.content').replaceChildren();
    this.readerKey = '';
    this.opener?.focus?.();
  }

  async chooseDirectory(forcePicker = false) {
    if (this.busy) return;
    this.connectionEpoch++;
    const directory = this.pendingDirectory || this.storage.directory;
    let selection;
    try {
      // Invoke the permission prompt/picker directly in the original click task.
      if (!forcePicker && directory) {
        selection = directory.requestPermission({ mode: 'readwrite' }).then(state => {
          assert(state === 'granted', '文件夹授权未通过，收藏草稿仍保留。');
          return directory;
        });
      } else {
        assert(this.host.window.isSecureContext && typeof this.host.window.showDirectoryPicker === 'function',
          '当前环境不支持文件夹直读写。请用电脑 Chrome/Edge，并通过 localhost 或 HTTPS 打开酒馆。');
        selection = this.host.window.showDirectoryPicker({ id: 'tavern-vault', mode: 'readwrite' });
      }
    } catch (error) { this.showError(error); return; }
    await this.withBusy(async () => {
      const chosen = await selection;
      await this.storage.attach(chosen, true);
      this.pendingDirectory = null;
      this.$('.form-error').hidden = true;
      try { await this.memory.set(chosen); }
      catch { this.notice('文件夹已连接；浏览器未能记住入口，下次请重新选择同一文件夹。'); this.render(); return; }
      this.notice(`已连接“${chosen.name}”，收藏直接保存在这个电脑文件夹。`);
    });
  }

  showError(error) {
    const message = friendlyError(error);
    this.notice(message, true);
    if (!this.$('.sheet-veil').hidden) { this.text('.form-error', message); this.$('.form-error').hidden = false; }
    this.renderConnection();
  }

  async withBusy(action) {
    if (this.busy) return;
    this.busy = true;
    this.$('.surface').setAttribute('aria-busy', 'true');
    this.updateDisabled();
    try { await action(); }
    catch (error) { this.showError(error); }
    finally {
      this.busy = false;
      this.$('.surface').removeAttribute('aria-busy');
      if (this.alive) { this.updateDisabled(); this.render(); }
    }
  }

  updateDisabled() {
    this.root.querySelectorAll('button').forEach(button => { button.disabled = this.busy; });
    this.$('.body-input').disabled = this.busy || this.mode !== 'content';
    this.$('.submit-button').textContent = this.busy ? '正在处理…' : (this.mode === 'content' ? '确认保存到本地' : this.mode === 'category' ? '新建分类' : this.mode === 'edit' ? '保存整理' : '保存到文件夹');
  }

  async onClick(event) {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) {
      this.view = viewButton.dataset.view;
      this.readerKey = '';
      this.renderReader();
      return;
    }
    const item = event.target.closest('[data-entry]');
    if (item) {
      if (this.selectedId === item.dataset.entry && this.$('.surface').classList.contains('has-selection')) return;
      this.selectedId = item.dataset.entry;
      this.view = 'page';
      this.pageIndex = this.selected?.content.pages.length ? 0 : -1;
      this.$('.surface').classList.add('has-selection');
      // Keep list buttons mounted across the two clicks so native dblclick reaches the same target.
      this.root.querySelectorAll('[data-entry]').forEach(button => {
        const selected = button.dataset.entry === this.selectedId;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      this.renderReader();
      return;
    }
    const category = event.target.closest('[data-category]');
    if (category) { this.category = category.dataset.category; this.render(); return; }
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'open') { this.open(button); this.renderReader(); }
    if (action === 'close') this.close();
    if (action === 'connect') this.chooseDirectory(false);
    if (action === 'choose') this.chooseDirectory(true);
    if (action === 'refresh') {
      this.withBusy(async () => {
        await this.storage.load();
        this.readerKey = '';
        this.notice('已重新读取文件夹。');
      });
    }
    if (action === 'collect-number') {
      this.$('.number-veil').hidden = false;
      this.$('.floor-error').hidden = true;
      this.$('.floor-input').value = String(Math.max(0, this.host.lastMessageId()));
      this.$('.floor-input').focus();
    }
    if (action === 'cancel-number') { this.$('.number-veil').hidden = true; this.$('[data-action="collect-number"]').focus(); }
    if (action === 'cancel-form') this.hideForm();
    if (action === 'new-category') {
      if (!this.storage.connected) { this.notice('请先连接收藏文件夹，再新建分类。', true); return; }
      this.showForm('category');
    }
    if (action === 'toggle-category') {
      const area = this.$('.new-category-field');
      area.hidden = !area.hidden;
      this.$('.category-select').disabled = !area.hidden;
      if (!area.hidden) this.$('.new-category-input').focus();
      this.updateFilenamePreview();
    }
    if (action === 'delete' && this.selected) {
      const entry = this.selected;
      const options = { confirmed: true, expectedToken: editToken(entry), expectedLibraryId: this.storage.meta.libraryId };
      if (!this.host.window.confirm(`删除“${entry.title}”？\n确认后将删除这条收藏及对应本地文件，不保留旧版本。`)) return;
      this.withBusy(async () => {
        const result = await this.storage.delete(entry.id, options);
        this.selectedId = null; this.readerKey = ''; this.setExpanded(false, false);
        this.notice(result.cleanupPending ? '已移除收藏，本地文件尚未清理完；请点击“重试清理已删除文件”。' : '收藏及对应本地文件已删除。', result.cleanupPending);
      });
    }
    if (action === 'migrate') {
      const expectedLibraryId = this.storage.meta.libraryId;
      if (!this.host.window.confirm(`将 ${this.storage.legacyCount} 条旧收藏整理为 items/分类名/标题.txt？\n会保留原文、分类和简要来源，确认后清理原位置的 TXT、旧目录及 HTML 副本。页面改由 TXT 中的代码生成，单独显示副本不再保留。`)) return;
      this.withBusy(async () => {
        const result = await this.storage.migrate({ confirmed: true, expectedLibraryId }); this.readerKey = '';
        this.notice(`已按分类整理 ${result.converted} 条收藏。${result.cleanupPending ? '部分旧文件尚未清理，请打开对应记录重试清理。' : '旧位置已清理。'}`, Boolean(result.cleanupPending));
      });
    }
    if (action === 'retry-deletions') this.withBusy(async () => {
      const remaining = await this.storage.retryDeletions();
      this.notice(remaining ? '仍有文件无法清理，请检查文件夹权限或文件是否被外部修改后重试。' : '已删除收藏的本地文件已清理。', Boolean(remaining));
    });
    if (action === 'edit-content') this.openContentEditor();
    if (action === 'cleanup-content' && this.selected) this.withBusy(async () => {
      await this.storage.cleanupContent(this.selected.id);
      this.readerKey = '';
      this.notice('旧内容已清理完成，只保留当前内容。');
    });
    if (action === 'edit' && this.selected) this.showForm('edit', this.selected);
    if (action === 'reload-page') { this.readerKey = ''; this.renderReader(); }
    if (action === 'expand') this.setExpanded(true);
    if (action === 'restore-reader') this.setExpanded(false);
    if (action === 'back-list') {
      this.setExpanded(false, false);
      this.$('.surface').classList.remove('has-selection');
      this.$('.search input').focus();
    }
  }

  setExpanded(expanded, restoreFocus = true) {
    const active = Boolean(expanded && this.selected);
    this.$('.surface').classList.toggle('expanded', active);
    this.$('.restore-reader').hidden = !active;
    this.$('[data-action="expand"]').setAttribute('aria-expanded', String(active));
    if (restoreFocus && this.visible && this.selected) this.$(active ? '.restore-reader' : '[data-action="expand"]').focus();
  }

  onKey(event) {
    if (!this.visible) return;
    if (event.target.matches('[role="tab"]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const tabs = Array.from(this.root.querySelectorAll('[data-view]'));
      const index = tabs.indexOf(event.target);
      const target = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      this.view = target.dataset.view;
      this.readerKey = '';
      this.renderReader();
      target.focus();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (this.busy) return;
      if (!this.$('.sheet-veil').hidden) this.hideForm();
      else if (!this.$('.number-veil').hidden) this.$('.number-veil').hidden = true;
      else if (this.$('.surface').classList.contains('expanded')) this.setExpanded(false);
      else this.close();
    }
    if (event.key === 'Tab') {
      const scope = this.focusScope();
      const focusable = Array.from(scope.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),iframe,[tabindex="0"]')).filter(element => element.getClientRects().length > 0);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (this.root.activeElement === first || !scope.contains(this.root.activeElement))) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && (this.root.activeElement === last || !scope.contains(this.root.activeElement))) { event.preventDefault(); first?.focus(); }
    }
  }

  focusScope() {
    return !this.$('.sheet-veil').hidden ? this.$('.sheet') : !this.$('.number-veil').hidden ? this.$('.number-sheet') : this.$('.surface');
  }

  collect(messageId, opener) {
    if (this.busy) { this.notice('正在保存当前内容，请稍候。'); return; }
    this.open(opener);
    try { this.showForm('new', captureFloor(this.host, messageId)); }
    catch (error) { this.showError(error); }
  }

  openContentEditor() {
    if (this.busy || !this.visible || !this.selected || !this.$('.sheet-veil').hidden || !this.$('.number-veil').hidden) return;
    this.showForm('content', this.selected);
  }

  clearContentEditor() {
    this.$('.body-input').value = '';
    this.contentBaseline = '';
    this.originalEditText = '';
    this.expectedEditToken = null;
    this.editLibraryId = null;
    if (this.mode === 'content') this.draft = null;
  }

  showForm(mode, draft = null) {
    this.formOpener = this.root.activeElement;
    this.mode = mode;
    this.draft = draft;
    this.$('.sheet').classList.toggle('content-editor', mode === 'content');
    this.$('.editor-fields').hidden = mode !== 'content';
    this.$('.title-field').hidden = mode === 'content';
    this.$('.body-input').value = mode === 'content' ? draft.original : '';
    this.contentBaseline = this.$('.body-input').value;
    this.originalEditText = mode === 'content' ? draft.original : '';
    this.expectedEditToken = ['content', 'edit'].includes(mode) ? editToken(draft) : null;
    this.editLibraryId = ['content', 'edit'].includes(mode) ? this.storage.meta?.libraryId : null;
    this.text('.editor-state', '内容尚未修改。');
    this.titleEdited = false;
    this.filteredDraft = null;
    this.selectionError = null;
    this.$('.include-tag-input').value = '';
    this.$('.exclude-tags-input').value = '';
    this.$('.selection-fields').hidden = mode !== 'new';
    this.$('.sheet-veil').hidden = false;
    this.$('.form-error').hidden = true;
    this.$('.new-category-field').hidden = true;
    this.$('.new-category-input').value = '';
    this.$('.category-select').disabled = false;
    this.$('.category-fields').hidden = mode === 'category' || mode === 'content';
    this.$('.draft-source').hidden = mode === 'category';
    this.$('.draft-summary').hidden = mode === 'category';
    this.text('#tv-sheet-title', mode === 'category' ? '新建分类' : mode === 'content' ? '编辑收藏内容' : mode === 'edit' ? '整理收藏' : '收藏楼层');
    this.text('.sheet-intro', mode === 'category' ? '给喜欢的内容一个安放的位置。' : mode === 'content' ? '确认保存后，同步到原收藏文件夹。' : '内容与来源一同保存，原聊天保持不变。');
    this.text('.title-label', mode === 'category' ? '分类名称' : '收藏标题');
    const input = this.$('.title-input');
    input.maxLength = mode === 'category' ? 80 : 160;
    input.value = mode === 'new' ? draft.suggestedTitle : ['edit', 'content'].includes(mode) ? draft.title : '';
    this.updateFilenamePreview();
    if (draft) {
      this.text('.draft-source', sourceLabel(draft.source));
      this.text('.draft-summary', `${compactSource(draft.source).characterName} · ${(draft.original || '').length.toLocaleString()} 字符`);
    }
    if (mode === 'new') this.updateSelection();
    this.populateCategorySelect(['edit', 'content'].includes(mode) ? draft.categoryId : this.category);
    this.updateFilenamePreview();
    this.renderConnection();
    this.updateDisabled();
    if (mode === 'content') this.$('.body-input').focus();
    else { input.focus(); input.select(); }
  }

  populateCategorySelect(selected) {
    const select = this.$('.category-select');
    const previous = selected || select.value;
    select.replaceChildren();
    for (const category of this.storage.meta?.categories || [{ id: UNFILED, name: '未分类' }]) {
      const option = this.host.document.createElement('option');
      option.value = category.id;
      option.textContent = category.name;
      select.append(option);
    }
    select.value = this.storage.meta?.categories.some(category => category.id === previous) ? previous : UNFILED;
  }

  hideForm() {
    if (this.busy) return;
    this.$('.sheet-veil').hidden = true;
    this.clearContentEditor();
    this.formOpener?.focus?.();
  }

  updateSelection() {
    if (this.mode !== 'new') return;
    try {
      this.filteredDraft = selectDraft(this.draft, { includeTag: this.$('.include-tag-input').value, excludeTags: this.$('.exclude-tags-input').value });
      this.selectionError = null;
      const draft = this.filteredDraft;
      const rules = draft.source.selection;
      this.$('.selection-status').classList.remove('invalid');
      this.text('.selection-status', rules ? `将保存 ${draft.original.length.toLocaleString()} 字符 · 提取 ${rules.includedCount} 段 · 排除 ${rules.excludedCount} 段` : `未设置筛选，将保存整楼 ${draft.original.length.toLocaleString()} 字符。`);
      this.text('.selection-preview', draft.original);
      if (!this.titleEdited) this.$('.title-input').value = draft.suggestedTitle;
      this.$('.form-error').hidden = true;
    } catch (error) {
      this.filteredDraft = null;
      this.selectionError = error;
      this.$('.selection-status').classList.add('invalid');
      this.text('.selection-status', friendlyError(error));
      this.text('.selection-preview', '规则尚未匹配有效内容，当前不能保存。');
      if (!this.titleEdited) this.$('.title-input').value = '未命名收藏';
    }
    this.updateFilenamePreview();
  }

  updateFilenamePreview() {
    this.$('.file-hint').hidden = !['new', 'edit'].includes(this.mode);
    const title = this.$('.title-input').value.trim();
    const path = this.storage.previewPath(title, { entryId: this.mode === 'edit' ? this.draft.id : null,
      categoryId: this.$('.category-select').value,
      newCategory: this.$('.new-category-field').hidden ? '' : this.$('.new-category-input').value });
    this.text('.file-hint', `本地原文：items/${path}`);
  }

  async submitForm() {
    if (this.busy) return;
    if (this.mode === 'new') {
      this.updateSelection();
      if (this.selectionError) { this.showError(this.selectionError); return; }
    }
    const title = this.$('.title-input').value.trim();
    const options = { title, categoryId: this.$('.category-select').value,
      newCategory: this.$('.new-category-field').hidden ? '' : this.$('.new-category-input').value };
    if (!this.$('.new-category-field').hidden && !options.newCategory.trim()) {
      this.showError(new Error('请填写新分类名称，或再次点击“新建分类”选择已有分类。')); return;
    }
    await this.withBusy(async () => {
      assert(this.storage.connected, '请先选择收藏文件夹，草稿会保留在这个收藏栏中。');
      if (this.mode === 'category') {
        assert(title, '请填写分类名称。');
        this.category = await this.storage.addCategory(title);
        this.notice('分类已保存到文件夹。');
      } else if (this.mode === 'content') {
        const input = this.$('.body-input').value;
        // Textareas normalize CRLF on read. Preserve the exact file if the visible text was not edited.
        const original = input === this.contentBaseline ? this.originalEditText : input;
        const result = await this.storage.updateContent(this.draft.id, original, { expectedToken: this.expectedEditToken, expectedLibraryId: this.editLibraryId, confirmed: true });
        this.selectedId = result.entry.id;
        this.category = '*';
        this.view = 'page';
        this.pageIndex = result.entry.content.pages.length ? 0 : -1;
        this.notice(result.unchanged ? '内容没有变化，本地文件未改动。' : result.cleanupPending ? '新内容已保存，但旧文件尚未清理完；请在阅读区重试清理。' : '修改已确认保存到本地，旧内容已清理。', result.cleanupPending);
        this.clearContentEditor();
      } else if (this.mode === 'edit') {
        const result = await this.storage.edit(this.draft.id, { ...options,
          expectedToken: this.expectedEditToken, expectedLibraryId: this.editLibraryId });
        this.category = '*';
        this.notice(result.cleanup ? '整理已保存，但旧文件尚未清理完；请在阅读区重试清理。'
          : result.schemaVersion === 5 ? '整理已保存，分类文件夹和文件名已同步。' : '整理已保存。', Boolean(result.cleanup));
      } else {
        const result = await this.storage.save(this.filteredDraft, options);
        this.selectedId = result.entry.id;
        this.category = '*';
        this.view = 'page';
        this.pageIndex = result.entry.content.pages.length ? 0 : -1;
        this.$('.surface').classList.add('has-selection');
        this.notice(result.duplicate ? '这份内容已经收藏，为你打开已有记录。' : '已保存到电脑文件夹。');
      }
      this.query = '';
      this.$('.search input').value = '';
      this.readerKey = '';
      this.$('.sheet-veil').hidden = true;
      this.$('[data-action="collect-number"]').focus();
    });
  }

  renderConnection() {
    const directory = this.storage.directory || this.pendingDirectory;
    const connected = this.storage.connected;
    this.text('.folder-name', directory?.name || '还没有连接文件夹');
    this.text('.folder-status', connected ? '直接保存到此电脑文件夹。' : directory ? '重新授权后继续读取原有收藏。' : '收藏会保存在你选择的电脑文件夹里。');
    this.text('.connect', directory ? '重新授权' : '选择收藏文件夹');
    this.$('.change-folder').hidden = !directory;
    this.$('[data-action="migrate"]').hidden = !connected || !this.storage.legacyCount;
    this.$('[data-action="retry-deletions"]').hidden = !connected || !this.storage.pendingDeleteCount;
    this.$('.connection-dot').classList.toggle('connected', connected);
    this.text('.sheet-folder-name', connected ? `保存位置：${directory.name}` : '保存前，请先选择收藏文件夹。');
    this.$('.sheet-folder button').textContent = directory ? '重新授权' : '选择文件夹';
    this.$('.reader-empty .primary').hidden = connected;
    this.text('.issue-count', this.storage.issues.length ? `${this.storage.issues.length} 条损坏或未完成记录已略过` : '');
    this.$('.issue-count').title = this.storage.issues.map(item => `${item.id}: ${item.message}`).join('\n');
  }

  render() {
    this.renderConnection();
    this.text('.count', this.storage.entries.length);
    const nav = this.$('.categories');
    nav.replaceChildren();
    const categories = [{ id: '*', name: '全部收藏' }, ...(this.storage.meta?.categories || [{ id: UNFILED, name: '未分类' }])];
    if (!categories.some(category => category.id === this.category)) this.category = '*';
    for (const category of categories) {
      const button = this.host.document.createElement('button');
      button.type = 'button';
      button.dataset.category = category.id;
      button.className = this.category === category.id ? 'category active' : 'category';
      button.setAttribute('aria-pressed', String(this.category === category.id));
      const symbol = this.host.document.createElement('span');
      symbol.innerHTML = icon(category.id === '*' ? 'shelf' : 'folder');
      const name = this.host.document.createElement('span');
      name.className = 'category-name';
      name.textContent = category.name;
      const count = this.host.document.createElement('span');
      count.className = 'category-count';
      count.textContent = this.storage.entries.filter(entry => category.id === '*' || entry.categoryId === category.id).length;
      button.append(symbol, name, count);
      nav.append(button);
    }
    this.text('.filter-name', categories.find(category => category.id === this.category)?.name || '全部收藏');
    this.populateCategorySelect();
    this.renderList();
    this.updateDisabled();
  }

  renderList() {
    const query = normalized(this.query);
    const entries = this.storage.entries.filter(entry => (this.category === '*' || entry.categoryId === this.category) &&
      (!query || normalized([entry.title, entry.original, sourceLabel(entry.source), compactSource(entry.source).characterName].join('\n')).includes(query)));
    this.text('.result-count', `${entries.length} 条`);
    if (!entries.some(entry => entry.id === this.selectedId)) {
      this.selectedId = entries[0]?.id || null;
      this.pageIndex = this.selected?.content.pages.length ? 0 : -1;
      this.readerKey = '';
    }
    const list = this.$('.items');
    const scrollTop = list.scrollTop;
    list.replaceChildren();
    if (!entries.length) {
      const empty = this.host.document.createElement('div');
      empty.className = 'list-empty';
      const title = this.host.document.createElement('h3');
      title.textContent = query ? '没有找到匹配内容' : this.storage.connected ? '这里还没有收藏' : '等一段值得留下的对话';
      const text = this.host.document.createElement('p');
      text.textContent = query ? '换个关键词试试。' : this.storage.connected ? '点击楼层旁的“收藏”，或上方的“收藏楼层”。' : '先选择收藏文件夹，也可以连接已有收藏库。';
      empty.append(title, text);
      list.append(empty);
    }
    for (const entry of entries) {
      const row = this.host.document.createElement('div');
      row.setAttribute('role', 'listitem');
      const button = this.host.document.createElement('button');
      button.type = 'button';
      button.dataset.entry = entry.id;
      button.className = entry.id === this.selectedId ? 'item selected' : 'item';
      button.setAttribute('aria-pressed', String(entry.id === this.selectedId));
      const title = this.host.document.createElement('h3'); title.textContent = entry.title;
      const source = this.host.document.createElement('p'); source.className = 'item-source'; source.textContent = sourceLabel(entry.source);
      const excerpt = this.host.document.createElement('p'); excerpt.className = 'excerpt';
      const plainText = entry.original.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>|<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
        .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      excerpt.textContent = plainText && normalized(plainText) !== normalized(entry.title) ? plainText.slice(0, 100) : entry.content.pages.length ? `已保存 ${entry.content.pages.length} 个 HTML 页面，可在阅读区打开。` : plainText;
      const footer = this.host.document.createElement('div'); footer.className = 'item-footer';
      const type = this.host.document.createElement('span'); type.className = entry.content.pages.length ? 'type-tag html-tag' : 'type-tag';
      type.textContent = entry.content.pages.length ? 'HTML 页面' : '文字';
      const date = this.host.document.createElement('time'); date.dateTime = entry.savedAt;
      date.textContent = new Date(entry.savedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
      footer.append(type, date); button.append(title, source, excerpt, footer); row.append(button); list.append(row);
    }
    list.scrollTop = scrollTop;
    this.renderReader();
  }

  async renderReader() {
    if (!this.alive) return;
    const entry = this.selected;
    this.$('.reader-empty').hidden = Boolean(entry);
    this.$('.reader-filled').hidden = !entry;
    if (!entry) { this.setExpanded(false, false); this.readerToken++; this.$('.content').replaceChildren(); this.readerKey = ''; return; }
    this.$('.cleanup-note').hidden = !entry.cleanup;
    const key = `${entry.id}:${entry.updatedAt}:${entry.content.storageId || ''}:${this.view}:${this.pageIndex}`;
    if (key === this.readerKey) return;
    this.readerKey = key;
    const token = ++this.readerToken;
    this.previewEditToken = null;
    this.text('.reader-title', entry.title);
    this.text('.reader-category', this.storage.meta?.categories.find(category => category.id === entry.categoryId)?.name || '分类已缺失');
    const source = compactSource(entry.source);
    this.text('.reader-origin', `${source.chatId || '未取得聊天标识'} · ${source.characterName} · 楼层 #${source.messageId} · ${new Date(entry.savedAt).toLocaleString('zh-CN', { hour12: false })}`);
    this.root.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.view === this.view)));
    this.$('.page-tools').hidden = this.view !== 'page';
    this.$('[data-action="reload-page"]').hidden = this.view !== 'page';
    const content = this.$('.content');
    content.setAttribute('aria-labelledby', `tv-tab-${this.view}`);
    content.className = `content ${this.view}-view`;
    content.replaceChildren();
    this.$('.page-notes').hidden = true;
    if (this.view === 'original') {
      const pre = this.host.document.createElement('pre'); pre.textContent = entry.original; content.append(pre); return;
    }
    const select = this.$('.page-select'); select.replaceChildren();
    entry.content.pages.forEach((page, index) => {
      const option = this.host.document.createElement('option'); option.value = String(index); option.textContent = page.label; select.append(option);
    });
    const snapshot = this.host.document.createElement('option'); snapshot.value = '-1'; snapshot.textContent = entry.schemaVersion >= 4 ? '文字预览' : '楼层显示快照'; select.append(snapshot);
    if (!entry.content.pages[this.pageIndex]) this.pageIndex = -1;
    select.value = String(this.pageIndex);
    const loading = this.host.document.createElement('p'); loading.className = 'loading'; loading.textContent = '正在读取页面…'; content.append(loading);
    try {
      const html = await this.storage.readPage(entry, this.pageIndex);
      if (!this.alive || token !== this.readerToken || !this.visible) return;
      const frame = this.host.document.createElement('iframe');
      frame.title = `${entry.title} — ${this.pageIndex === -1 ? '显示快照' : entry.content.pages[this.pageIndex].label}`;
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      this.previewEditToken = this.host.window.crypto.randomUUID();
      frame.srcdoc = preparePreview(html, entry.source.origin || '', this.host.document, { token: this.previewEditToken, targetOrigin: this.host.window.location.origin });
      content.replaceChildren(frame);
      const notes = entry.content.warnings || [];
      if (notes.length) { this.text('.page-notes', notes.join(' ')); this.$('.page-notes').hidden = false; }
    } catch (error) {
      if (token !== this.readerToken) return;
      content.replaceChildren();
      const message = this.host.document.createElement('p'); message.className = 'read-error';
      message.textContent = `${friendlyError(error)} 原文仍可切换查看。`;
      content.append(message);
    }
  }

  destroy() {
    this.alive = false;
    this.readerToken++;
    this.host.document.removeEventListener('focusin', this.focusGuard, true);
    this.host.window.removeEventListener('message', this.previewMessage);
    this.clearContentEditor();
    this.node.remove();
  }
}
