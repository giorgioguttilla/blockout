import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { defaultProject, demoLevel, emptyLevel } from '$lib/model/defaults';
import { normalizeLevel, normalizeProject, stringifyJSON, stringifyLevel } from '$lib/model/serialize';
import { slug } from '$lib/model/ids';
import type { Level, LevelSummary, Project, VersionInfo } from '$lib/model/types';
import { AGENTS_DOC } from './agents-doc';
import { SETTINGS_FILE, applySettingsDoc, updateSettingsDoc } from '$lib/model/settingsDoc';

export const PROJECT_FILE = 'blockout.project.json';
const CONFIG_DIR = path.join(os.homedir(), '.blockout');
const RECENT_FILE = path.join(CONFIG_DIR, 'recent.json');

type Listener = (ev: { kind: 'level' | 'project' | 'levels'; id?: string }) => void;

class Store {
  root: string | null = process.env.BLOCKOUT_ROOT ? path.resolve(process.env.BLOCKOUT_ROOT) : null;
  listeners = new Set<Listener>();
  watcher: fs.FSWatcher | null = null;
  private written = new Map<string, string>(); // abs path -> content hash we wrote
  private debounce = new Map<string, NodeJS.Timeout>();

  constructor(prev?: Store) {
    // dev hot-reload: carry over the open folder and live connections, but use the fresh code
    if (prev) {
      this.root = prev.root;
      this.listeners = prev.listeners;
      prev.watcher?.close();
    }
    if (this.root) {
      this.ensureProject(this.root).then(() => this.startWatch()).catch(() => {});
    }
  }

  // ------------------------------------------------------------ recent
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

  // ------------------------------------------------------------ open
  async open(dir: string, opts: { create?: boolean; demo?: boolean } = {}) {
    const abs = path.resolve(dir.replace(/^~(?=$|\/)/, os.homedir()));
    if (!fs.existsSync(abs)) {
      if (!opts.create) throw new Error(`Folder does not exist: ${abs}`);
      await fsp.mkdir(abs, { recursive: true });
    }
    if (!fs.statSync(abs).isDirectory()) throw new Error(`Not a folder: ${abs}`);
    this.root = abs;
    await this.ensureProject(abs, opts.demo);
    await this.pushRecent(abs);
    this.startWatch();
    return abs;
  }

  private async ensureProject(abs: string, demo = false) {
    const pf = path.join(abs, PROJECT_FILE);
    if (!fs.existsSync(pf)) {
      const name = path.basename(abs.endsWith('design') ? path.dirname(abs) : abs);
      const dp = defaultProject(prettyName(name));
      await this.writeFile(path.join(abs, SETTINGS_FILE), updateSettingsDoc(null, dp));
      const { character, engine, grid, defaults, traversal, ...rest } = dp;
      void character; void engine; void grid; void defaults; void traversal;
      await this.writeFile(pf, stringifyJSON({ ...rest, settings: SETTINGS_FILE }));
    }
    const sf = path.join(abs, SETTINGS_FILE);
    if (!fs.existsSync(sf)) {
      const p = normalizeProject(JSON.parse(await fsp.readFile(pf, 'utf8')));
      await this.writeFile(sf, updateSettingsDoc(null, p));
    }
    const agents = path.join(abs, 'AGENTS-blockout.md');
    if (!fs.existsSync(agents)) await this.writeFile(agents, AGENTS_DOC);
    const levels = await this.listLevelsIn(abs);
    if (demo && !levels.some((l) => l.id === 'demo')) {
      await this.writeLevelIn(abs, 'demo', demoLevel());
    } else if (!levels.length) {
      await this.writeLevelIn(abs, 'level-01', emptyLevel('level-01', 'Level 01'));
    }
  }

  private need(): string {
    if (!this.root) throw new Error('No project folder open');
    return this.root;
  }

  // ------------------------------------------------------------ files
  private async writeFile(abs: string, content: string | Buffer) {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    this.written.set(abs, hash(content));
    await fsp.writeFile(abs, content);
  }

  async readProject(): Promise<Project> {
    const raw = JSON.parse(await fsp.readFile(path.join(this.need(), PROJECT_FILE), 'utf8'));
    const p = normalizeProject(raw);
    const sf = path.join(this.need(), SETTINGS_FILE);
    if (fs.existsSync(sf)) {
      const w = applySettingsDoc(p, await fsp.readFile(sf, 'utf8'));
      if (w.length) p.settingsWarnings = w;
    }
    return p;
  }
  async writeProject(p: Project) {
    p = normalizeProject(p);
    const sf = path.join(this.need(), SETTINGS_FILE);
    const prev = fs.existsSync(sf) ? await fsp.readFile(sf, 'utf8') : null;
    const next = updateSettingsDoc(prev, p);
    if (next !== prev) await this.writeFile(sf, next);
    // gameplay numbers live in the settings doc only — keep the JSON to vocabulary, stamps, pens
    const { character, engine, grid, defaults, traversal, ...rest } = p as Project & { targetEngine?: unknown };
    void character; void engine; void grid; void defaults; void traversal;
    delete (rest as any).targetEngine;
    delete (rest as any).settingsWarnings;
    await this.writeFile(path.join(this.need(), PROJECT_FILE), stringifyJSON({ ...rest, settings: SETTINGS_FILE }));
  }

