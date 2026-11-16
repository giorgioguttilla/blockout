import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import type { PathData, ShapeData, Vec2 } from '$lib/model/types';
import { centroid2, defaultSteps, prismPoints, SMOOTH_SIDES, taperOf } from '$lib/model/shapes';
export { defaultSteps };

export const INFINITE_HEIGHT = 60;

export function polygonArea(pts: Vec2[]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

/** Offset a simple polygon inward by d (miter joins, clamped). */
export function offsetPolygon(pts: Vec2[], d: number): Vec2[] {
  const n = pts.length;
  const sign = polygonArea(pts) > 0 ? 1 : -1; // + = counter-clockwise in x/z
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const e1 = norm([p1[0] - p0[0], p1[1] - p0[1]]);
    const e2 = norm([p2[0] - p1[0], p2[1] - p1[1]]);
    // inward normals
    const n1: Vec2 = [-e1[1] * sign, e1[0] * sign];
    const n2: Vec2 = [-e2[1] * sign, e2[0] * sign];
    const bis = norm([n1[0] + n2[0], n1[1] + n2[1]]);
    const cos = bis[0] * n1[0] + bis[1] * n1[1];
    const len = d / Math.max(0.25, cos);
    out.push([p1[0] + bis[0] * len, p1[1] + bis[1] * len]);
  }
  return out;
}
function norm(v: Vec2): Vec2 {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

function shapeFrom(pts: Vec2[]) {
  // shape lives in XY; after rotateX(-90°) (x, y) → (x, -y) in XZ, so negate z
  return new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], -p[1])));
}

