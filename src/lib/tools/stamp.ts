import * as THREE from 'three';
import type { Engine } from '$lib/engine/Engine';
import type { StampElement } from '$lib/model/types';
import { buildElement } from '$lib/engine/objects';
import { COLORS } from '$lib/engine/materials';
import { worldBounds } from '$lib/model/space';
import type { PEvent, Tool } from './types';

export class StampTool implements Tool {
  engine: Engine;
  ghost = new THREE.Group();
  yaw = 0;
  current: StampElement | null = null;
  private ghostKey = '';

  constructor(engine: Engine) {
    this.engine = engine;
    engine.overlay.add(this.ghost);
  }
  get ed() {
    return this.engine.editor;
  }
  deactivate() {
    this.ghost.clear();
    this.ghostKey = '';
    this.current = null;
  }

  private place(e: PEvent): StampElement | null {
    const ed = this.ed;
    const def = ed.project.stamps[ed.stamp];
    if (!def) return null;
    const step = ed.snapStep;
    const hit = this.engine.pickSolid(e.x, e.y);
    let pos: THREE.Vector3, yaw = this.yaw, depth = 0.3;
    if (hit && def.surface && Math.abs(hit.normal.y) < 0.3) {
      const n = hit.normal.clone().setY(0).normalize();
      yaw = (Math.atan2(n.x, n.z) * 180) / Math.PI;
      // slide along the wall on the grid, sit on the floor under it
      const u = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 1, 0));
      const along = hit.point.dot(u);
      const snapped = e.mod ? along : Math.round(along / (step / 2)) * (step / 2);
      pos = hit.point.clone().addScaledVector(u, snapped - along);
      const wall = hit.id ? ed.get(hit.id) : null;
      const bottom = wall ? worldBounds(wall, ed.project).min.y : ed.planeY;
      const floors = [ed.planeY, bottom, ...ed.level.storeys.map((s) => s.y)].filter((y) => y <= hit.point.y + 1e-3);
      pos.y = Math.max(...floors);
      depth = this.thickness(hit.object as THREE.Mesh, hit.point, n);
    } else {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(hit && hit.normal.y > 0.9 ? hit.point.y : ed.planeY));
      const p = this.engine.planeHit(e.x, e.y, plane);
      if (!p) return null;
      pos = e.mod ? p : new THREE.Vector3(Math.round(p.x / step) * step, p.y, Math.round(p.z / step) * step);
    }
    const el: StampElement = {
      id: '',
      type: 'stamp',
      stamp: ed.stamp,
      tags: [],
      role: 'solid',
      depth: Math.round(depth * 1000) / 1000,
      transform: { position: [r3(pos.x), r3(pos.y), r3(pos.z)], rotation: [0, Math.round(yaw * 1000) / 1000, 0] },
      props: {},
      notes: '',
      precision: 'exact'
    };
    return el;
  }

  private thickness(mesh: THREE.Mesh, p: THREE.Vector3, n: THREE.Vector3) {
    const bvh = (mesh.geometry as any).boundsTree;
    const inv = mesh.matrixWorld.clone().invert();
    const origin = p.clone().addScaledVector(n, -0.005).applyMatrix4(inv);
    const dir = n.clone().negate().transformDirection(inv);
    const ray = new THREE.Ray(origin, dir);
    const hit = bvh ? bvh.raycastFirst(ray, THREE.DoubleSide) : null;
    if (hit) {
      const wp = hit.point.clone().applyMatrix4(mesh.matrixWorld);
      return Math.min(3, wp.distanceTo(p));
    }
    return this.ed.project.defaults.wall;
  }

  hover(e: PEvent) {
    const el = this.place(e);
    this.current = el;
    if (!el) {
      this.ghost.visible = false;
      return;
    }
    const k = JSON.stringify(el);
    if (k !== this.ghostKey) {
      this.ghost.clear();
      const b = buildElement(el, this.ed.project, { ghost: COLORS.accent, labels: false });
      this.ghost.add(b.root);
      this.ghostKey = k;
    }
    this.ghost.visible = true;
    const def = this.ed.project.stamps[this.ed.stamp];
    this.ed.hint = `${def?.name ?? this.ed.stamp}: ${def?.surface ? 'hover a wall and click' : 'click to place'} · , . rotate · pick another stamp in the toolbar`;
    this.engine.invalidate();
  }

  down(e: PEvent) {
    const el = this.place(e);
    if (!el) return;
    el.id = this.ed.newId(el);
    this.ed.add([el], true);
    this.ed.toast(`Stamped ${this.ed.project.stamps[el.stamp]?.name ?? el.stamp}`, 'ok');
  }

  key(e: KeyboardEvent) {
    if (e.key === ',' || e.key === '.') {
      this.yaw += (e.key === ',' ? 1 : -1) * (e.shiftKey ? 90 : 15);
      this.ghostKey = '';
      return true;
    }
    return false;
  }
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;
