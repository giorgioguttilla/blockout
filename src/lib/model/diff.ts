import type { Level, LevelElement } from './types';
import { shapeName } from './shapes';

export interface ElementChange {
  id: string;
  before: LevelElement;
  after: LevelElement;
  changes: string[];
  moved: number;
}
export interface LevelDiff {
  added: LevelElement[];
  removed: LevelElement[];
  modified: ElementChange[];
  level: string[];
  empty: boolean;
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();
const v = (a: number[]) => '[' + a.map(f).join(', ') + ']';
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function describeElement(e: LevelElement) {
  const what = e.type === 'shape' ? `${e.role} ${shapeName(e.shape)}` : e.type === 'stamp' ? `stamp "${e.stamp}"` : e.type;
  const tags = e.tags.length ? ' #' + e.tags.join(' #') : '';
  return `${what}${tags}`;
}

export function diffLevels(a: Level, b: Level): LevelDiff {
  const A = new Map(a.elements.map((e) => [e.id, e]));
  const B = new Map(b.elements.map((e) => [e.id, e]));
  const added = b.elements.filter((e) => !A.has(e.id));
  const removed = a.elements.filter((e) => !B.has(e.id));
  const modified: ElementChange[] = [];
  for (const e of b.elements) {
    const o = A.get(e.id);
    if (!o || same(o, e)) continue;
    const ch: string[] = [];
    const p0 = o.transform.position, p1 = e.transform.position;
    const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const moved = Math.hypot(d[0], d[1], d[2]);
    if (moved > 1e-4) ch.push(`moved ${f(moved)} m by ${v(d)} → now at ${v(p1)}`);
    if (!same(o.transform.rotation, e.transform.rotation)) {
      ch.push(`rotated ${v(o.transform.rotation)}° → ${v(e.transform.rotation)}°`);
    }
    if (o.type !== e.type) ch.push(`type ${o.type} → ${e.type}`);
    if (o.role !== e.role) ch.push(`role ${o.role} → ${e.role}`);
    const addT = e.tags.filter((t) => !o.tags.includes(t));
    const remT = o.tags.filter((t) => !e.tags.includes(t));
    if (addT.length) ch.push(`tags added: ${addT.map((t) => '#' + t).join(' ')}`);
    if (remT.length) ch.push(`tags removed: ${remT.map((t) => '#' + t).join(' ')}`);
    if ((o.name ?? '') !== (e.name ?? '')) ch.push(`renamed "${o.name ?? ''}" → "${e.name ?? ''}"`);
    if (o.notes !== e.notes) ch.push(`notes: "${e.notes}"`);
    if (o.precision !== e.precision) ch.push(`precision ${o.precision} → ${e.precision}`);
    if (!!o.hidden !== !!e.hidden) ch.push(e.hidden ? 'hidden' : 'unhidden');
    const keys = new Set([...Object.keys(o.props), ...Object.keys(e.props)]);
    for (const k of keys) {
      if (!same(o.props[k], e.props[k])) ch.push(`prop ${k}: ${JSON.stringify(o.props[k] ?? null)} → ${JSON.stringify(e.props[k] ?? null)}`);
    }
    if (o.type === 'shape' && e.type === 'shape' && !same(o.shape, e.shape)) {
      const s0 = o.shape, s1 = e.shape;
      if (s0.kind !== s1.kind) ch.push(`shape ${s0.kind} → ${s1.kind}`);
      if (s1.size && !same(s0.size, s1.size)) ch.push(`size ${s0.size ? v(s0.size) : '?'} → ${v(s1.size)}`);
      if (s1.kind === 'extrude' && !same(s0.points, s1.points)) ch.push(`footprint changed (${s1.points?.length} points)`);
      if ((s0.height ?? null) !== (s1.height ?? null)) ch.push(`height ${s0.height ?? '-'} → ${s1.height ?? '-'}`);
      if (!same(s0.hollow ?? null, s1.hollow ?? null)) ch.push(s1.hollow ? `now hollow (walls ${s1.hollow.wall} m)` : 'no longer hollow');
      if (!!s0.infinite !== !!s1.infinite) ch.push(s1.infinite ? 'now infinite height' : 'finite height');
      if ((s0.sides ?? null) !== (s1.sides ?? null) && s1.kind === 'prism') ch.push(`sides ${s0.sides ?? '-'} → ${s1.sides}`);
      if ((s0.radius ?? null) !== (s1.radius ?? null) && s1.radius != null) ch.push(`radius ${s0.radius ?? '-'} → ${s1.radius} m`);
      if (!!s0.smooth !== !!s1.smooth) ch.push(s1.smooth ? 'now round (smooth)' : `now a ${s1.sides ?? 6}-sided polygon`);
      if ((s0.taper ?? 1) !== (s1.taper ?? 1)) ch.push(`top ${Math.round((s0.taper ?? 1) * 100)}% → ${Math.round((s1.taper ?? 1) * 100)}% of the base`);
      if ((s0.steps ?? null) !== (s1.steps ?? null) && s1.kind === 'stairs') ch.push(`steps ${s0.steps ?? 'auto'} → ${s1.steps ?? 'auto'}`);
    }
    if (o.type === 'path' && e.type === 'path') {
      if (!same(o.path.points, e.path.points)) ch.push(`route changed (${e.path.points.length} points)`);
      if (o.path.width !== e.path.width) ch.push(`width ${f(o.path.width)} → ${f(e.path.width)} m`);
    }
    if (o.type === 'marker' && e.type === 'marker' && o.marker.radius !== e.marker.radius) {
      ch.push(`radius ${f(o.marker.radius)} → ${f(e.marker.radius)} m`);
    }
    if (o.type === 'stamp' && e.type === 'stamp' && (o.stamp !== e.stamp || o.depth !== e.depth)) ch.push(`stamp ${o.stamp} → ${e.stamp}`);
    if (!ch.length) ch.push('changed');
    modified.push({ id: e.id, before: o, after: e, changes: ch, moved });
  }
  const level: string[] = [];
  if (a.name !== b.name) level.push(`level renamed "${a.name}" → "${b.name}"`);
  if (a.intent !== b.intent) level.push(`intent changed: "${b.intent}"`);
  if (!same(a.storeys, b.storeys)) level.push('storeys changed: ' + b.storeys.map((s) => `${s.name} @ ${s.y} m`).join(', '));
  return { added, removed, modified, level, empty: !added.length && !removed.length && !modified.length && !level.length };
}

export function diffSummary(d: LevelDiff) {
  if (d.empty) return 'no changes';
  const parts = [];
  if (d.added.length) parts.push(`${d.added.length} added`);
  if (d.removed.length) parts.push(`${d.removed.length} removed`);
  if (d.modified.length) parts.push(`${d.modified.length} changed`);
  if (d.level.length) parts.push('level info');
  return parts.join(', ');
}
