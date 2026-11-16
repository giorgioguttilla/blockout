import * as THREE from 'three';
import type { Vec3 } from '$lib/model/types';

const UP = new THREE.Vector3(0, 1, 0);

/** The "sheet of paper" you draw on. Local frame: X = u, Y = normal, Z = v. */
export class WorkPlane {
  origin: THREE.Vector3;
  normal: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  plane: THREE.Plane;
  kind: 'ground' | 'top' | 'wall' | 'slope' | 'face' | 'locked';
  sourceId: string | null = null;

  constructor(point: THREE.Vector3, normal: THREE.Vector3, kind: WorkPlane['kind']) {
    this.normal = normal.clone().normalize();
    this.kind = kind;
    if (Math.abs(this.normal.y) > 0.999) {
      this.normal.set(0, Math.sign(this.normal.y) || 1, 0);
      this.u = new THREE.Vector3(1, 0, 0);
      this.v = new THREE.Vector3().crossVectors(this.u, this.normal); // X × Y = Z
    } else if (Math.abs(this.normal.y) > 0.5) {
      // floor-like slope: keep local X as close to world X as possible so rotations stay readable (e.g. [0, 0, -11])
      const ref = Math.abs(this.normal.x) > 0.9 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(1, 0, 0);
      this.u = ref.addScaledVector(this.normal, -this.normal.dot(ref)).normalize();
      this.v = new THREE.Vector3().crossVectors(this.u, this.normal).normalize();
    } else {
      // wall-like: v points "uphill" along the face, u runs level across it (u × n = v)
      this.v = UP.clone().addScaledVector(this.normal, -this.normal.dot(UP)).normalize();
      this.u = new THREE.Vector3().crossVectors(this.normal, this.v).normalize();
    }
    this.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.normal, point);
    // origin = projection of world origin, so the plane grid lines up with the world grid
    this.origin = this.normal.clone().multiplyScalar(-this.plane.constant);
  }

  static ground(y: number) {
    return new WorkPlane(new THREE.Vector3(0, y, 0), UP, 'ground');
  }

  /** plane from any surface hit (flat tops, walls, slopes, faces of rotated shapes) */
  static fromHit(point: THREE.Vector3, normal: THREE.Vector3): WorkPlane {
    if (normal.y > 0.999) return new WorkPlane(point, UP, 'top');
    if (Math.abs(normal.y) < 0.001) return new WorkPlane(point, new THREE.Vector3(normal.x, 0, normal.z), 'wall');
    return new WorkPlane(point, normal, normal.y > 0.2 ? 'slope' : 'face');
  }

  get horizontal() {
    return Math.abs(this.normal.y) > 0.99;
  }

  toLocal(p: THREE.Vector3): [number, number] {
    const d = p.clone().sub(this.origin);
    return [d.dot(this.u), d.dot(this.v)];
  }
  toWorld(a: number, b: number, h = 0) {
    return this.origin.clone().addScaledVector(this.u, a).addScaledVector(this.v, b).addScaledVector(this.normal, h);
  }
  snap(p: THREE.Vector3, step: number) {
    const [a, b] = this.toLocal(p);
    return this.toWorld(Math.round(a / step) * step, Math.round(b / step) * step);
  }
  /** Euler YXZ (degrees) for an element whose local frame matches this plane */
  rotation(extraYawDeg = 0): Vec3 {
    const m = new THREE.Matrix4().makeBasis(this.u, this.normal, this.v);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    if (extraYawDeg) q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, (extraYawDeg * Math.PI) / 180));
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    const r = (x: number) => Math.round(((x * 180) / Math.PI) * 1000) / 1000;
    return [r(e.x), r(e.y), r(e.z)];
  }
  same(o: WorkPlane | null) {
    return !!o && o.normal.distanceTo(this.normal) < 1e-4 && Math.abs(o.plane.constant - this.plane.constant) < 1e-4;
  }
}

export function snapValue(v: number, step: number, on: boolean) {
  return on ? Math.round(v / step) * step : Math.round(v * 1000) / 1000;
}

export function fmt(n: number, d = 2) {
  const s = n.toFixed(d);
  return s.replace(/\.?0+$/, '') || '0';
}

/** Douglas–Peucker on 2D points */
export function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts;
  const sq = (a: [number, number], b: [number, number], p: [number, number]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = dx * dx + dy * dy;
    let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0;
    t = Math.max(0, Math.min(1, t));
    const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
    return x * x + y * y;
  };
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let best = -1, bi = -1;
    for (let i = s + 1; i < e; i++) {
      const d = sq(pts[s], pts[e], pts[i]);
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (best > tol * tol) {
      keep[bi] = true;
      stack.push([s, bi], [bi, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
