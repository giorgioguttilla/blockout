import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { SETTINGS_FILE } from '$lib/model/settingsDoc';
import { PROJECT_FILE, ProjectStore } from '$lib/store/core';
import type { VFS } from '$lib/store/vfs';

export { PROJECT_FILE };
const CONFIG_DIR = path.join(os.homedir(), '.blockout');
const RECENT_FILE = path.join(CONFIG_DIR, 'recent.json');

type Listener = (ev: { kind: 'level' | 'project' | 'levels'; id?: string }) => void;

function hash(c: string | Uint8Array) {
  return crypto.createHash('sha1').update(c).digest('hex');
}

/** Node file system rooted at an absolute folder; remembers what it wrote so the watcher can skip it. */
class NodeVFS implements VFS {
  constructor(public readonly label: string, private written: Map<string, string>) {}
  private abs(p: string) {
    const a = path.resolve(this.label, p);
    if (a !== this.label && !a.startsWith(this.label + path.sep)) throw new Error('Path outside the project');
    return a;
  }
  async read(p: string) {
    try {
      return await fsp.readFile(this.abs(p), 'utf8');
    } catch {
      return null;
    }
  }
  async write(p: string, data: string | Uint8Array) {
    const a = this.abs(p);
    await fsp.mkdir(path.dirname(a), { recursive: true });
    this.written.set(a, hash(data));
    await fsp.writeFile(a, data);
  }
  async exists(p: string) {
    return fs.existsSync(this.abs(p));
  }
  async list(dir: string) {
    try {
      return (await fsp.readdir(this.abs(dir), { withFileTypes: true })).map((d) => ({ name: d.name, dir: d.isDirectory() }));
    } catch {
      return [];
    }
  }
  async mtime(p: string) {
    try {
      return (await fsp.stat(this.abs(p))).mtimeMs;
    } catch {
      return null;
    }
  }
  async move(from: string, to: string) {
    await fsp.mkdir(path.dirname(this.abs(to)), { recursive: true });
    await fsp.rename(this.abs(from), this.abs(to));
  }
}

class Store {
  root: string | null = process.env.BLOCKOUT_ROOT ? path.resolve(process.env.BLOCKOUT_ROOT) : null;
  listeners = new Set<Listener>();
  watcher: fs.FSWatcher | null = null;
  private written = new Map<string, string>();
  private debounce = new Map<string, NodeJS.Timeout>();

  constructor(prev?: Store) {
    // dev hot-reload: carry over the open folder and live connections, but use the fresh code
    if (prev) {
      this.root = prev.root;
      this.listeners = prev.listeners;
      prev.watcher?.close();
    }
    if (this.root) this.core.ensureProject().then(() => this.startWatch()).catch(() => {});
  }

  /** project logic for the open folder */
  get core() {
    if (!this.root) throw new Error('No project folder open');
    return new ProjectStore(new NodeVFS(this.root, this.written));
  }

  async recent(): Promise<string[]> {
    try {
      const list = JSON.parse(await fsp.readFile(RECENT_FILE, 'utf8'));
      return (list as string[]).filter((p) => fs.existsSync(path.join(p, PROJECT_FILE))).slice(0, 8);
    } catch {
      return [];
    }
  }
  private async pushRecent(p: string) {
    const list = [p, ...(await this.recent()).filter((x) => x !== p)].slice(0, 8);
    await fsp.mkdir(CONFIG_DIR, { recursive: true });
    await fsp.writeFile(RECENT_FILE, JSON.stringify(list, null, 2));
  }

  async open(dir: string, opts: { create?: boolean; demo?: boolean } = {}) {
    const abs = path.resolve(dir.replace(/^~(?=$|\/)/, os.homedir()));
    if (!fs.existsSync(abs)) {
      if (!opts.create) throw new Error(`Folder does not exist: ${abs}`);
      await fsp.mkdir(abs, { recursive: true });
    }
    if (!fs.statSync(abs).isDirectory()) throw new Error(`Not a folder: ${abs}`);
    this.root = abs;
    await this.core.ensureProject(opts.demo);
    await this.pushRecent(abs);
    this.startWatch();
    return abs;
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit(ev: Parameters<Listener>[0]) {
    for (const l of this.listeners) l(ev);
  }
  private startWatch() {
    this.watcher?.close();
    const root = this.root;
    if (!root) return;
    try {
      this.watcher = fs.watch(root, { recursive: true }, (_t, file) => {
        if (!file) return;
        const rel = file.toString();
        const abs = path.join(root, rel);
        clearTimeout(this.debounce.get(abs));
        this.debounce.set(
          abs,
          setTimeout(async () => {
            this.debounce.delete(abs);
            let content: Buffer;
            try {
              content = await fsp.readFile(abs);
            } catch {
              if (/^levels[\/\\][^\/\\]+$/.test(rel)) this.emit({ kind: 'levels' });
              return;
            }
            if (this.written.get(abs) === hash(content)) return; // our own write
            this.written.set(abs, hash(content));
            const m = /^levels[\/\\]([^\/\\]+)[\/\\]level\.json$/.exec(rel);
            if (m) this.emit({ kind: 'level', id: m[1] });
            else if (rel === PROJECT_FILE || rel === SETTINGS_FILE) this.emit({ kind: 'project' });
          }, 150)
        );
      });
    } catch (e) {
      console.warn('[blockout] file watching unavailable', e);
    }
  }
}

const g = globalThis as any;
export const store: Store = (g.__blockoutStore = new Store(g.__blockoutStore));
