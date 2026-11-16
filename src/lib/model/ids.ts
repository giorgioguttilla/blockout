import type { LevelElement, ShapeData } from './types';
import { polygonName, taperOf } from './shapes';

export function slug(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

export function idBase(e: Pick<LevelElement, 'type' | 'tags' | 'role'> & { stamp?: string; shape?: ShapeData }) {
  if (e.type === 'stamp') return slug(e.stamp ?? 'stamp');
  if (e.tags[0]) return slug(e.tags[0]);
  if (e.type === 'shape') {
    if (e.role === 'cut') return 'cut';
    if (e.role === 'zone') return 'zone';
    const s = e.shape;
    const k = s?.kind;
    if (s && k === 'prism') {
      const t = taperOf(s);
      if (s.smooth) return t === 0 ? 'cone' : 'cylinder';
      return t === 0 ? 'pyramid' : polygonName(s.sides ?? 6);
    }
    if (s && t0(s)) return 'pyramid';
    return k === 'ramp' ? 'ramp' : k === 'stairs' ? 'stairs' : 'block';
  }
  return e.type;
}

export function nextId(existing: Iterable<string>, base: string) {
  const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)$');
  let max = 0;
  const all = new Set(existing);
  for (const id of all) {
    const m = re.exec(id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  let n = max + 1;
  let id = `${base}-${String(n).padStart(2, '0')}`;
  while (all.has(id)) id = `${base}-${String(++n).padStart(2, '0')}`;
  return id;
}

function t0(s: ShapeData) {
  return (s.kind === 'box' || s.kind === 'extrude') && taperOf(s) === 0;
}
