import { defaultProject, demoLevel, emptyLevel } from '$lib/model/defaults';
import { normalizeLevel, normalizeProject, stringifyJSON, stringifyLevel } from '$lib/model/serialize';
import { slug } from '$lib/model/ids';
import { SETTINGS_FILE, applySettingsDoc, updateSettingsDoc } from '$lib/model/settingsDoc';
import type { Level, LevelSummary, Project, VersionInfo } from '$lib/model/types';
import { AGENTS_DOC } from './agents-doc';
import { b64ToBytes, basename, join, type VFS } from './vfs';

export const PROJECT_FILE = 'blockout.project.json';

function prettyName(s: string) {
  return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** All project-folder logic (levels, versions, handoff, settings doc), shared by the local server and the web build. */
export class ProjectStore {
  constructor(public fs: VFS) {}

  async ensureProject(demo = false, name?: string) {
    const fs = this.fs;
    if (!(await fs.exists(PROJECT_FILE))) {
      const dp = defaultProject(prettyName(name ?? basename(fs.label.replace(/\/design\/?$/, '')) ?? 'My Game'));
      await fs.write(SETTINGS_FILE, updateSettingsDoc(null, dp));
      await fs.write(PROJECT_FILE, stringifyJSON(projectJson(dp)));
    }
    if (!(await fs.exists(SETTINGS_FILE))) {
      const p = normalizeProject(JSON.parse((await fs.read(PROJECT_FILE)) ?? '{}'));
      await fs.write(SETTINGS_FILE, updateSettingsDoc(null, p));
    }
    if (!(await fs.exists('AGENTS-blockout.md'))) await fs.write('AGENTS-blockout.md', AGENTS_DOC);
    const levels = await this.listLevels();
    if (demo && !levels.some((l) => l.id === 'demo')) await this.writeLevelRaw('demo', demoLevel());
    else if (!levels.length) await this.writeLevelRaw('level-01', emptyLevel('level-01', 'Level 01'));
  }

  async readProject(): Promise<Project> {
    const p = normalizeProject(JSON.parse((await this.fs.read(PROJECT_FILE)) ?? '{}'));
    const doc = await this.fs.read(SETTINGS_FILE);
    if (doc != null) {
      const w = applySettingsDoc(p, doc);
      if (w.length) p.settingsWarnings = w;
    }
    return p;
  }

  async writeProject(p: Project) {
    p = normalizeProject(p);
    const prev = await this.fs.read(SETTINGS_FILE);
    const next = updateSettingsDoc(prev, p);
    if (next !== prev) await this.fs.write(SETTINGS_FILE, next);
    await this.fs.write(PROJECT_FILE, stringifyJSON(projectJson(p)));
  }

  levelDir(id: string) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new Error('Bad level id');
    return join('levels', id);
  }

  async listLevels(): Promise<LevelSummary[]> {
    const out: LevelSummary[] = [];
    for (const d of await this.fs.list('levels')) {
      if (!d.dir) continue;
      const f = join('levels', d.name, 'level.json');
      const text = await this.fs.read(f);
      if (text == null) continue;
      try {
        const raw = JSON.parse(text);
        const t = await this.fs.mtime(f);
        const versions = await this.listVersions(d.name).catch(() => []);
        out.push({ id: d.name, name: raw.name ?? d.name, modified: t ? new Date(t).toISOString() : '', versions: versions.length });
      } catch {
        out.push({ id: d.name, name: d.name + ' (unreadable)', modified: '', versions: 0 });
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }

  async readLevel(id: string): Promise<Level> {
    const text = await this.fs.read(join(this.levelDir(id), 'level.json'));
    if (text == null) throw new Error(`No level "${id}"`);
    const l = normalizeLevel(JSON.parse(text), id);
    l.id = id;
    return l;
  }

  private async writeLevelRaw(id: string, level: Level) {
    const f = join(this.levelDir(id), 'level.json');
    const cur = await this.fs.read(f);
    if (cur != null) await this.fs.write(join(this.levelDir(id), '.previous.json'), cur); // safety net
    await this.fs.write(f, stringifyLevel({ ...level, id }));
  }
  writeLevel(id: string, level: Level) {
    return this.writeLevelRaw(id, normalizeLevel(level, id));
  }

  async createLevel(name: string, from?: Level) {
    const existing = new Set((await this.listLevels()).map((l) => l.id));
    let id = slug(name);
    let n = 2;
    while (existing.has(id)) id = `${slug(name)}-${n++}`;
    await this.writeLevel(id, from ? { ...structuredClone(from), id, name } : emptyLevel(id, name));
    return id;
  }

  async deleteLevel(id: string) {
    await this.fs.move(this.levelDir(id), join('.trash', `${id}-${Date.now()}`));
  }

  async listVersions(id: string): Promise<VersionInfo[]> {
    const t = await this.fs.read(join(this.levelDir(id), 'versions', 'index.json'));
    return t ? JSON.parse(t) : [];
  }
  private writeIndex(id: string, idx: VersionInfo[]) {
    return this.fs.write(join(this.levelDir(id), 'versions', 'index.json'), JSON.stringify(idx, null, 2) + '\n');
  }
  async saveVersion(id: string, level: Level, message: string, handoff = false) {
    const idx = await this.listVersions(id);
    const n = (idx.at(-1)?.n ?? 0) + 1;
    await this.fs.write(join(this.levelDir(id), 'versions', String(n).padStart(4, '0') + '.json'), stringifyLevel({ ...level, id }));
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
    const t = await this.fs.read(join(this.levelDir(id), 'versions', String(n).padStart(4, '0') + '.json'));
    if (t == null) throw new Error(`No version ${n}`);
    return normalizeLevel(JSON.parse(t), id);
  }
  async setBaseline(id: string, n: number) {
    const idx = await this.listVersions(id);
    idx.forEach((v) => {
      delete v.baseline;
      if (v.n === n) v.baseline = true;
    });
    await this.writeIndex(id, idx);
  }

  async writeHandoff(id: string, files: { name: string; text?: string; base64?: string }[]) {
    const dir = join(this.levelDir(id), 'handoff');
    for (const f of files) await this.fs.write(join(dir, basename(f.name)), f.base64 != null ? b64ToBytes(f.base64) : f.text ?? '');
    return join(this.fs.label, dir);
  }
}

/** gameplay numbers live in the settings doc only — the JSON keeps vocabulary, stamps, pens */
function projectJson(p: Project) {
  const { character, engine, grid, defaults, traversal, ...rest } = p as Project & { targetEngine?: unknown };
  void character; void engine; void grid; void defaults; void traversal;
  delete (rest as any).targetEngine;
  delete (rest as any).settingsWarnings;
  return { ...rest, settings: SETTINGS_FILE };
}
