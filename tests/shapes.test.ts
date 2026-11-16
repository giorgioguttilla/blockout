import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { innerRadius, outerFromInner, polygonName, prismPoints, shapeName, slopeInfo } from '../src/lib/model/shapes';
import { loft, shapeGeometry } from '../src/lib/engine/geometry';
import { defaultProject } from '../src/lib/model/defaults';

/** signed volume via the divergence theorem: positive only if every face points outward */
function volume(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let v = 0;
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    v += a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
  }
  return v;
}

describe('regular polygons', () => {
  it('puts the first corner on +X and knows its radii', () => {
    const pts = prismPoints(6, 2);
    expect(pts[0][0]).toBeCloseTo(2);
    expect(pts[0][1]).toBeCloseTo(0);
    expect(innerRadius(2, 6)).toBeCloseTo(Math.sqrt(3));
    expect(outerFromInner(innerRadius(2, 6), 6)).toBeCloseTo(2);
    expect(polygonName(6)).toBe('hexagon');
    expect(polygonName(16)).toBe('hexadecagon');
  });
  it('names shapes the way a builder would', () => {
    expect(shapeName({ kind: 'prism', sides: 6, radius: 1, height: 1 })).toBe('hexagonal prism');
    expect(shapeName({ kind: 'prism', sides: 4, radius: 1, height: 1, taper: 0 })).toBe('square pyramid');
    expect(shapeName({ kind: 'prism', sides: 32, radius: 1, height: 1, smooth: true, taper: 0 })).toBe('cone');
    expect(shapeName({ kind: 'prism', sides: 8, radius: 1, height: 1, taper: 0.5 })).toBe('octagonal frustum');
  });
});

describe('loft geometry (closed, outward-facing)', () => {
  const square: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  it('prism volume = base area × height', () => {
    expect(volume(loft(square, 3, 1))).toBeCloseTo(12, 4);
    expect(volume(loft([...square].reverse() as any, 3, 1))).toBeCloseTo(12, 4); // winding-independent
  });
  it('pyramid volume = base area × height / 3', () => {
    expect(volume(loft(square, 3, 0))).toBeCloseTo(4, 4);
  });
  it('frustum volume matches the formula', () => {
    // V = h/3 (A1 + A2 + sqrt(A1 A2)), top scaled by 0.5 → A2 = A1 / 4
    const A1 = 4, A2 = 1;
    expect(volume(loft(square, 3, 0.5))).toBeCloseTo((3 / 3) * (A1 + A2 + Math.sqrt(A1 * A2)), 4);
  });
  it('cone from the shape data', () => {
    const g = shapeGeometry({ kind: 'prism', sides: 32, smooth: true, radius: 1, height: 3, taper: 0 });
    const exact = (Math.PI * 1 * 3) / 3;
    expect(volume(g)).toBeGreaterThan(exact * 0.98);
    expect(volume(g)).toBeLessThan(exact);
  });
});

describe('ramps and stairs vs the character', () => {
  const c = defaultProject().character;
  it('flags slopes steeper than max slope', () => {
    expect(slopeInfo({ kind: 'ramp', size: [2, 1, 4] }, c)!.walkable).toBe(true);
    expect(slopeInfo({ kind: 'ramp', size: [2, 3, 2] }, c)!.walkable).toBe(false);
  });
  it('flags steps taller than the step height', () => {
    expect(slopeInfo({ kind: 'stairs', size: [2, 1.5, 3] }, c)!.walkable).toBe(true);
    expect(slopeInfo({ kind: 'stairs', size: [2, 1.5, 3], steps: 2 }, c)!.walkable).toBe(false);
  });
});
