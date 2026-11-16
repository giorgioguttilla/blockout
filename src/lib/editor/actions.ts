import * as THREE from 'three';
import { editor, TOOL_INFO, type ToolName } from './editor.svelte';
import { api } from './api';
import { analyze } from '$lib/traversal/analysis';
import { WalkMode } from '$lib/traversal/walk';
import { buildBrief, buildChanges, handoffPrompt } from '$lib/model/brief';
import { diffSummary } from '$lib/model/diff';
import { stringifyJSON } from '$lib/model/serialize';
import type { Engine } from '$lib/engine/Engine';
import type { LevelElement } from '$lib/model/types';

const eng = () => editor.engine as Engine | null;

export async function runAnalysis(show = true) {
  const e = eng();
  if (!e || editor.analyzing) return editor.analysis;
  const geom = e.collisionGeometry();
  if (!geom) {
    editor.toast('Nothing solid to analyze yet', 'warn');
    return null;
  }
  editor.analyzing = true;
  editor.analysisProgress = 0;
  try {
    const res = await analyze(geom, e.flatElements(), editor.project, (f) => (editor.analysisProgress = f));
    editor.analysis = res;
    editor.analysisStale = false;
    if (show) {
      editor.showAnalysis = true;
      e.showAnalysis(res);
    }
    return res;
  } catch (err) {
    console.error(err);
    editor.toast('Analysis failed: ' + (err as Error).message, 'error');
    return null;
  } finally {
    geom.dispose();
    editor.analyzing = false;
  }
}

export function toggleAnalysis() {
  const e = eng();
  if (!e) return;
  if (editor.showAnalysis && !editor.analysisStale) {
    editor.showAnalysis = false;
    e.showAnalysis(null);
    return;
  }
  runAnalysis(true);
}

let walk: WalkMode | null = null;
export function startWalk() {
  const e = eng();
  if (!e || editor.walking) return;
  walk = new WalkMode(e);
  let at: THREE.Vector3 | null = null;
  let yaw = (e.rig.s.yaw * 180) / Math.PI;
  const spawn = editor.level.elements.find((x) => x.type === 'marker' && x.tags.includes('spawn'));
  if (editor.cursor && editor.tool !== 'select') at = new THREE.Vector3(editor.cursor.x, editor.cursor.y, editor.cursor.z);
  else if (spawn) {
    at = new THREE.Vector3(...spawn.transform.position);
    yaw = spawn.transform.rotation[1] + 180;
  } else at = e.rig.s.target.clone();
  walk.onExit = () => {
    editor.walking = false;
    editor.walkStats = null;
    walk = null;
  };
  if (walk.start(at, yaw - 180)) {
    editor.walking = true;
    editor.selection = [];
  }
}

export function setTool(t: ToolName) {
  editor.setTool(t);
}

export function toggleView() {
  editor.view = editor.view === '3d' ? 'plan' : '3d';
  eng()?.setView(editor.view);
}

export function setPlane(y: number) {
  editor.planeY = Math.round(y * 1000) / 1000;
  eng()?.invalidate();
  eng()?.tools.rehover();
}

export function shiftPlane(dir: number, storey = false) {
  if (storey) {
    const ys = [...new Set(editor.level.storeys.map((s) => s.y))].sort((a, b) => a - b);
    const cur = editor.planeY;
    const next = dir > 0 ? ys.find((y) => y > cur + 1e-3) : [...ys].reverse().find((y) => y < cur - 1e-3);
    if (next != null) setPlane(next);
    return;
  }
  setPlane(editor.planeY + dir * editor.snapStep);
}

export function duplicate() {
  const sel = editor.selected;
  if (!sel.length) return;
  const step = editor.project.grid.size;
  const clones = editor.cloneElements(sel, [step, 0, step]);
  editor.add(clones);
  editor.toast(`Duplicated ${clones.length}`, 'ok');
}