  levelDir(id: string, root = this.need()) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new Error('Bad level id');
    return path.join(root, 'levels', id);
  }

  private async listLevelsIn(root: string): Promise<LevelSummary[]> {
    const dir = path.join(root, 'levels');
    if (!fs.existsSync(dir)) return [];
    const out: LevelSummary[] = [];
    for (const name of await fsp.readdir(dir)) {
      const f = path.join(dir, name, 'level.json');
      if (!fs.existsSync(f)) continue;
      try {
        const raw = JSON.parse(await fsp.readFile(f, 'utf8'));
        const st = await fsp.stat(f);
        const versions = await this.readIndexIn(root, name).catch(() => []);
        out.push({ id: name, name: raw.name ?? name, modified: st.mtime.toISOString(), versions: versions.length });
      } catch {
        out.push({ id: name, name: name + ' (unreadable)', modified: '', versions: 0 });
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }
  listLevels() {
    return this.listLevelsIn(this.need());
  }

  async readLevel(id: string): Promise<Level> {
    const raw = JSON.parse(await fsp.readFile(path.join(this.levelDir(id), 'level.json'), 'utf8'));
    const l = normalizeLevel(raw, id);
    l.id = id;
    return l;
  }
  private async writeLevelIn(root: string, id: string, level: Level) {
    level = { ...level, id };
    // keep the previous working copy as a safety net
    const cur = path.join(this.levelDir(id, root), 'level.json');
    if (fs.existsSync(cur)) await fsp.copyFile(cur, path.join(this.levelDir(id, root), '.previous.json')).catch(() => {});
    await this.writeFile(path.join(this.levelDir(id, root), 'level.json'), stringifyLevel(level));
  }
  writeLevel(id: string, level: Level) {
    return this.writeLevelIn(this.need(), id, normalizeLevel(level, id));
  }
  async createLevel(name: string, from?: Level) {
    const existing = new Set((await this.listLevels()).map((l) => l.id));
    let id = slug(name);
    let n = 2;
    while (existing.has(id)) id = `${slug(name)}-${n++}`;
    const level = from ? { ...structuredClone(from), id, name } : emptyLevel(id, name);
    await this.writeLevel(id, level);
    return id;
  }
  async deleteLevel(id: string) {
    const dir = this.levelDir(id);
    const trash = path.join(this.need(), '.trash', `${id}-${Date.now()}`);
    await fsp.mkdir(path.dirname(trash), { recursive: true });
    await fsp.rename(dir, trash);
  }

  // ------------------------------------------------------------ versions
  private async readIndexIn(root: string, id: string): Promise<VersionInfo[]> {
    const f = path.join(this.levelDir(id, root), 'versions', 'index.json');
    if (!fs.existsSync(f)) return [];
    return JSON.parse(await fsp.readFile(f, 'utf8'));
  }
  listVersions(id: string) {
    return this.readIndexIn(this.need(), id);
  }
  private async writeIndex(id: string, idx: VersionInfo[]) {
    await this.writeFile(path.join(this.levelDir(id), 'versions', 'index.json'), JSON.stringify(idx, null, 2) + '\n');
  }
  async saveVersion(id: string, level: Level, message: string, handoff = false) {
    const idx = await this.listVersions(id);
    const n = (idx.at(-1)?.n ?? 0) + 1;
    await this.writeFile(path.join(this.levelDir(id), 'versions', String(n).padStart(4, '0') + '.json'), stringifyLevel({ ...level, id }));
    const info: VersionInfo = { n, message: message || `Version ${n}`, time: new Date().toISOString() };
    if (handoff) {
      info.handoff = true;
      info.baseline = true;
      idx.forEach((v) => delete v.baseline);
    }
    idx.push(info);
    await this.writeIndex(id, idx);
    return info;
  }
  async readVersion(id: string, n: number): Promise<Level> {
    const f = path.join(this.levelDir(id), 'versions', String(n).padStart(4, '0') + '.json');
    return normalizeLevel(JSON.parse(await fsp.readFile(f, 'utf8')), id);
  }
  async setBaseline(id: string, n: number) {
    const idx = await this.listVersions(id);
    idx.forEach((v) => {
      delete v.baseline;
      if (v.n === n) v.baseline = true;
    });
    await this.writeIndex(id, idx);
  }

  // ------------------------------------------------------------ handoff
  async writeHandoff(id: string, files: { name: string; text?: string; base64?: string }[]) {
    const dir = path.join(this.levelDir(id), 'handoff');
    await fsp.mkdir(dir, { recursive: true });
    for (const f of files) {
      const name = path.basename(f.name);
      const content = f.base64 != null ? Buffer.from(f.base64, 'base64') : f.text ?? '';
      await this.writeFile(path.join(dir, name), content);
    }
    return dir;
  }

  // ------------------------------------------------------------ watch
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
        const key = abs;
        clearTimeout(this.debounce.get(key));
        this.debounce.set(
          key,
          setTimeout(async () => {
            this.debounce.delete(key);
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

function hash(c: string | Buffer) {
  return crypto.createHash('sha1').update(c).digest('hex');
}
function prettyName(s: string) {
  return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const g = globalThis as any;
export const store: Store = (g.__blockoutStore = new Store(g.__blockoutStore));
