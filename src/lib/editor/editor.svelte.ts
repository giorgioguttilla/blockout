import type { Level, LevelElement, LevelSummary, Project, Role, TagDef, VersionInfo } from '$lib/model/types';
import { defaultProject, emptyLevel } from '$lib/model/defaults';
import { idBase, nextId, slug } from '$lib/model/ids';
import { diffLevels, diffSummary } from '$lib/model/diff';
import { api } from './api';
import type { AnalysisResult } from '$lib/traversal/analysis';

export type ToolName = 'select' | 'draw' | 'line' | 'marker' | 'stamp' | 'note' | 'tape';
export type DrawShape = 'box' | 'ngon' | 'circle' | 'cone' | 'ramp' | 'stairs';
export const DRAW_SHAPES: { key: DrawShape; label: string; hint: string }[] = [
  { key: 'box', label: 'Box', hint: 'Drag corner to corner' },
  { key: 'ngon', label: 'N-gon', hint: 'Drag from the center; [ ] change sides' },
  { key: 'circle', label: 'Circle', hint: 'Drag from the center' },
  { key: 'cone', label: 'Cone', hint: 'Drag from the center, then pull up' },
  { key: 'ramp', label: 'Ramp', hint: 'Drag from the bottom to where it arrives' },
  { key: 'stairs', label: 'Stairs', hint: 'Drag from the bottom to where they arrive' }
];
export type ModalName = null | 'palette' | 'save-version' | 'handoff' | 'settings' | 'help' | 'tags' | 'pen-picker' | 'stamps' | 'new-level';

export interface PenInfo {
  key: string;
  index: number;
  label: string;
  color: string;
  role: Role;
  tags: string[];
  category: TagDef['category'] | 'solid' | 'cut';
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'ok' | 'warn' | 'error';
  action?: { label: string; run: () => void };
}

export const TOOL_INFO: Record<ToolName, { key: string; label: string; hint: string }> = {
  select: { key: 'V', label: 'Select', hint: 'Click to select · drag to move · drag a face arrow to push/pull · Alt-drag duplicates · Shift adds' },
  draw: { key: 'D', label: 'Draw', hint: 'Drag = box · click-click-click = polygon (Enter / click first point to close) · then move to set height, click · type numbers for exact size' },
  line: { key: 'L', label: 'Line', hint: 'Click to add points · drag to sketch freehand · Enter / double-click to finish · [ ] width' },
  marker: { key: 'M', label: 'Marker', hint: 'Click to place · drag to place and aim (facing) · pick a pen for what it is' },
  stamp: { key: 'S', label: 'Stamp', hint: 'Hover a wall or floor, click to stamp · , . rotate' },
  note: { key: 'N', label: 'Note', hint: 'Click to pin a note, then type' },
  tape: { key: 'T', label: 'Tape', hint: 'Click two points to measure distance, height and which jump it needs' }
};

let toastId = 1;

export class Editor {
  // ------------------------------------------------------------ session
  root = $state<string | null>(null);
  /** human label for the open project (web build: folder name / in-browser) */
  rootLabel = $state('');
  recent = $state.raw<string[]>([]);
  home = $state('');
  ready = $state(false);

  // ------------------------------------------------------------ document
  project = $state.raw<Project>(defaultProject());
  level = $state.raw<Level>(emptyLevel('level-01', 'Level 01'));
  levelId = $state('');
  levels = $state.raw<LevelSummary[]>([]);
  versions = $state.raw<VersionInfo[]>([]);
  saveState = $state<'saved' | 'saving' | 'dirty' | 'error'>('saved');

  // ------------------------------------------------------------ editor ui state
  selection = $state.raw<string[]>([]);
  hovered = $state<string | null>(null);
  tool = $state<ToolName>('draw');
  pen = $state(0);
  stamp = $state('door');
  drawShape = $state<DrawShape>('box');
  ngonSides = $state(6);
  rampWidth = $state(2);
  view = $state<'3d' | 'plan'>('3d');
  planeY = $state(0);
  snap = $state(true);
  showLabels = $state(true);
  showScale = $state(true);
  section = $state(false);
  leftPanel = $state(true);
  rightPanel = $state(true);
  leftTab = $state<'elements' | 'versions'>('elements');
  modal = $state<ModalName>(null);
  modalArg = $state<any>(null);
  toasts = $state<Toast[]>([]);
  hud = $state<{ text: string; input: string; x: number; y: number } | null>(null);
  hint = $state('');
  cursor = $state<{ x: number; y: number; z: number } | null>(null);
  inlineTag = $state<{ id: string; x: number; y: number } | null>(null);
  marquee = $state<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  focusNotes = $state(0);
  editingNote = $state<string | null>(null);
  inputMode = $state<'auto' | 'mouse' | 'trackpad'>('auto');

