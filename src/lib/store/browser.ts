import { SETTINGS_FILE } from '$lib/model/settingsDoc';
import { PROJECT_FILE, ProjectStore } from './core';
import { join, type VFS } from './vfs';
import { zip } from './zip';

// ------------------------------------------------------------------ IndexedDB helpers
const DB = 'blockout';
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('files');
      r.result.createObjectStore('handles');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req ? (req as IDBRequest<T>).result : (undefined as T));
    t.onerror = () => rej(t.error);
  });
}

/** Projects stored inside the browser (any browser). */
class IdbVFS implements VFS {
  constructor(public readonly label: string) {}
  private k(p: string) {
    return `${this.label}\u0000${p}`;
  }
  async read(p: string) {
    const v = await tx<{ data: string | Uint8Array } | undefined>('files', 'readonly', (s) => s.get(this.k(p)));
    if (!v) return null;
    return typeof v.data === 'string' ? v.data : new TextDecoder().decode(v.data);
  }
  async readBytes(p: string) {
    const v = await tx<{ data: string | Uint8Array } | undefined>('files', 'readonly', (s) => s.get(this.k(p)));
    return v?.data ?? null;
  }
  async write(p: string, data: string | Uint8Array) {
    await tx('files', 'readwrite', (s) => s.put({ data, mtime: Date.now() }, this.k(p)));
  }
  async exists(p: string) {
    if ((await this.read(p)) != null) return true;
    return (await this.keys(p + '/')).length > 0;
  }
  private async keys(prefix: string) {
    const lo = this.k(prefix);
    const all = await tx<IDBValidKey[]>('files', 'readonly', (s) => s.getAllKeys(IDBKeyRange.bound(lo, lo + '￿')));
    return (all as string[]).map((k) => k.slice(this.label.length + 1));
  }
  async list(dir: string) {
    const prefix = dir ? dir.replace(/\/$/, '') + '/' : '';
    const seen = new Map<string, boolean>();
    for (const k of await this.keys(prefix)) {
      const rest = k.slice(prefix.length);
      const [head, ...tail] = rest.split('/');
      if (head) seen.set(head, seen.get(head) || tail.length > 0);
    }
    return [...seen].map(([name, dir]) => ({ name, dir }));
  }
  async mtime(p: string) {
    const v = await tx<{ mtime: number } | undefined>('files', 'readonly', (s) => s.get(this.k(p)));
    return v?.mtime ?? null;
  }
  async move(from: string, to: string) {
    for (const k of await this.keys(from + '/')) {
      const v = await tx<any>('files', 'readonly', (s) => s.get(this.k(k)));
      await tx('files', 'readwrite', (s) => s.put(v, this.k(to + k.slice(from.length))));
      await tx('files', 'readwrite', (s) => s.delete(this.k(k)));
    }
  }
  async allFiles(prefix = '') {
    return this.keys(prefix);
  }
}

/** A real folder on disk, via the File System Access API (Chrome / Edge). */
class FsaVFS implements VFS {
  /** mtimes of files we wrote, so polling can tell agent edits from our own */
  ours = new Map<string, number>();
  constructor(public readonly label: string, private root: FileSystemDirectoryHandle) {}
  private async dir(parts: string[], create: boolean) {
    let d = this.root;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return d;
  }
  private async file(p: string, create = false) {
    const parts = p.split('/').filter(Boolean);
    const name = parts.pop()!;
    return (await this.dir(parts, create)).getFileHandle(name, { create });
  }
  async read(p: string) {
    try {
      return await (await (await this.file(p)).getFile()).text();
    } catch {
      return null;
    }
  }
  async readBytes(p: string) {
    try {
      return new Uint8Array(await (await (await this.file(p)).getFile()).arrayBuffer());
    } catch {
      return null;
    }
  }
  async write(p: string, data: string | Uint8Array) {
    const h = await this.file(p, true);
    const w = await (h as any).createWritable();
    await w.write(data);
    await w.close();
    this.ours.set(p, (await h.getFile()).lastModified);
  }
  async exists(p: string) {
    try {
      await this.file(p);
      return true;
    } catch {
      try {
        await this.dir(p.split('/').filter(Boolean), false);
        return true;
      } catch {
        return false;
      }
    }
  }
  async list(dirPath: string) {
    try {
      const d = await this.dir(dirPath.split('/').filter(Boolean), false);
      const out: { name: string; dir: boolean }[] = [];
      for await (const [name, h] of (d as any).entries()) out.push({ name, dir: h.kind === 'directory' });
      return out;
    } catch {
      return [];
    }
  }
  async mtime(p: string) {
    try {
      return (await (await this.file(p)).getFile()).lastModified;
    } catch {
      return null;
    }
  }
  async move(from: string, to: string) {
    const copy = async (src: string, dst: string) => {
      for (const e of await this.list(src)) {
        if (e.dir) await copy(join(src, e.name), join(dst, e.name));
        else {
          const b = await this.readBytes(join(src, e.name));
          if (b) await this.write(join(dst, e.name), b);
        }
      }
    };
    await copy(from, to);
    const parts = from.split('/').filter(Boolean);
    const name = parts.pop()!;
    await (await this.dir(parts, false)).removeEntry(name, { recursive: true });
  }
}

