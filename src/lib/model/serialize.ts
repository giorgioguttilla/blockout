import type { Level, LevelElement, Project, Role } from './types';
import { defaultProject, DEFAULT_CHARACTER, STARTER_STAMPS, STARTER_TAGS } from './defaults';
import { engineConventionFromLegacy } from './engine';

const ELEMENT_KEY_ORDER = [
  'id', 'type', 'name', 'tags', 'role', 'stamp', 'transform', 'shape', 'path', 'marker', 'depth',
  'props', 'notes', 'precision', 'storey', 'group', 'hidden', 'locked'
];
const TOP_ORDER = ['format', 'id', 'name', 'intent', 'storeys', 'elements'];

function round(n: number) {
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

function orderKeys(obj: Record<string, any>, order?: string[]) {
  if (!order) return obj;
  const out: Record<string, any> = {};
  for (const k of order) if (k in obj) out[k] = obj[k];
  for (const k of Object.keys(obj)) if (!(k in out)) out[k] = obj[k];
  return out;
}

function isPrimitive(v: unknown) {
  return v === null || typeof v !== 'object';
}
function isFlat(v: unknown): boolean {
  if (isPrimitive(v)) return true;
  if (Array.isArray(v)) return v.every(isPrimitive);
  return false;
}

function prep(v: any, ctx: 'level' | 'element' | 'other' = 'other'): any {
  if (typeof v === 'number') return round(v);
  if (Array.isArray(v)) return v.map((x) => prep(x, ctx === 'level' ? 'element' : 'other'));
  if (v && typeof v === 'object') {
    let o: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined) continue;
      if (ctx === 'element') {
        if ((k === 'name' || k === 'notes' || k === 'storey' || k === 'group') && !val) continue;
        if ((k === 'hidden' || k === 'locked') && !val) continue;
        if (k === 'props' && Object.keys(val as object).length === 0) continue;
      }
      o[k] = prep(val, k === 'elements' ? 'level' : 'other');
    }
    if (ctx === 'element') o = orderKeys(o, ELEMENT_KEY_ORDER);
    return o;
  }
  return v;
}

function write(v: any, indent: string): string {
  if (isPrimitive(v)) return JSON.stringify(v);
  const next = indent + '  ';
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (v.every(isPrimitive)) return '[' + v.map((x) => JSON.stringify(x)).join(', ') + ']';
    if (v.every((x) => Array.isArray(x) && x.every(isPrimitive))) {
      const inner = v.map((x) => write(x, next));
      const oneLine = '[' + inner.join(', ') + ']';
      if (oneLine.length < 90) return oneLine;
      return '[\n' + inner.map((s) => next + s).join(',\n') + '\n' + indent + ']';
    }
    return '[\n' + v.map((x) => next + write(x, next)).join(',\n') + '\n' + indent + ']';
  }
  const entries = Object.entries(v);
  if (entries.length === 0) return '{}';
  if (entries.every(([, x]) => isFlat(x))) {
    const s = '{ ' + entries.map(([k, x]) => JSON.stringify(k) + ': ' + write(x, next)).join(', ') + ' }';
    if (s.length + indent.length < 100) return s;
  }
  return '{\n' + entries.map(([k, x]) => next + JSON.stringify(k) + ': ' + write(x, next)).join(',\n') + '\n' + indent + '}';
}

/** Canonical, git-friendly JSON: stable key order, mm rounding, compact numeric arrays. */
export function stringifyLevel(level: Level): string {
  const o = orderKeys(prep(level, 'other'), TOP_ORDER);
  o.elements = (level.elements ?? []).map((e) => prep(e, 'element'));
  return write(o, '') + '\n';
}

export function stringifyJSON(v: unknown): string {
  return write(prep(v), '') + '\n';
}

const ROLES: Role[] = ['solid', 'cut', 'zone', 'guide'];