  // compare / external
  compare = $state.raw<{ base: Level; label: string } | null>(null);
  external = $state.raw<Level | null>(null);

  // traversal
  analysis = $state.raw<AnalysisResult | null>(null);
  showAnalysis = $state(false);
  analyzing = $state(false);
  walking = $state(false);
  jumpRings = $state(false);
  analysisProgress = $state(0);
  walkStats = $state<{ speed: number; peak: number; airtime: number; grounded: boolean; sprint: boolean } | null>(null);
  handoffResult = $state<{ dir: string; prompt: string; kind: 'brief' | 'changes'; summary: string; images: string[] } | null>(null);

  // ------------------------------------------------------------ internals
  undoStack: Level[] = [];
  redoStack: Level[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(level: Level, prev: Level | null) => void>();
  private projectListeners = new Set<() => void>();
  clipboard: LevelElement[] = [];
  analysisStale = false;
  engine: any = null;

  // ------------------------------------------------------------ lifecycle
  async boot() {
    const s = await api.session();
    this.recent = s.recent;
    this.home = s.home;
    if (s.root && s.project) {
      await this.adopt(s.root, s.project, s.levels);
    }
    this.ready = true;
    this.listenEvents();
  }

  async openFolder(path: string, opts: { create?: boolean; demo?: boolean } = {}) {
    const r = await api.open(path, opts);
    this.rootLabel = r.label ?? r.root;
    await this.adopt(r.root, r.project, r.levels, opts.demo ? 'demo' : undefined);
    this.recent = [r.root, ...this.recent.filter((p) => p !== r.root)];
  }

  async closeFolder() {
    await this.flushSave();
    await api.close();
    this.root = null;
    const s = await api.session();
    this.recent = s.recent;
  }

  private async adopt(root: string, project: Project, levels: LevelSummary[], prefer?: string) {
    this.root = root;
    this.project = project;
    this.levels = levels;
    this.emitProject();
    const last = localStorage.getItem('blockout:last:' + root);
    const id = (prefer && levels.find((l) => l.id === prefer)?.id) || levels.find((l) => l.id === last)?.id || levels[0]?.id;
    if (id) await this.openLevel(id);
  }

  async openLevel(id: string) {
    await this.flushSave();
    const level = await api.level(id);
    this.levelId = id;
    api.watchLevel(id);
    this.undoStack = [];
    this.redoStack = [];
    this.selection = [];
    this.compare = null;
    this.external = null;
    this.analysis = null;
    this.showAnalysis = false;
    this.planeY = level.storeys[0]?.y ?? 0;
    this.setLevel(level, null);
    this.saveState = 'saved';
    localStorage.setItem('blockout:last:' + this.root, id);
    this.refreshVersions();
    queueMicrotask(() => this.engine?.frameAll(false));
  }

  async refreshLevels() {
    this.levels = await api.levels();
  }
  async refreshVersions() {
    if (!this.levelId) return;
    this.versions = await api.versions(this.levelId).catch(() => []);
  }

  async newLevel(name: string, from?: Level) {
    const { id } = await api.createLevel(name, from);
    await this.refreshLevels();
    await this.openLevel(id);
    this.toast(from ? `Branched into "${name}"` : `Created "${name}"`, 'ok');
  }

  async deleteLevel(id: string) {
    await api.deleteLevel(id);
    await this.refreshLevels();
    if (id === this.levelId) {
      if (this.levels[0]) await this.openLevel(this.levels[0].id);
      else await this.newLevel('Level 01');
    }
    this.toast('Level moved to .trash', 'info');
  }

  private listenEvents() {
    api.subscribe(async (ev) => {
      if (ev.kind === 'level' && ev.id === this.levelId) {
        const disk = await api.level(ev.id).catch(() => null);
        if (!disk) return;
        const d = diffLevels(this.level, disk);
        if (d.empty) return;
        this.external = disk;
      } else if (ev.kind === 'level' || ev.kind === 'levels') {
        this.refreshLevels();
      } else if (ev.kind === 'project') {
        const p = await api.project().catch(() => null);
        if (p) {
          this.project = p;
          this.emitProject();
          this.toast('Project settings reloaded from disk', 'info');
        }
      }
    });
  }

  acceptExternal() {
    if (!this.external) return;
    const prev = this.level;
    const incoming = this.external;
    this.external = null;
    this.commit(incoming);
    this.compare = { base: prev, label: 'before the change on disk' };
    this.toast(`Loaded changes from disk (${diffSummary(diffLevels(prev, incoming))}). ⌘Z to undo.`, 'ok');
  }

  // ------------------------------------------------------------ change plumbing
  onLevel(fn: (level: Level, prev: Level | null) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  onProject(fn: () => void) {
    this.projectListeners.add(fn);
    return () => this.projectListeners.delete(fn);
  }
  emitProject() {
    for (const l of this.projectListeners) l();
  }

  private setLevel(level: Level, prev: Level | null) {
    this.level = level;
    this.analysisStale = true;
    for (const l of this.listeners) l(level, prev);
  }

  /** Live preview without undo/save (during drags). */
  preview(level: Level) {
    this.setLevel(level, this.level);
  }

  /** Commit a new document state. `from` = state before a drag started (for undo). */
  commit(level: Level, from?: Level) {
    const before = from ?? this.level;
    if (before === level) return;
    this.undoStack.push(before);
    if (this.undoStack.length > 300) this.undoStack.shift();
    this.redoStack = [];
    this.setLevel(level, this.level);
    this.scheduleSave();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return this.toast('Nothing to undo', 'info');
    this.redoStack.push(this.level);
    this.setLevel(prev, this.level);
    this.pruneSelection();
    this.scheduleSave();
  }
  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.level);
    this.setLevel(next, this.level);
    this.pruneSelection();
    this.scheduleSave();
  }
  private pruneSelection() {
    const ids = new Set(this.level.elements.map((e) => e.id));
    this.selection = this.selection.filter((i) => ids.has(i));
  }