function prism(pts: Vec2[], y0: number, y1: number) {
  const g = new THREE.ExtrudeGeometry(shapeFrom(pts), { depth: Math.max(0.001, y1 - y0), bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return clean(g);
}

function clean(g: THREE.BufferGeometry) {
  // keep only position + normal so everything can be merged / CSG'd together
  const out = new THREE.BufferGeometry();
  const ng = g.index ? g.toNonIndexed() : g;
  out.setAttribute('position', ng.getAttribute('position'));
  if (!ng.getAttribute('normal')) ng.computeVertexNormals();
  out.setAttribute('normal', ng.getAttribute('normal'));
  return out;
}

export function rectPoints(w: number, d: number): Vec2[] {
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
}

function ramp(w: number, h: number, d: number) {
  const x = w / 2, z = d / 2;
  const v = {
    a: [-x, 0, -z], b: [x, 0, -z], c: [x, 0, z], d: [-x, 0, z],
    e: [-x, h, z], f: [x, h, z]
  } as Record<string, number[]>;
  const tris = [
    ['a', 'c', 'b'], ['a', 'd', 'c'], // bottom
    ['d', 'f', 'c'], ['d', 'e', 'f'], // back (vertical, +z)
    ['a', 'b', 'f'], ['a', 'f', 'e'], // slope
    ['a', 'e', 'd'], // left
    ['b', 'c', 'f'] // right
  ];
  const pos: number[] = [];
  for (const t of tris) for (const k of [...t].reverse()) pos.push(...v[k]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function stairs(w: number, h: number, d: number, steps: number) {
  const n = Math.max(1, Math.round(steps));
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const sh = (h * (i + 1)) / n;
    const z0 = -d / 2 + (d * i) / n;
    const depth = d - (d * i) / n;
    const b = new THREE.BoxGeometry(w, sh, depth);
    b.translate(0, sh / 2, z0 + depth / 2);
    parts.push(clean(b));
  }
  return mergeGeometries(parts)!;
}

let evaluator: Evaluator | null = null;
export function csgEvaluator() {
  if (!evaluator) {
    evaluator = new Evaluator();
    evaluator.attributes = ['position', 'normal'];
    evaluator.useGroups = false;
  }
  return evaluator;
}

export function subtract(base: THREE.BufferGeometry, cutters: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[]) {
  const ev = csgEvaluator();
  let a = new Brush(base);
  a.updateMatrixWorld();
  for (const c of cutters) {
    const b = new Brush(c.geometry);
    b.applyMatrix4(c.matrix);
    b.updateMatrixWorld();
    a = ev.evaluate(a, b, SUBTRACTION) as Brush;
  }
  return a.geometry;
}

/**
 * Closed solid from a footprint polygon (local XZ) lifted to height h, with the top ring scaled by
 * `taper` about the footprint center (1 = prism, 0 = pyramid / cone). Flat-shaded, outward normals.
 */
export function loft(pts: Vec2[], h: number, taper = 1): THREE.BufferGeometry {
  const ring = polygonArea(pts) >= 0 ? pts : [...pts].reverse(); // counter-clockwise in (x, z)
  const [cx, cz] = centroid2(ring);
  const n = ring.length;
  const bot = ring.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const top = ring.map(([x, z]) => new THREE.Vector3(cx + (x - cx) * taper, h, cz + (z - cz) * taper));
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, want: THREE.Vector3) => {
    const nrm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (nrm.lengthSq() < 1e-14) return;
    if (nrm.dot(want) < 0) [b, c] = [c, b];
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = ring[j][0] - ring[i][0], ez = ring[j][1] - ring[i][1];
    const out = new THREE.Vector3(ez, 0, -ex); // outward for a counter-clockwise ring
    tri(bot[i], bot[j], top[j], out);
    if (taper > 1e-4) tri(bot[i], top[j], top[i], out);
  }
  const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  const down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);
  for (const [a, b, c] of faces) {
    tri(bot[a], bot[b], bot[c], down);
    if (taper > 1e-4) tri(top[a], top[b], top[c], up);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Local-space geometry for a shape. Bottom at y=0 (or the footprint plane). */
export function shapeGeometry(s: ShapeData, opts: { stepHeight?: number } = {}): THREE.BufferGeometry {
  const kind = s.kind;
  if (kind === 'extrude') {
    const pts = s.points ?? rectPoints(1, 1);
    const h = s.infinite ? INFINITE_HEIGHT : (s.height ?? 0);
    if (h <= 0.001) {
      const g = new THREE.ShapeGeometry(shapeFrom(pts));
      g.rotateX(-Math.PI / 2);
      return clean(g);
    }
    if (s.hollow) return hollowGeometry(pts, h, s.hollow);
    if (taperOf(s) < 1) return loft(pts, h, taperOf(s));
    return prism(pts, 0, h);
  }
  if (kind === 'prism') {
    const pts = prismPoints(s.smooth ? SMOOTH_SIDES : s.sides ?? 6, s.radius ?? 1);
    const h = s.infinite ? INFINITE_HEIGHT : (s.height ?? 0);
    if (h <= 0.001) {
      const g = new THREE.ShapeGeometry(shapeFrom(pts));
      g.rotateX(-Math.PI / 2);
      return clean(g);
    }
    if (s.hollow) return hollowGeometry(pts, h, s.hollow);
    return loft(pts, h, taperOf(s));
  }
  const [x, y0, z] = s.size ?? [1, 1, 1];
  const y = s.infinite ? INFINITE_HEIGHT : y0;
  if (y <= 0.001 && kind === 'box') {
    const g = new THREE.PlaneGeometry(x, z);
    g.rotateX(-Math.PI / 2);
    return clean(g);
  }
  switch (kind) {
    case 'box': {
      if (s.hollow) return hollowGeometry(rectPoints(x, z), y, s.hollow);
      if (taperOf(s) < 1) return loft(rectPoints(x, z), y, taperOf(s));
      const g = new THREE.BoxGeometry(x, Math.max(y, 0.001), z);
      g.translate(0, y / 2, 0);
      return clean(g);
    }
    case 'cylinder': {
      const g = new THREE.CylinderGeometry(0.5, 0.5, 1, Math.max(3, s.sides ?? 24));
      g.scale(x, Math.max(y, 0.001), z);
      g.translate(0, y / 2, 0);
      return clean(g);
    }
    case 'ramp':
      return ramp(x, Math.max(y, 0.001), z);
    case 'stairs':
      return stairs(x, Math.max(y, 0.001), z, s.steps ?? defaultSteps(y, opts.stepHeight));
    case 'blob': {
      const g = new THREE.SphereGeometry(0.5, 28, 18);
      g.scale(x, Math.max(y, 0.001), z);
      g.translate(0, y / 2, 0);
      return clean(g);
    }
  }
  return clean(new THREE.BoxGeometry(1, 1, 1));
}

function hollowGeometry(pts: Vec2[], h: number, hollow: NonNullable<ShapeData['hollow']>) {
  const outer = prism(pts, 0, h);
  const t = Math.max(0.05, hollow.wall);
  const inner = offsetPolygon(pts, t);
  const y0 = hollow.floor ? t : -0.05;
  const y1 = hollow.ceiling ? h - t : h + 0.05;
  if (y1 - y0 <= 0.01) return outer;
  try {
    return subtract(outer, [{ geometry: prism(inner, y0, y1), matrix: new THREE.Matrix4() }]);
  } catch {
    return outer;
  }
}

// ------------------------------------------------------------------ paths

export function pathCurvePoints(p: PathData): THREE.Vector3[] {
  const pts = p.points.map((q) => new THREE.Vector3(...q));
  if (pts.length < 2) return pts;
  if (!p.smooth || pts.length < 3) {
    // polyline, densified
    const out: THREE.Vector3[] = [];
    const list = p.closed ? [...pts, pts[0]] : pts;
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      const n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.5));
      for (let k = 0; k < n; k++) out.push(a.clone().lerp(b, k / n));
    }
    out.push(list[list.length - 1].clone());
    return out;
  }
  const curve = new THREE.CatmullRomCurve3(pts, p.closed, 'centripetal');
  const n = Math.max(8, Math.ceil(curve.getLength() / 0.4));
  return curve.getSpacedPoints(n);
}

