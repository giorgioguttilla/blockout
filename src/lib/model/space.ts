import * as THREE from 'three';
import type { LevelElement, Level, Project, StampElement, Transform, Vec3 } from './types';
import { footprint } from './shapes';

const D2R = Math.PI / 180;

export function eulerOf(rot: Vec3) {
  return new THREE.Euler(rot[0] * D2R, rot[1] * D2R, rot[2] * D2R, 'YXZ');
}
export function quatOf(rot: Vec3) {
  return new THREE.Quaternion().setFromEuler(eulerOf(rot));
}
export function matrixOf(t: Transform) {
  return new THREE.Matrix4().compose(new THREE.Vector3(...t.position), quatOf(t.rotation), new THREE.Vector3(1, 1, 1));
}
export function transformFromMatrix(m: THREE.Matrix4): Transform {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(p, q, s);
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  return { position: [p.x, p.y, p.z], rotation: [e.x / D2R, e.y / D2R, e.z / D2R] };
}

/** Replace stamp instances with their parts in world space. Part ids are `instance/part`. */
export function expandStamp(inst: StampElement, project: Project): LevelElement[] {
  const def = project.stamps[inst.stamp];
  if (!def) return [];
  const m = matrixOf(inst.transform);
  const depth = inst.depth ?? 0.3;
  return def.elements.map((child) => {
    const c: any = structuredClone(child);
    let local = c.transform ?? { position: [0, 0, 0], rotation: [0, 0, 0] };
    if (c.type === 'shape' && c.shape?.fit === 'depth' && c.shape.size) {
      c.shape.size = [c.shape.size[0], c.shape.size[1], depth + 0.2];
      local = { position: [local.position[0], local.position[1], -depth / 2], rotation: local.rotation };
    }
    const wm = m.clone().multiply(matrixOf(local));
    c.transform = transformFromMatrix(wm);
    c.id = `${inst.id}/${child.id}`;
    c.props = { ...(child.props ?? {}), ...(inst.props ?? {}) };
    c.tags = [...(child.tags ?? []), ...inst.tags.filter((t) => !(child.tags ?? []).includes(t))];
    c.hidden = inst.hidden;
    c.precision = inst.precision;
    c.notes = c.notes || inst.notes;
    c.__stamp = inst.id;
    return c as LevelElement;
  });
}

export function flatten(level: Level, project: Project): LevelElement[] {
  const out: LevelElement[] = [];
  for (const e of level.elements) {
    if (e.type === 'stamp') out.push(...expandStamp(e, project));
    else out.push(e);
  }
  return out;
}

export function proxySize(e: LevelElement, project?: Project): Vec3 {
  for (const t of e.tags) {
    const p = project?.tags[t]?.proxy;
    if (p) {
      const h = typeof e.props?.height === 'number' && t === 'ladder' ? (e.props.height as number) : p[1];
      return [p[0], h, p[2]];
    }
  }
  return [0.5, 0.5, 0.5];
}

export function localBounds(e: LevelElement, project?: Project): THREE.Box3 {
  const b = new THREE.Box3();
  if (e.type === 'shape') {
    const s = e.shape;
    if (s.kind === 'prism') {
      for (const p of footprint(s) ?? []) b.expandByPoint(new THREE.Vector3(p[0], 0, p[1]));
      b.max.y = Math.max(s.infinite ? 60 : s.height ?? 0, 0.02);
    } else if (s.kind === 'extrude') {
      for (const p of s.points ?? []) b.expandByPoint(new THREE.Vector3(p[0], 0, p[1]));
      b.max.y = Math.max(s.height ?? 0, 0.02);
    } else {
      const [x, y, z] = s.size ?? [1, 1, 1];
      b.set(new THREE.Vector3(-x / 2, 0, -z / 2), new THREE.Vector3(x / 2, Math.max(y, 0.02), z / 2));
    }
  } else if (e.type === 'path') {
    const w = e.path.width / 2;
    for (const p of e.path.points) b.expandByPoint(new THREE.Vector3(...p));
    b.expandByVector(new THREE.Vector3(w, 0.05, w));
  } else if (e.type === 'marker') {
    const [x, y, z] = proxySize(e, project);
    const r = e.marker.radius;
    b.set(new THREE.Vector3(-Math.max(x / 2, r), 0, -Math.max(z / 2, r)), new THREE.Vector3(Math.max(x / 2, r), y, Math.max(z / 2, r)));
  } else {
    b.set(new THREE.Vector3(-0.3, 0, -0.3), new THREE.Vector3(0.3, 0.6, 0.3));
  }
  return b;
}

export function worldBounds(e: LevelElement, project?: Project): THREE.Box3 {
  if (e.type === 'stamp' && project) {
    const b = new THREE.Box3();
    for (const c of expandStamp(e, project)) b.union(worldBounds(c, project));
    if (b.isEmpty()) b.setFromCenterAndSize(new THREE.Vector3(...e.transform.position), new THREE.Vector3(1, 1, 1));
    return b;
  }
  return localBounds(e, project).applyMatrix4(matrixOf(e.transform));
}

export function forwardOf(e: LevelElement) {
  return new THREE.Vector3(0, 0, 1).applyQuaternion(quatOf(e.transform.rotation));
}

export function compass(v: THREE.Vector3) {
  const yaw = (Math.atan2(v.x, v.z) * 180) / Math.PI;
  const dirs = ['+Z', '+Z/+X', '+X', '+X/-Z', '-Z', '-Z/-X', '-X', '-X/+Z'];
  const i = Math.round(((yaw + 360) % 360) / 45) % 8;
  return dirs[i];
}