export async function copy() {
  const sel = editor.selected;
  if (!sel.length) return;
  editor.clipboard = structuredClone(sel);
  try {
    await navigator.clipboard.writeText(JSON.stringify({ blockout: 'elements@1', elements: sel }, null, 2));
  } catch {}
  editor.toast(`Copied ${sel.length}`, 'info');
}

export async function paste() {
  let els: LevelElement[] = editor.clipboard;
  try {
    const t = await navigator.clipboard.readText();
    const j = JSON.parse(t);
    if (j?.blockout === 'elements@1' && Array.isArray(j.elements)) els = j.elements;
  } catch {}
  if (!els.length) return;
  const c = editor.cursor;
  let offset: [number, number, number] = [editor.project.grid.size, 0, editor.project.grid.size];
  if (c) {
    const b = new THREE.Box3();
    for (const e of els) b.expandByPoint(new THREE.Vector3(...e.transform.position));
    const ctr = b.getCenter(new THREE.Vector3());
    const s = editor.snapStep;
    offset = [Math.round((c.x - ctr.x) / s) * s, Math.round((c.y - b.min.y) / s) * s, Math.round((c.z - ctr.z) / s) * s];
  }
  const clones = editor.cloneElements(els, offset);
  editor.add(clones);
}

export function selectAll() {
  editor.selection = editor.level.elements.filter((e) => !e.hidden && !e.locked).map((e) => e.id);
  eng()?.refreshHighlights();
}

export function hideSelection() {
  const ids = editor.selection;
  if (!ids.length) {
    // unhide all
    const hidden = editor.level.elements.filter((e) => e.hidden).map((e) => e.id);
    if (hidden.length) {
      editor.patch(hidden, (e) => delete e.hidden);
      editor.toast(`Unhid ${hidden.length}`, 'info');
    }
    return;
  }
  editor.patch(ids, (e) => (e.hidden = true));
  editor.selection = [];
  editor.toast(`Hidden ${ids.length} — H with nothing selected unhides all`, 'info');
}

export function groupSelection() {
  const ids = editor.selection;
  if (ids.length < 2) return;
  const name = 'group-' + Math.random().toString(36).slice(2, 6);
  editor.patch(ids, (e) => (e.group = name));
  editor.toast(`Grouped as ${name}`, 'ok');
}

export function selectGroupOf(id: string) {
  const e = editor.get(id);
  if (e?.group) editor.selection = editor.level.elements.filter((x) => x.group === e.group).map((x) => x.id);
}

export async function makeStampFromSelection(name: string) {
  const sel = editor.selected.filter((e) => e.type !== 'stamp');
  if (!sel.length) return;
  const b = new THREE.Box3();
  for (const e of sel) b.expandByPoint(new THREE.Vector3(...e.transform.position));
  const origin = new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2);
  const key = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-') || 'stamp';
  const parts = sel.map((e, i) => {
    const c: any = structuredClone(e);
    c.id = (e.tags[0] ?? e.type) + '-' + (i + 1);
    c.transform.position = [e.transform.position[0] - origin.x, e.transform.position[1] - origin.y, e.transform.position[2] - origin.z];
    return c as LevelElement;
  });
  editor.updateProject((p) => {
    p.stamps[key] = { name, description: `Made from ${sel.length} element(s).`, surface: false, elements: parts };
    return p;
  });
  // replace selection with an instance
  const inst: LevelElement = {
    id: '',
    type: 'stamp',
    stamp: key,
    tags: [],
    role: 'solid',
    transform: { position: [origin.x, origin.y, origin.z], rotation: [0, 0, 0] },
    props: {},
    notes: '',
    precision: 'exact'
  } as any;
  const ids = new Set(sel.map((e) => e.id));
  const rest = editor.level.elements.filter((e) => !ids.has(e.id));
  inst.id = editor.newId(inst, new Set(rest.map((e) => e.id)));
  editor.commit({ ...editor.level, elements: [...rest, inst] });
  editor.selection = [inst.id];
  editor.stamp = key;
  editor.toast(`Stamp "${name}" created — press S to stamp more`, 'ok');
}

