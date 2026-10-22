export function fsError(name, message = name) { return new DOMException(message, name); }

export class MemoryDirectory {
  constructor(name = '界面演示收藏夹', root = null, path = '') {
    this.kind = 'directory'; this.name = name; this.children = new Map();
    this.root = root || this; this.path = path;
    if (!root) this.state = { permission: 'granted', fail: '', writes: 0 };
  }
  async queryPermission() { return this.root.state.permission; }
  async requestPermission() { return this.root.state.permission; }
  async getDirectoryHandle(name, { create = false } = {}) {
    this.checkName(name);
    const current = this.children.get(name);
    if (current?.kind === 'file') throw fsError('TypeMismatchError');
    if (current) return current;
    if (!create) throw fsError('NotFoundError');
    this.checkWrite();
    const child = new MemoryDirectory(name, this.root, `${this.path}/${name}`);
    this.children.set(name, child);
    return child;
  }
  async getFileHandle(name, { create = false } = {}) {
    this.checkName(name);
    const current = this.children.get(name);
    if (current?.kind === 'directory') throw fsError('TypeMismatchError');
    if (current) return current;
    if (!create) throw fsError('NotFoundError');
    this.checkWrite();
    const child = new MemoryFile(name, this.root, `${this.path}/${name}`);
    this.children.set(name, child);
    return child;
  }
  async removeEntry(name, { recursive = false } = {}) {
    this.checkName(name); this.checkWrite();
    const child = this.children.get(name);
    if (!child) throw fsError('NotFoundError');
    if (this.root.state.failRemove && child.path.endsWith(this.root.state.failRemove)) throw fsError('NotAllowedError');
    if (child.kind === 'directory' && child.children.size && !recursive) throw fsError('InvalidModificationError');
    this.children.delete(name); this.root.state.writes++;
  }
  checkName(name) { if (!name || /[\\/]/.test(name) || name === '.' || name === '..') throw new TypeError('Invalid path'); }
  checkWrite() { if (this.root.state.permission !== 'granted') throw fsError('NotAllowedError'); }
  async *values() { for (const value of this.children.values()) yield value; }
}

class MemoryFile {
  constructor(name, root, path) { this.kind = 'file'; this.name = name; this.root = root; this.path = path; this.value = ''; }
  async getFile() {
    if (this.root.state.permission !== 'granted') throw fsError('NotAllowedError');
    return { text: async () => this.value };
  }
  async createWritable() {
    if (this.root.state.permission !== 'granted') throw fsError('NotAllowedError');
    let draft = this.value;
    return { write: async value => { draft = String(value); }, abort: async () => {}, close: async () => {
      if (this.root.state.fail && this.path.endsWith(this.root.state.fail)) throw fsError('QuotaExceededError');
      this.value = draft; this.root.state.writes++;
    } };
  }
}