export function ribbonGeometry(p: PathData, lift = 0.04) {
  const pts = pathCurvePoints(p);
  const w = p.width / 2;
  const pos: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const left: THREE.Vector3[] = [], right: THREE.Vector3[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const tan = b.clone().sub(a).setY(0).normalize();
    if (tan.lengthSq() < 1e-6) tan.set(1, 0, 0);
    const side = new THREE.Vector3().crossVectors(up, tan).normalize().multiplyScalar(w);
    left.push(pts[i].clone().add(side).setY(pts[i].y + lift));
    right.push(pts[i].clone().sub(side).setY(pts[i].y + lift));
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const l0 = left[i], l1 = left[i + 1], r0 = right[i], r1 = right[i + 1];
    pos.push(l0.x, l0.y, l0.z, r0.x, r0.y, r0.z, l1.x, l1.y, l1.z);
    pos.push(r0.x, r0.y, r0.z, r1.x, r1.y, r1.z, l1.x, l1.y, l1.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return { geometry: g, left, right, center: pts };
}

export function arrowGeometry(len = 0.7, width = 0.5) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(width / 2, 0);
  s.lineTo(0, len);
  s.lineTo(-width / 2, 0);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  // shape Y → world +Z
  g.rotateX(Math.PI / 2);
  return g;
}

/**
 * Feature edges (creases + real borders) that survive CSG output. Booleans leave T-junctions: a long
 * edge on one triangle meets two shorter collinear edges on its coplanar neighbour, so neither looks
 * "shared" and a naive edge pass draws lines across flat faces. Here unshared edges are dropped when a
 * coplanar, collinear unshared edge on the other side covers them.
 */
export function cleanEdges(g: THREE.BufferGeometry, angle = 28) {
  const src = g.index ? g.toNonIndexed() : g;
  const p = src.getAttribute('position');
  const key = (v: THREE.Vector3) => `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;
  const ids = new Map<string, number>();
  const verts: THREE.Vector3[] = [];
  const vid = (v: THREE.Vector3) => {
    const k = key(v);
    let i = ids.get(k);
    if (i == null) {
      i = verts.length;
      verts.push(v.clone());
      ids.set(k, i);
    }
    return i;
  };
  const edges = new Map<string, { a: number; b: number; normals: THREE.Vector3[] }>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < p.count; t += 3) {
    a.fromBufferAttribute(p, t);
    b.fromBufferAttribute(p, t + 1);
    c.fromBufferAttribute(p, t + 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    const tri = [vid(a), vid(b), vid(c)];
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
    for (let k = 0; k < 3; k++) {
      const i = tri[k], j = tri[(k + 1) % 3];
      const ek = i < j ? `${i}_${j}` : `${j}_${i}`;
      let e = edges.get(ek);
      if (!e) edges.set(ek, (e = { a: i, b: j, normals: [] }));
      e.normals.push(n);
    }
  }
  const cos = Math.cos((angle * Math.PI) / 180);
  const out: number[] = [];
  const open: { a: THREE.Vector3; b: THREE.Vector3; n: THREE.Vector3 }[] = [];
  for (const e of edges.values()) {
    if (e.normals.length === 1) open.push({ a: verts[e.a], b: verts[e.b], n: e.normals[0] });
    else if (e.normals.length > 2 || e.normals[0].dot(e.normals[1]) < cos) {
      const A = verts[e.a], B = verts[e.b];
      out.push(A.x, A.y, A.z, B.x, B.y, B.z);
    }
  }
  // unshared edges: keep only real borders / creases, not T-junction seams inside flat faces
  const covered = (mid: THREE.Vector3, self: (typeof open)[number]) => {
    const dir = new THREE.Vector3().subVectors(self.b, self.a).normalize();
    for (const o of open) {
      if (o === self || o.n.dot(self.n) < 0.999) continue;
      const od = new THREE.Vector3().subVectors(o.b, o.a);
      const len = od.length();
      if (len < 1e-9) continue;
      od.divideScalar(len);
      if (Math.abs(Math.abs(od.dot(dir)) - 1) > 1e-5) continue;
      const tt = new THREE.Vector3().subVectors(mid, o.a).dot(od);
      if (tt <= 1e-6 || tt >= len - 1e-6) continue;
      const closest = o.a.clone().addScaledVector(od, tt);
      if (closest.distanceToSquared(mid) < 1e-6) return true;
    }
    return false;
  };
  for (const e of open) {
    const mid = e.a.clone().add(e.b).multiplyScalar(0.5);
    if (covered(mid, e)) continue;
    out.push(e.a.x, e.a.y, e.a.z, e.b.x, e.b.y, e.b.z);
  }
  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return lines;
}
