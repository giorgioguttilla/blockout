import * as THREE from 'three';
import type { Engine } from '$lib/engine/Engine';
import type { MarkerElement } from '$lib/model/types';
import { buildElement } from '$lib/engine/objects';
import { CursorMark } from './cursor';
import { resolvePlane, snapOnPlane } from './snap';
import type { PEvent, Tool } from './types';

export class MarkerTool implements Tool {
  engine: Engine;
  cursor: CursorMark;
  ghost = new THREE.Group();
  press: { x: number; y: number; p: THREE.Vector3; yaw: number; aiming: boolean } | null = null;
  private ghostKey = '';

  constructor(engine: Engine) {
    this.engine = engine;
    this.cursor = new CursorMark(engine);
    engine.overlay.add(this.ghost);
  }
  get ed() {
    return this.engine.editor;
  }
  busy() {
    return !!this.press;
  }
  deactivate() {
    this.press = null;
    this.ghost.clear();
    this.ghostKey = '';
    this.cursor.update(null, null);
    this.engine.clearLabels('mk:');
  }

  private tags() {
    const pen = this.ed.currentPen;
    return pen.role === 'guide' || pen.category === 'object' || pen.category === 'actor' || pen.category === 'point' ? [...pen.tags] : [];
  }

  private defaultYaw(p: THREE.Vector3) {
    const c = this.engine.rig.camera.position;
    const yaw = (Math.atan2(c.x - p.x, c.z - p.z) * 180) / Math.PI;
    return (((Math.round(yaw / 45) * 45) % 360) + 360) % 360;
  }

  private make(p: THREE.Vector3, yaw: number): MarkerElement {
    const el: MarkerElement = {
      id: '',
      type: 'marker',
      tags: this.tags(),
      role: 'guide',
      transform: { position: [r3(p.x), r3(p.y), r3(p.z)], rotation: [0, yaw, 0] },
      marker: { radius: 0 },
      props: {},
      notes: '',
      precision: 'exact'
    };
    // default prop values from the tag definition
    for (const t of el.tags) {
      const def = this.ed.project.tags[t];
      for (const [k, pd] of Object.entries(def?.props ?? {})) if (pd.default !== undefined) el.props[k] = pd.default;
    }
    el.id = this.ed.newId(el);
    return el;
  }

  private showGhost(p: THREE.Vector3, yaw: number) {
    const key = this.tags().join() + yaw;
    if (key !== this.ghostKey) {
      this.ghost.clear();
      const b = buildElement(this.make(new THREE.Vector3(), yaw), this.ed.project, { labels: false });
      b.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.material && (m.material as THREE.Material).transparent !== undefined) {
          m.material = (m.material as THREE.Material).clone();
          (m.material as THREE.Material).transparent = true;
          (m.material as any).opacity = 0.55;
        }
        o.raycast = () => {};
      });
      b.root.matrixAutoUpdate = true;
      b.root.rotation.set(0, (yaw * Math.PI) / 180, 0);
      this.ghost.add(b.root);
      this.ghostKey = key;
    }
    this.ghost.position.copy(p);
    this.ghost.visible = true;
  }

  private pointAt(e: PEvent) {
    const { wp } = resolvePlane(this.engine, e.x, e.y, false);
    const raw = this.engine.planeHit(e.x, e.y, wp.plane);
    if (!raw) return null;
    return snapOnPlane(this.engine, wp, raw, e.x, e.y, e.mod).point;
  }

  hover(e: PEvent) {
    const p = this.pointAt(e);
    if (!p) {
      this.ghost.visible = false;
      return;
    }
    this.showGhost(p, this.defaultYaw(p));
    this.engine.updateCursor(p, {});
    const pen = this.ed.currentPen;
    this.ed.hint = `Click to place ${this.tags().length ? '#' + pen.key : 'a marker'} · drag to place and aim it`;
    this.engine.invalidate();
  }

  down(e: PEvent) {
    const p = this.pointAt(e);
    if (!p) return;
    this.press = { x: e.x, y: e.y, p, yaw: this.defaultYaw(p), aiming: false };
  }

  move(e: PEvent) {
    const pr = this.press;
    if (!pr) return this.hover(e);
    if (Math.hypot(e.x - pr.x, e.y - pr.y) > 8) pr.aiming = true;
    if (!pr.aiming) return;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), pr.p);
    const q = this.engine.planeHit(e.x, e.y, plane);
    if (!q) return;
    let yaw = (Math.atan2(q.x - pr.p.x, q.z - pr.p.z) * 180) / Math.PI;
    yaw = e.mod ? Math.round(yaw) : Math.round(yaw / 15) * 15;
    pr.yaw = ((yaw % 360) + 360) % 360;
    this.showGhost(pr.p, pr.yaw);
    this.engine.label('mk:aim', `facing ${pr.yaw}°`, pr.p.clone().add(new THREE.Vector3(0, 2.3, 0)));
  }

  up() {
    const pr = this.press;
    this.press = null;
    this.engine.clearLabels('mk:');
    if (!pr) return;
    const el = this.make(pr.p, pr.yaw);
    this.ed.add([el]);
    if (!el.tags.length) {
      const sc = this.engine.toScreen(pr.p.clone().add(new THREE.Vector3(0, 1, 0)));
      this.ed.inlineTag = { id: el.id, x: sc.x, y: sc.y };
    }
  }

  cancel() {
    if (this.press) {
      this.press = null;
      return true;
    }
    return false;
  }
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;