  scheduleSave() {
    this.saveState = 'dirty';
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 400);
  }
  async save(unloading = false) {
    if (!this.levelId) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.saveState = 'saving';
    try {
      await api.saveLevel(this.levelId, this.level, unloading);
      if (!this.saveTimer) this.saveState = 'saved';
    } catch (e) {
      this.saveState = 'error';
      this.toast('Could not save: ' + (e as Error).message, 'error');
    }
  }
  async flushSave() {
    if (this.saveTimer) await this.save();
  }

  private projectTimer: ReturnType<typeof setTimeout> | null = null;
  updateProject(fn: (p: Project) => Project) {
    this.project = fn(structuredClone(this.project));
    this.emitProject();
    this.analysisStale = true;
    if (this.projectTimer) clearTimeout(this.projectTimer);
    this.projectTimer = setTimeout(() => api.saveProject(this.project).catch((e) => this.toast('Could not save project: ' + e.message, 'error')), 400);
  }

  // ------------------------------------------------------------ element helpers
  get(id: string) {
    return this.level.elements.find((e) => e.id === id);
  }
  get selected(): LevelElement[] {
    const s = new Set(this.selection);
    return this.level.elements.filter((e) => s.has(e.id));
  }

  withElements(elements: LevelElement[]): Level {
    return { ...this.level, elements };
  }

  add(els: LevelElement[], select = true) {
    this.commit(this.withElements([...this.level.elements, ...els]));
    if (select) this.selection = els.map((e) => e.id);
  }

  update(ids: string[] | Set<string>, fn: (e: LevelElement) => LevelElement, base?: Level): Level {
    const set = ids instanceof Set ? ids : new Set(ids);
    const src = base ?? this.level;
    return { ...src, elements: src.elements.map((e) => (set.has(e.id) ? fn(structuredClone(e)) : e)) };
  }

  patch(ids: string[], fn: (e: LevelElement) => void) {
    this.commit(
      this.update(ids, (e) => {
        fn(e);
        return e;
      })
    );
  }

  remove(ids: string[]) {
    if (!ids.length) return;
    const set = new Set(ids);
    this.commit(this.withElements(this.level.elements.filter((e) => !set.has(e.id))));
    this.selection = this.selection.filter((i) => !set.has(i));
  }

  newId(e: Partial<LevelElement> & { type: LevelElement['type'] }, taken?: Set<string>) {
    const ids = taken ?? new Set(this.level.elements.map((x) => x.id));
    return nextId(ids, idBase({ tags: [], role: 'solid', ...e } as any));
  }

  /** Clone elements with fresh ids. */
  cloneElements(els: LevelElement[], offset: [number, number, number] = [0, 0, 0]) {
    const taken = new Set(this.level.elements.map((x) => x.id));
    return els.map((e) => {
      const c = structuredClone(e);
      c.id = nextId(taken, idBase(c as any));
      taken.add(c.id);
      c.transform.position = [c.transform.position[0] + offset[0], c.transform.position[1] + offset[1], c.transform.position[2] + offset[2]];
      return c;
    });
  }

  // ------------------------------------------------------------ pens
  penInfo(i: number): PenInfo {
    const key = this.project.pens[i] ?? '@solid';
    if (key === '@solid') return { key, index: i, label: 'Solid', color: '#c9ced6', role: 'solid', tags: [], category: 'solid' };
    if (key === '@cut') return { key, index: i, label: 'Cut', color: '#ff5a5f', role: 'cut', tags: [], category: 'cut' };
    const def = this.project.tags[key];
    const category = def?.category ?? 'zone';
    return { key, index: i, label: key, color: def?.color ?? '#9e9e9e', role: this.roleFor(key), tags: [key], category };
  }
  get currentPen() {
    return this.penInfo(this.pen);
  }
  roleFor(tag: string): Role {
    const d = this.project.tags[tag];
    if (!d) return 'zone';
    if (d.defaultRole) return d.defaultRole;
    return d.category === 'geometry' ? 'solid' : d.category === 'zone' || d.category === 'flow' ? 'zone' : 'guide';
  }
  tagColor(tag?: string) {
    return (tag && this.project.tags[tag]?.color) || '#9e9e9e';
  }

  selectPen(i: number) {
    this.pen = i;
    const p = this.penInfo(i);
    // picking a pen = picking up that pencil: switch to the tool that draws it
    if (p.category === 'object' || p.category === 'actor' || p.category === 'point') this.setTool('marker');
    else if (p.category === 'flow') this.setTool('line');
    else if (this.tool !== 'draw' && this.tool !== 'line') this.setTool('draw');
  }

  setPenSlot(i: number, key: string) {
    this.updateProject((p) => {
      p.pens[i] = key;
      return p;
    });
    this.selectPen(i);
  }

  applyPenToSelection(i: number) {
    const p = this.penInfo(i);
    const ids = this.selection;
    if (!ids.length) return;
    this.patch(ids, (e) => {
      if (p.key === '@solid') {
        e.role = 'solid';
      } else if (p.key === '@cut') {
        if (e.type === 'shape') e.role = 'cut';
      } else {
        e.tags = [p.key, ...e.tags.filter((t) => t !== p.key)];
        if (e.type === 'shape' || e.type === 'path') e.role = p.role === 'guide' && e.type === 'shape' ? 'zone' : p.role;
        if (p.category === 'zone') e.precision = 'loose';
      }
    });
    this.toast(`Applied ${p.label} to ${ids.length} element${ids.length > 1 ? 's' : ''}`, 'ok');
  }

  ensureTag(name: string): string {
    const t = slug(name);
    if (!this.project.tags[t]) {
      const hue = [...t].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
      this.updateProject((p) => {
        p.tags[t] = { category: 'zone', description: '', color: hslHex(hue, 55, 55) };
        return p;
      });
    }
    return t;
  }

  addTag(ids: string[], tag: string) {
    const t = this.ensureTag(tag);
    this.patch(ids, (e) => {
      if (!e.tags.includes(t)) e.tags.push(t);
      if (e.tags.length === 1 && (e.type === 'shape' || e.type === 'path') && e.role === 'solid') {
        const r = this.roleFor(t);
        if (r === 'zone') e.role = 'zone';
      }
    });
  }

  // ------------------------------------------------------------ tools & ui
  setTool(t: ToolName) {
    if (this.tool === t) return;
    this.tool = t;
    this.engine?.tools?.activate(t);
  }

  toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action']) {
    const id = toastId++;
    this.toasts = [...this.toasts, { id, text, kind, action }];
    setTimeout(() => (this.toasts = this.toasts.filter((t) => t.id !== id)), action ? 7000 : 3200);
  }

  openModal(m: ModalName, arg: any = null) {
    this.modal = m;
    this.modalArg = arg;
  }

  get snapStep() {
    return this.project.grid.size / Math.max(1, this.project.grid.subdivisions);
  }

  // ------------------------------------------------------------ versions
  async saveVersion(message: string, handoff = false) {
    await this.flushSave();
    const v = await api.saveVersion(this.levelId, this.level, message, handoff);
    await this.refreshVersions();
    if (!handoff) this.toast(`Saved version ${v.n}: ${v.message}`, 'ok');
    return v;
  }
  async compareWith(n: number) {
    const base = await api.version(this.levelId, n);
    const v = this.versions.find((x) => x.n === n);
    this.compare = { base, label: `v${n}${v ? ' · ' + v.message : ''}` };
  }
  async restoreVersion(n: number) {
    const lvl = await api.version(this.levelId, n);
    this.commit({ ...lvl, id: this.levelId });
    this.compare = null;
    this.toast(`Restored version ${n}. ⌘Z to undo.`, 'ok');
  }
  async branchVersion(n: number | null) {
    const lvl = n == null ? this.level : await api.version(this.levelId, n);
    await this.newLevel(`${this.level.name} alt`, lvl);
  }
  baseline() {
    return [...this.versions].reverse().find((v) => v.baseline) ?? null;
  }
}

function hslHex(h: number, s: number, l: number) {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

export const editor = new Editor();
if (typeof window !== 'undefined') (window as any).__editor = editor;
