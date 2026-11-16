import * as THREE from 'three';
import type { Engine } from '$lib/engine/Engine';
import { classify, TIER_COLORS, TIER_LABEL } from '$lib/model/physics';
import { lineMaterial } from '$lib/engine/materials';
import { CursorMark } from './cursor';
import { fmt } from './plane';
import { resolvePlane, snapOnPlane } from './snap';
import type { PEvent, Tool } from './types';

export class TapeTool implements Tool {
  engine: Engine;
  a: THREE.Vector3 | null = null;
  pinned = false;
  group = new THREE.Group();
  cursor: CursorMark;

  constructor(engine: Engine) {
    this.engine = engine;
    this.cursor = new CursorMark(engine);
    engine.overlay.add(this.group);
  }
  get ed() {
    return this.engine.editor;
  }
  deactivate() {
    this.clear();
    this.cursor.update(null, null);
  }
  private clear() {
    this.group.clear();
    this.engine.clearLabels('tape:');
    this.a = null;
    this.pinned = false;
  }

  private at(e: PEvent) {
    // measure on any surface (tops, walls) or the work plane
    const hit = this.engine.pickSolid(e.x, e.y);
    if (hit) {
      const { wp } = resolvePlane(this.engine, e.x, e.y, true);
      const raw = this.engine.planeHit(e.x, e.y, wp.plane) ?? hit.point;
      const s = snapOnPlane(this.engine, wp, raw, e.x, e.y, e.mod);
      this.cursor.update(s.point, wp, s.vertex);
      return s.point;
    }
    const { wp } = resolvePlane(this.engine, e.x, e.y, false);
    const raw = this.engine.planeHit(e.x, e.y, wp.plane);
    if (!raw) return null;
    const s = snapOnPlane(this.engine, wp, raw, e.x, e.y, e.mod);
    this.cursor.update(s.point, wp, s.vertex);
    return s.point;
  }

  hover(e: PEvent) {
    const p = this.at(e);
    if (!p) return;
    this.engine.updateCursor(p, { capsule: !this.a });
    if (this.a && !this.pinned) this.draw(this.a, p);
    this.ed.hint = this.a && !this.pinned ? 'Click the second point' : 'Click a ledge, then the spot you want to reach — shows distance, height and the jump it needs';
    this.engine.invalidate();
  }

  down(e: PEvent) {
    const p = this.at(e);
    if (!p) return;
    if (!this.a || this.pinned) {
      this.clear();
      this.a = p;
      return;
    }
    this.draw(this.a, p);
    this.pinned = true;
  }

  private draw(a: THREE.Vector3, b: THREE.Vector3) {
    this.group.clear();
    const c = this.ed.project.character;
    const gap = Math.hypot(b.x - a.x, b.z - a.z);
    const dh = b.y - a.y;
    const cl = classify(c, gap, dh);
    const col = TIER_COLORS[cl.tier];
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), lineMaterial(col, 1, false));
    line.renderOrder = 35;
    this.group.add(line);
    // horizontal + vertical legs
    const corner = new THREE.Vector3(b.x, a.y, b.z);
    const legs = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, corner, b]), lineMaterial('#ffffff', 0.35, false));
    legs.renderOrder = 34;
    this.group.add(legs);
    // jump arc
    if (cl.tier !== 'walk' && cl.tier !== 'impossible' && gap > 0.2) {
      const peak = Math.max(a.y, b.y) + Math.min(c.jumpHeight * 0.8, 1.2);
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 32; i++) {
        const t = i / 32;
        const p = a.clone().lerp(b, t);
        const base = a.y + (b.y - a.y) * t;
        p.y = base + 4 * t * (1 - t) * (peak - (a.y + b.y) / 2);
        pts.push(p);
      }
      const arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMaterial(col, 0.9, false));
      arc.renderOrder = 35;
      this.group.add(arc);
    }
    for (const p of [a, b]) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.09), new THREE.MeshBasicMaterial({ color: col, depthTest: false }));
      d.position.copy(p);
      d.renderOrder = 36;
      this.group.add(d);
    }
    const dist = a.distanceTo(b);
    const verdict = cl.tier === 'impossible' ? '✗ too far' : cl.tier === 'walk' ? 'walkable' : cl.tier === 'drop' ? 'drop down (one-way)' : `${TIER_LABEL[cl.tier]} ✓ ${Math.round(cl.margin * 100)}%`;
    const tight = cl.margin >= this.ed.project.traversal.tightMargin && cl.margin <= 1 ? ' · tight' : cl.margin < this.ed.project.traversal.trivialMargin && cl.tier !== 'walk' ? ' · easy' : '';
    this.engine.label('tape:main', `${fmt(dist)} m · gap ${fmt(gap)} · Δh ${dh >= 0 ? '+' : ''}${fmt(dh)} — ${verdict}${tight}`, a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 0.7, 0)), 'dim tape');
    this.engine.invalidate();
  }

  cancel() {
    if (this.a) {
      this.clear();
      return true;
    }
    return false;
  }
}
