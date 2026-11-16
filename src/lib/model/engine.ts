import type { Vec3 } from './types';

/**
 * How a target engine lays out space. Blockout stores everything in its own convention
 * (meters, up = +Y, forward = +Z, right = -X; right-handed). An EngineConvention describes the
 * engine's axes *semantically*: which engine axis points up, which way a character/object faces at
 * rotation 0 (forward), and which way its right hand points. Units and handedness follow from that.
 */
export type Axis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
export const AXES: Axis[] = ['+x', '-x', '+y', '-y', '+z', '-z'];

export interface EngineConvention {
  /** free text: "Unity", "My custom engine"… */
  name: string;
  /** engine units in one meter (100 = centimeters) */
  unitsPerMeter: number;
  up: Axis;
  forward: Axis;
  right: Axis;
  angles: 'degrees' | 'radians';
}

export const BLOCKOUT_CONVENTION: EngineConvention = { name: 'Blockout', unitsPerMeter: 1, up: '+y', forward: '+z', right: '-x', angles: 'degrees' };

export const ENGINE_PRESETS: Record<string, EngineConvention> = {
  unity: { name: 'Unity', unitsPerMeter: 1, up: '+y', forward: '+z', right: '+x', angles: 'degrees' },
  unreal: { name: 'Unreal', unitsPerMeter: 100, up: '+z', forward: '+x', right: '+y', angles: 'degrees' },
  godot: { name: 'Godot', unitsPerMeter: 1, up: '+y', forward: '-z', right: '+x', angles: 'degrees' },
  three: { name: 'three.js', unitsPerMeter: 1, up: '+y', forward: '+z', right: '-x', angles: 'degrees' },
  blender: { name: 'Blender', unitsPerMeter: 1, up: '+z', forward: '-y', right: '-x', angles: 'degrees' },
  roblox: { name: 'Roblox', unitsPerMeter: 1 / 0.28, up: '+y', forward: '-z', right: '+x', angles: 'degrees' }
};

export function presetKey(name: string): string | null {
  const k = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (k === 'threejs' || k === 'three') return 'three';
  if (k === 'unrealengine' || k === 'ue' || k === 'ue5' || k === 'ue4') return 'unreal';
  return ENGINE_PRESETS[k] ? k : null;
}

export function sameConvention(a: EngineConvention, b: EngineConvention) {
  return a.up === b.up && a.forward === b.forward && a.right === b.right && Math.abs(a.unitsPerMeter - b.unitsPerMeter) < 1e-6 && a.angles === b.angles;
}

/** null when valid, otherwise a human-readable problem */
export function conventionProblem(c: EngineConvention): string | null {
  const letters = [c.up, c.forward, c.right].map((a) => a[1]);
  if (new Set(letters).size !== 3) return 'Up, forward and right must use three different axes (x, y, z).';
  if (!(c.unitsPerMeter > 0)) return 'Units per meter must be a positive number.';
  return null;
}

export function parseAxis(s: string): Axis | null {
  const m = /^\s*([+-]?)\s*([xyz])\b/i.exec(s);
  if (!m) return null;
  return ((m[1] || '+') + m[2].toLowerCase()) as Axis;
}

function unit(a: Axis): Vec3 {
  const v: Vec3 = [0, 0, 0];
  v['xyz'.indexOf(a[1])] = a[0] === '-' ? -1 : 1;
  return v;
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function det(r: Vec3, u: Vec3, f: Vec3) {
  return r[0] * (u[1] * f[2] - u[2] * f[1]) - r[1] * (u[0] * f[2] - u[2] * f[0]) + r[2] * (u[0] * f[1] - u[1] * f[0]);
}

/** left-handed when (right, up, forward) has positive orientation */
export function handedness(c: EngineConvention): 'left' | 'right' {
  return det(unit(c.right), unit(c.up), unit(c.forward)) > 0 ? 'left' : 'right';
}

/** Blockout vector → semantic components (right, up, forward) */
function semantic(v: Vec3): [number, number, number] {
  return [-v[0], v[1], v[2]];
}

/** direction (no scaling) from Blockout space into engine space */
export function toEngineDir(c: EngineConvention, v: Vec3): Vec3 {
  const [r, u, f] = semantic(v);
  const R = unit(c.right), U = unit(c.up), F = unit(c.forward);
  return [r * R[0] + u * U[0] + f * F[0], r * R[1] + u * U[1] + f * F[1], r * R[2] + u * U[2] + f * F[2]];
}

export function toEnginePos(c: EngineConvention, v: Vec3): Vec3 {
  const d = toEngineDir(c, v);
  return [d[0] * c.unitsPerMeter, d[1] * c.unitsPerMeter, d[2] * c.unitsPerMeter];
}

/** a Blockout local size [x, y, z] expressed along the engine's local axes (unsigned) */
export function toEngineSize(c: EngineConvention, s: Vec3): Vec3 {
  const d = toEngineDir(c, s);
  return [Math.abs(d[0]) * c.unitsPerMeter, Math.abs(d[1]) * c.unitsPerMeter, Math.abs(d[2]) * c.unitsPerMeter];
}

/**
 * Engine yaw for a facing direction given in Blockout space: rotation about the engine's up axis,
 * measured from the engine's forward, with the sign the engine's handedness gives a positive rotation
 * (left-handed: positive turns toward right; right-handed: positive turns toward left).
 */
export function engineYaw(c: EngineConvention, dir: Vec3): number {
  const [r, , f] = semantic(dir);
  const turnRight = Math.atan2(r, f);
  const a = (handedness(c) === 'left' ? 1 : -1) * turnRight;
  return c.angles === 'radians' ? a : (a * 180) / Math.PI;
}

export function fmtAngle(c: EngineConvention, a: number) {
  if (c.angles === 'radians') return `${Math.round(a * 1000) / 1000} rad`;
  let d = Math.round(a * 10) / 10;
  if (Object.is(d, -0)) d = 0;
  return `${d}°`;
}

/** Markdown paragraph explaining the conversion, for briefs and docs */
export function describeConvention(c: EngineConvention): string[] {
  const h = handedness(c);
  const u = c.unitsPerMeter;
  const unitText = u === 1 ? 'meters' : u === 100 ? 'centimeters (×100)' : `${Math.round(u * 1000) / 1000} units per meter`;
  return [
    `Target: **${c.name}** — ${h}-handed, up = ${c.up}, forward = ${c.forward}, right = ${c.right}, ${unitText}, angles in ${c.angles}.`,
    `Every element below also lists its values already converted to ${c.name} (\`in ${c.name}:\`). Conversion from Blockout (up +y, forward +z, right −x, meters):`,
    `engine = (−x)·right + y·up + z·forward, × ${Math.round(u * 1000) / 1000}. Yaw is about ${c.up}, measured from ${c.forward}; positive turns toward ${h === 'left' ? 'the right' : 'the left'} (${h}-hand rule).`
  ];
}

export function engineConventionFromLegacy(name: string | undefined): EngineConvention {
  const k = name ? presetKey(name) : null;
  return { ...(k ? ENGINE_PRESETS[k] : ENGINE_PRESETS.unity) };
}