export function normalizeElement(raw: any, i = 0): LevelElement {
  const e: any = { ...raw };
  e.id = typeof e.id === 'string' && e.id ? e.id : `el-${i + 1}`;
  if (!['shape', 'path', 'marker', 'stamp', 'note'].includes(e.type)) {
    e.type = e.shape ? 'shape' : e.path ? 'path' : e.stamp ? 'stamp' : 'marker';
  }
  e.tags = Array.isArray(e.tags) ? e.tags.filter((t: unknown) => typeof t === 'string') : [];
  if (!ROLES.includes(e.role)) e.role = e.type === 'shape' ? 'solid' : e.type === 'path' ? 'zone' : 'guide';
  const tr = e.transform ?? {};
  e.transform = {
    position: vec3(tr.position ?? e.position, [0, 0, 0]),
    rotation: vec3(tr.rotation ?? e.rotation, [0, 0, 0])
  };
  delete e.position;
  delete e.rotation;
  e.props = e.props && typeof e.props === 'object' ? e.props : {};
  e.notes = typeof e.notes === 'string' ? e.notes : '';
  e.precision = e.precision === 'loose' ? 'loose' : 'exact';
  if (e.type === 'shape') {
    const s = e.shape ?? {};
    s.kind = ['box', 'extrude', 'prism', 'cylinder', 'ramp', 'stairs', 'blob'].includes(s.kind) ? s.kind : s.points ? 'extrude' : s.radius ? 'prism' : 'box';
    if (s.taper != null) s.taper = Math.max(0, Math.min(1, Number(s.taper) || 0));
    if (s.kind === 'prism') {
      s.sides = Math.max(3, Math.round(Number(s.sides) || 6));
      s.radius = Number(s.radius) > 0 ? Number(s.radius) : 1;
      s.height = Number.isFinite(s.height) ? s.height : 1;
    } else if (s.kind === 'extrude') {
      s.points = Array.isArray(s.points) && s.points.length >= 3 ? s.points.map((p: any) => [Number(p[0]) || 0, Number(p[1]) || 0]) : [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      s.height = Number.isFinite(s.height) ? s.height : 1;
    } else {
      s.size = vec3(s.size, [1, 1, 1]);
    }
    e.shape = s;
  } else if (e.type === 'path') {
    const p = e.path ?? {};
    e.path = {
      points: Array.isArray(p.points) ? p.points.map((q: any) => vec3(q, [0, 0, 0])) : [],
      width: Number.isFinite(p.width) ? p.width : 2,
      closed: !!p.closed,
      smooth: p.smooth !== false
    };
  } else if (e.type === 'marker') {
    e.marker = { radius: Number(e.marker?.radius) || 0 };
  } else if (e.type === 'stamp') {
    e.stamp = String(e.stamp ?? 'door');
  }
  return e as LevelElement;
}

function vec3(v: any, d: [number, number, number]): [number, number, number] {
  if (!Array.isArray(v)) return [...d];
  return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
}

export function normalizeLevel(raw: any, fallbackId = 'level'): Level {
  const seen = new Set<string>();
  const elements = (Array.isArray(raw?.elements) ? raw.elements : []).map((e: any, i: number) => {
    const n = normalizeElement(e, i);
    while (seen.has(n.id)) n.id = n.id + '-dup';
    seen.add(n.id);
    return n;
  });
  return {
    format: 'blockout/level@1',
    id: typeof raw?.id === 'string' ? raw.id : fallbackId,
    name: typeof raw?.name === 'string' ? raw.name : fallbackId,
    intent: typeof raw?.intent === 'string' ? raw.intent : '',
    storeys: Array.isArray(raw?.storeys) && raw.storeys.length ? raw.storeys : [{ id: 'ground', name: 'Ground', y: 0 }],
    elements
  };
}

export function normalizeProject(raw: any): Project {
  const d = defaultProject(raw?.name ?? 'My Game');
  const out: any = {
    ...d,
    ...raw,
    format: 'blockout/project@1',
    engine: raw?.engine && typeof raw.engine === 'object' ? { ...d.engine, ...raw.engine } : engineConventionFromLegacy(raw?.targetEngine),
    grid: { ...d.grid, ...(raw?.grid ?? {}) },
    defaults: { ...d.defaults, ...(raw?.defaults ?? {}) },
    character: { ...DEFAULT_CHARACTER, ...(raw?.character ?? {}) },
    pens: Array.isArray(raw?.pens) && raw.pens.length ? [...raw.pens, ...d.pens].slice(0, 10) : d.pens,
    tags: raw?.tags && typeof raw.tags === 'object' ? raw.tags : structuredClone(STARTER_TAGS),
    stamps: raw?.stamps && typeof raw.stamps === 'object' ? raw.stamps : structuredClone(STARTER_STAMPS),
    traversal: { ...d.traversal, ...(raw?.traversal ?? {}) }
  };
  delete out.targetEngine; // pre-convention projects stored just an engine name
  return out as Project;
}