// ------------------------------------------------------------------ handoff
export async function handoff(kind: 'brief' | 'changes', message = '') {
  const e = eng();
  if (!e) return;
  await editor.flushSave();
  const baseline = editor.baseline();
  const analysis = (await runAnalysis(false))?.report ?? null;
  editor.toast('Capturing views…', 'info');
  const shots: [string, string][] = [];
  const views: [string, 'top' | 'iso', number][] = [
    ['top.png', 'top', 0],
    ['view-se.png', 'iso', 45],
    ['view-nw.png', 'iso', 225]
  ];
  for (const [name, k, yaw] of views) shots.push([name, await e.capture(k, yaw)]);
  // one floor plan per storey: a horizontal cut through each floor with hatched section caps
  const storeys = [...editor.level.storeys].sort((a, b) => a.y - b.y);
  for (let i = 0; i < storeys.length; i++) {
    const st = storeys[i];
    const next = storeys[i + 1];
    const cut = st.y + Math.min(1.5, next ? (next.y - st.y) * 0.5 : 1.5);
    const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), cut);
    const slug = st.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || st.id;
    shots.push([`plan-${slug}.png`, await e.capture('top', 0, 1600, 1000, { section: plane, title: `${editor.level.name} — floor plan "${st.name}", cut at ${cut} m (hatched = solid)` })]);
  }
  const images = shots.map(([n]) => n);
  const project = editor.project;
  const level = editor.level;
  const files: { name: string; text?: string; base64?: string }[] = [];
  let summary = '';
  let version: number;
  if (kind === 'changes' && baseline) {
    const base = await api.version(editor.levelId, baseline.n);
    const v = await editor.saveVersion(message || `Handoff (changes since v${baseline.n})`, true);
    version = v.n;
    const ch = buildChanges(project, base, level, { baseVersion: baseline.n, version, analysis, images });
    files.push({ name: 'CHANGES.md', text: ch.markdown });
    summary = diffSummary(ch.diff);
  } else {
    const v = await editor.saveVersion(message || 'Handoff', true);
    version = v.n;
    files.push({ name: 'CHANGES.md', text: `# ${level.name}: first handoff (v${version})\n\nNo previous baseline — build everything from BRIEF.md.\n` });
    summary = `${level.elements.length} elements`;
  }
  files.push({ name: 'BRIEF.md', text: buildBrief(project, level, { version, analysis, images }) });
  if (analysis) files.push({ name: 'analysis.json', text: stringifyJSON(analysis) });
  for (const [name, url] of shots) files.push({ name, base64: url.split(',')[1] });
  const { dir } = await api.handoff(editor.levelId, files);
  const levelDir = dir.replace(/[\/\\]handoff$/, '');
  const effectiveKind = kind === 'changes' && baseline ? 'changes' : 'brief';
  const prompt = handoffPrompt(levelDir, effectiveKind);
  files.push({ name: 'PROMPT.txt', text: prompt });
  await api.handoff(editor.levelId, [{ name: 'PROMPT.txt', text: prompt }]);
  editor.handoffResult = { dir, prompt, kind: effectiveKind, summary, images: shots.map(([, u]) => u) };
  await editor.refreshVersions();
  return editor.handoffResult;
}

export function toolKeyMap(): Record<string, ToolName> {
  const m: Record<string, ToolName> = {};
  for (const [name, info] of Object.entries(TOOL_INFO)) m[info.key.toLowerCase()] = name as ToolName;
  return m;
}

if (typeof window !== 'undefined') (window as any).__actions = { runAnalysis, toggleAnalysis, startWalk, handoff, duplicate, setTool, toggleView, shiftPlane, makeStampFromSelection };
