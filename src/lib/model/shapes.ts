import type { Character, ShapeData, Vec2 } from './types';

/** Regular polygon in local XZ, first corner on local +X, counter-clockwise (x→z). */
export function prismPoints(sides: number, radius: number): Vec2[] {
  const n = Math.max(3, Math.round(sides));
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [Math.cos(a) * radius, Math.sin(a) * radius] as Vec2;
  });
}

export const innerRadius = (outer: number, sides: number) => outer * Math.cos(Math.PI / Math.max(3, sides));
export const outerFromInner = (inner: number, sides: number) => inner / Math.cos(Math.PI / Math.max(3, sides));

const NAMES: Record<number, [string, string]> = {
  3: ['triangle', 'triangular'],
  4: ['square', 'square'],
  5: ['pentagon', 'pentagonal'],
  6: ['hexagon', 'hexagonal'],
  7: ['heptagon', 'heptagonal'],
  8: ['octagon', 'octagonal'],
  9: ['nonagon', 'nonagonal'],
  10: ['decagon', 'decagonal'],
  11: ['hendecagon', 'hendecagonal'],
  12: ['dodecagon', 'dodecagonal'],
  13: ['tridecagon', 'tridecagonal'],
  14: ['tetradecagon', 'tetradecagonal'],
  15: ['pentadecagon', 'pentadecagonal'],
  16: ['hexadecagon', 'hexadecagonal']
};
export function polygonName(sides: number, adjective = false) {
  const n = Math.round(sides);
  const e = NAMES[n];
  return e ? e[adjective ? 1 : 0] : `${n}-gon${adjective ? 'al' : ''}`;
}

export const SMOOTH_SIDES = 32;
export const taperOf = (s: ShapeData) => (s.taper == null ? 1 : Math.max(0, Math.min(1, s.taper)));

/** Plain-language shape name for briefs and the inspector. */
export function shapeName(s: ShapeData): string {
  const t = taperOf(s);
  const hollow = s.hollow ? ' (hollow room)' : '';
  switch (s.kind) {
    case 'prism': {
      if (s.smooth) return (t === 0 ? 'cone' : t < 1 ? 'conical frustum' : 'cylinder') + hollow;
      const adj = polygonName(s.sides ?? 6, true);
      return (t === 0 ? `${adj} pyramid` : t < 1 ? `${adj} frustum` : `${adj} prism`) + hollow;
    }
    case 'box':
      return (t === 0 ? 'rectangular pyramid' : t < 1 ? 'rectangular frustum' : 'box') + hollow;
    case 'extrude':
      return (t === 0 ? 'polygon pyramid' : t < 1 ? 'tapered polygon' : 'polygon extrusion') + hollow;
    case 'cylinder':
      return 'elliptic cylinder';
    default:
      return s.kind;
  }
}

/** Footprint polygon (bottom ring) in local XZ, when the shape has one. */
export function footprint(s: ShapeData): Vec2[] | null {
  if (s.kind === 'extrude') return s.points ?? null;
  if (s.kind === 'prism') return prismPoints(s.smooth ? SMOOTH_SIDES : s.sides ?? 6, s.radius ?? 1);
  if (s.kind === 'box' || s.kind === 'ramp' || s.kind === 'stairs') {
    const [x, , z] = s.size ?? [1, 1, 1];
    return [[-x / 2, -z / 2], [x / 2, -z / 2], [x / 2, z / 2], [-x / 2, z / 2]];
  }
  return null;
}

export function shapeHeight(s: ShapeData): number {
  if (s.kind === 'extrude' || s.kind === 'prism') return s.height ?? 0;
  return s.size?.[1] ?? 0;
}

export function centroid2(pts: Vec2[]): Vec2 {
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
}

export function defaultSteps(h: number, stepHeight = 0.3) {
  return Math.max(2, Math.round(h / Math.min(0.3, stepHeight)));
}

export interface SlopeInfo {
  rise: number;
  run: number;
  angle: number; // degrees
  steps?: number;
  stepRise?: number;
  stepRun?: number;
  walkable: boolean;
  verdict: string;
}

/** Can the character walk up this ramp / these stairs? */
export function slopeInfo(s: ShapeData, c: Character): SlopeInfo | null {
  if ((s.kind !== 'ramp' && s.kind !== 'stairs') || !s.size) return null;
  const [, rise, run] = s.size;
  const angle = (Math.atan2(rise, run) * 180) / Math.PI;
  if (s.kind === 'ramp') {
    const walkable = angle <= c.maxSlope + 1e-6;
    return { rise, run, angle, walkable, verdict: walkable ? `${angle.toFixed(0)}° ✓ walkable` : `${angle.toFixed(0)}° ✗ too steep (max ${c.maxSlope}°)` };
  }
  const steps = s.steps ?? defaultSteps(rise, c.stepHeight);
  const stepRise = rise / steps, stepRun = run / steps;
  let walkable = stepRise <= c.stepHeight + 1e-6;
  let verdict = walkable ? `${steps} steps · ${stepRise.toFixed(2)} m rise ✓` : `${steps} steps · ${stepRise.toFixed(2)} m rise ✗ taller than step height ${c.stepHeight} m`;
  if (walkable && stepRun < c.radius * 0.7) {
    walkable = false;
    verdict = `${steps} steps · ${stepRun.toFixed(2)} m deep ✗ too shallow to stand on`;
  }
  return { rise, run, angle, steps, stepRise, stepRun, walkable, verdict };
}