// ------------------------------------------------------------------ recents & handles
export interface WebRecent {
  id: string; // 'idb:<name>' or 'fsa:<uuid>'
  name: string;
  kind: 'idb' | 'fsa';
  time: number;
}
const RECENT = 'blockout:web-recent';
export function webRecents(): WebRecent[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT) ?? '[]');
  } catch {
    return [];
  }
}
function pushRecent(r: WebRecent) {
  localStorage.setItem(RECENT, JSON.stringify([r, ...webRecents().filter((x) => x.id !== r.id)].slice(0, 10)));
}
export function forgetRecent(id: string) {
  localStorage.setItem(RECENT, JSON.stringify(webRecents().filter((x) => x.id !== id)));
}
export const canOpenFolders = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

type Listener = (ev: { kind: string; id?: string }) => void;

/** The web build's stand-in for the local server. */
export class BrowserBackend {
  current: { id: string; vfs: IdbVFS | FsaVFS; store: ProjectStore } | null = null;
  private listeners = new Set<Listener>();
  private poll: ReturnType<typeof setInterval> | null = null;
  private seen = new Map<string, number>();
  watchLevel: string | null = null;

  get core() {
    if (!this.current) throw new Error('No project open');
    return this.current.store;
  }

  /** ask for a folder (must run inside a click) */
  async pickFolder(): Promise<string> {
    const h: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite', id: 'blockout' });
    const id = 'fsa:' + crypto.randomUUID();
    await tx('handles', 'readwrite', (s) => s.put(h, id));
    pushRecent({ id, name: h.name, kind: 'fsa', time: Date.now() });
    return id;
  }

  async open(id: string, opts: { demo?: boolean; name?: string } = {}) {
    let vfs: IdbVFS | FsaVFS;
    let name: string;
    if (id.startsWith('fsa:')) {
      const h = await tx<FileSystemDirectoryHandle | undefined>('handles', 'readonly', (s) => s.get(id));
      if (!h) throw new Error('That folder is no longer available — open it again');
      const perm = await (h as any).queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted' && (await (h as any).requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Permission to edit the folder was not granted');
      vfs = new FsaVFS(h.name, h);
      name = h.name;
    } else {
      name = id.replace(/^idb:/, '') || 'My Game';
      vfs = new IdbVFS(name);
      id = 'idb:' + name;
    }
    const store = new ProjectStore(vfs);
    await store.ensureProject(!!opts.demo, opts.name ?? (name === 'design' ? undefined : name));
    this.current = { id, vfs, store };
    pushRecent({ id, name, kind: vfs instanceof FsaVFS ? 'fsa' : 'idb', time: Date.now() });
    localStorage.setItem('blockout:web-last', id);
    this.startPolling();
    return { root: id, label: vfs instanceof FsaVFS ? `${name} (folder on this computer)` : `${name} (stored in this browser)` };
  }

  close() {
    this.current = null;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }

  // agent edits show up by polling (browsers can't watch files)
  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private startPolling() {
    if (this.poll) clearInterval(this.poll);
    this.seen.clear();
    const cur = this.current;
    if (!cur || !(cur.vfs instanceof FsaVFS)) return;
    const vfs = cur.vfs;
    const check = async () => {
      if (this.current !== cur) return;
      const files = [PROJECT_FILE, SETTINGS_FILE];
      if (this.watchLevel) files.push(join('levels', this.watchLevel, 'level.json'));
      for (const f of files) {
        const t = await vfs.mtime(f);
        if (t == null) continue;
        const prev = this.seen.get(f);
        this.seen.set(f, t);
        if (prev == null || t === prev || vfs.ours.get(f) === t) continue;
        const m = /^levels\/([^/]+)\/level\.json$/.exec(f);
        for (const l of this.listeners) l(m ? { kind: 'level', id: m[1] } : { kind: 'project' });
      }
    };
    check();
    this.poll = setInterval(check, 2000);
  }

  /** everything an agent needs from one level, as a zip */
  async handoffZip(levelId: string): Promise<Blob> {
    const v = this.current!.vfs;
    const files: { name: string; data: string | Uint8Array }[] = [];
    const add = async (p: string) => {
      const b = await (v as any).readBytes?.(p);
      if (b != null) files.push({ name: p, data: b });
    };
    for (const p of [PROJECT_FILE, SETTINGS_FILE, 'AGENTS-blockout.md', join('levels', levelId, 'level.json')]) await add(p);
    for (const e of await v.list(join('levels', levelId, 'handoff'))) if (!e.dir) await add(join('levels', levelId, 'handoff', e.name));
    for (const e of await v.list(join('levels', levelId, 'versions'))) if (!e.dir) await add(join('levels', levelId, 'versions', e.name));
    return zip(files);
  }
}

export const browserBackend = new BrowserBackend();
