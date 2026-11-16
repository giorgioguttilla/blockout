import * as THREE from 'three';
import type { Engine } from '$lib/engine/Engine';
import type { LevelElement } from '$lib/model/types';
import { localBounds, matrixOf } from '$lib/model/space';
import { centroid2, footprint, shapeHeight, taperOf } from '$lib/model/shapes';
import { WorkPlane } from './plane';

export type SnapKind = 'corner' | 'midpoint' | 'center';
interface SnapPt {
  p: THREE.Vector3;
  kind: SnapKind;
}
const cornerCache = new WeakMap<LevelElement, SnapPt[]>();

function corners(e: LevelElement, engine: Engine): SnapPt[] {
  let c = cornerCache.get(e);
  if (c) return c;
  const m = matrixOf(e.transform);
  const out: SnapPt[] = [];
  const add = (x: number, y: number, z: number, kind: SnapKind) => out.push({ p: new THREE.Vector3(x, y, z).applyMatrix4(m), kind });
  if (e.type === 'shape') {
    const s = e.shape;
    const ring = footprint(s);
    const h = shapeHeight(s);
    const t = taperOf(s);
    if (ring) {
      const [cx, cz] = centroid2(ring);
      const rings: [number, number][] = [[0, 1]];
      if (h > 0 && !s.infinite) rings.push([h, t]);
      for (const [y, k] of rings) {
        if (k < 1e-4) {
          add(cx, y, cz, 'corner'); // apex
          continue;
        }
        const pts = ring.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k] as [number, number]);
        const many = s.kind === 'prism' && s.smooth;
        pts.forEach(([x, z], i) => {
          if (many && i % 8) return;
          add(x, y, z, 'corner');
          if (!many) {
            const [x2, z2] = pts[(i + 1) % pts.length];
            add((x + x2) / 2, y, (z + z2) / 2, 'midpoint');
          }
        });
        add(cx, y, cz, 'center');
      }
    } else {
      const b = localBounds(e, engine.editor.project);
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) add(x, y, z, 'corner');
      add(0, b.min.y, 0, 'center');
      add(0, b.max.y, 0, 'center');
    }
  } else if (e.type === 'path') {
    for (const p of e.path.points) add(p[0], p[1], p[2], 'corner');
  } else if (e.type === 'marker' || e.type === 'note') {
    out.push({ p: new THREE.Vector3(...e.transform.position), kind: 'center' });
  }
  cornerCache.set(e, out);
  return out;
}

export interface Snapped {
  point: THREE.Vector3;
  vertex: boolean;
  kind?: SnapKind;
}

/** Snap a point on a work plane: existing corners / midpoints / centers first (within 12 px), then the grid. */
export function snapOnPlane(engine: Engine, wp: WorkPlane, raw: THREE.Vector3, x: number, y: number, mod: boolean, exclude?: Set<string>): Snapped {
  const ed = engine.editor;
  if (mod || !ed.snap) return { point: raw.clone(), vertex: false };
  let best: SnapPt | null = null;
  let bestD = 12;
  const rank = { corner: 0, center: 1, midpoint: 2 };
  for (const e of ed.level.elements) {
    if (e.hidden || (exclude && exclude.has(e.id))) continue;
    for (const c of corners(e, engine)) {
      if (Math.abs(wp.plane.distanceToPoint(c.p)) > 0.02) continue;
      const s = engine.toScreen(c.p);
      if (s.behind) continue;
      const d = Math.hypot(s.x - x, s.y - y) + rank[c.kind] * 0.5;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
  }
  if (best) return { point: best.p.clone(), vertex: true, kind: best.kind };
  return { point: wp.snap(raw, ed.snapStep), vertex: false };
}

/** Small label next to the cursor naming what it snapped to. */
export function showSnapLabel(engine: Engine, s: Snapped | null) {
  if (!s || !s.kind) return engine.label('snap', null);
  engine.label('snap', s.kind, s.point.clone().add(new THREE.Vector3(0, 0.25, 0)), 'dim snap');
}

/** Work plane under the cursor: locked plane > nearer of (surface, elevation plane). */
export function resolvePlane(engine: Engine, x: number, y: number, allowWalls = true, exclude?: Set<string>) {
  const ed = engine.editor;
  const locked = (engine.tools as any)?.locked as WorkPlane | null;
  if (locked) return { wp: locked, hit: null as ReturnType<Engine['pickSolid']> };
  const ground = WorkPlane.ground(ed.planeY);
  const hit = engine.pickSolid(x, y, exclude);
  if (hit) {
    const wp = WorkPlane.fromHit(hit.point, hit.normal);
    const gp = engine.planeHit(x, y, ground.plane);
    const camPos = engine.rig.camera.position;
    const groundNearer = gp && gp.distanceTo(camPos) < hit.point.distanceTo(camPos) - 0.01 && ed.planeY > 0.001;
    if (wp && (allowWalls || wp.normal.y > 0.5) && !groundNearer) {
      wp.sourceId = hit.id;
      return { wp, hit };
    }
  }
  return { wp: ground, hit };
}

export function planeName(engine: Engine, wp: WorkPlane) {
  if (wp.kind === 'locked') return 'Locked plane';
  if (wp.kind === 'wall') return `On ${wp.sourceId ?? 'wall'}`;
  if (wp.kind === 'slope' || wp.kind === 'face') {
    const tilt = Math.round((Math.acos(Math.min(1, Math.abs(wp.normal.y))) * 180) / Math.PI);
    return `On ${wp.sourceId ?? 'face'} · tilted ${tilt}°`;
  }
  if (wp.kind === 'top') return `On ${wp.sourceId ?? 'surface'} · ${wp.origin.y.toFixed(2)} m`;
  const st = engine.editor.level.storeys.find((s) => Math.abs(s.y - engine.editor.planeY) < 1e-3);
  return `${st ? st.name : 'Plane'} · ${engine.editor.planeY.toFixed(2)} m`;
}
