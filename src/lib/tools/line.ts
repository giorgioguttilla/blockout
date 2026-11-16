import * as THREE from 'three';
import type { Engine } from '$lib/engine/Engine';
import type { PathElement, Vec3 } from '$lib/model/types';
import { buildElement } from '$lib/engine/objects';
import { CursorMark } from './cursor';
import { fmt } from './plane';
import { resolvePlane, snapOnPlane } from './snap';
import { simplify } from './plane';
import type { PEvent, Tool } from './types';

const WIDTHS: Record<string, number> = { road: 5, river: 4, 'dirt-path': 2.5, rail: 0.4, patrol: 0.5, 'critical-path': 1 };

export class LineTool implements Tool {
  engine: Engine;
  pts: THREE.Vector3[] = [];
  hoverPt: THREE.Vector3 | null = null;
  press: { x: number; y: number; p: THREE.Vector3; free: THREE.Vector3[] | null } | null = null;
  cursor: CursorMark;
  preview = new THREE.Group();
  width: number | null = null;

  constructor(engine: Engine) {
    this.engine = engine;
    this.cursor = new CursorMark(engine);
    engine.overlay.add(this.preview);
  }
  get ed() {
    return this.engine.editor;
  }
  busy() {
    return this.pts.length > 0 || !!this.press;
  }
  deactivate() {
    this.reset();
    this.cursor.update(null, null);
  }

  private currentWidth() {
    const pen = this.ed.currentPen;
    return this.width ?? WIDTHS[pen.key] ?? (pen.role === 'guide' ? 0.5 : 2);
  }

  private pointAt(e: PEvent) {
    const { wp } = resolvePlane(this.engine, e.x, e.y, false);
    const raw = this.engine.planeHit(e.x, e.y, wp.plane);
    if (!raw) return null;
    const s = snapOnPlane(this.engine, wp, raw, e.x, e.y, e.mod);
    this.cursor.update(s.point, wp, s.vertex);
    return s.point;
  }

  hover(e: PEvent) {
    const p = this.pointAt(e);
    this.hoverPt = p;
    this.engine.updateCursor(p, { capsule: true });
    this.redraw();
  }

  down(e: PEvent) {
    const p = this.pointAt(e);
    if (!p) return;
    this.press = { x: e.x, y: e.y, p, free: null };
  }

  move(e: PEvent) {
    const pr = this.press;
    if (!pr) return this.hover(e);
    if (!pr.free && Math.hypot(e.x - pr.x, e.y - pr.y) > 6 && this.pts.length === 0) pr.free = [pr.p.clone()];
    if (pr.free) {
      const { wp } = resolvePlane(this.engine, e.x, e.y, false);
      const raw = this.engine.planeHit(e.x, e.y, wp.plane);
      if (!raw) return;
      if (raw.distanceTo(pr.free[pr.free.length - 1]) > 0.4) pr.free.push(raw);
      this.cursor.update(raw, wp);
      this.pts = pr.free;
      this.hoverPt = null;
      this.redraw();
      this.ed.hud = { text: 'freehand path', input: 'release to finish', x: e.x, y: e.y };
    } else this.hover(e);
  }

  up(e: PEvent) {
    const pr = this.press;
    this.press = null;
    if (!pr) return;
    if (pr.free) {
      const flat = pr.free.map((p) => [p.x, p.z] as [number, number]);
      const simp = simplify(flat, 0.35);
      const ys = new Map(flat.map((f, i) => [f.join(), pr.free![i].y]));
      this.pts = simp.map(([x, z]) => new THREE.Vector3(x, ys.get([x, z].join()) ?? 0, z));
      this.ed.hud = null;
      this.finish();
      return;
    }
    const last = this.pts[this.pts.length - 1];
    if (last && last.distanceTo(pr.p) < 1e-3) return;
    this.pts.push(pr.p.clone());
    this.ed.hint = 'Click to add points · Enter or double-click to finish · Backspace removes the last point · [ ] width';
    this.redraw();
  }

  dblclick() {
    if (this.pts.length >= 2) this.finish();
  }

  private makeElement(points: THREE.Vector3[]): PathElement {
    const pen = this.ed.currentPen;
    const o = points[0];
    const el: PathElement = {
      id: '',
      type: 'path',
      tags: [...pen.tags],
      role: pen.role === 'solid' || pen.role === 'cut' ? 'guide' : pen.role,
      transform: { position: [r3(o.x), r3(o.y), r3(o.z)], rotation: [0, 0, 0] },
      path: { points: points.map((p) => [r3(p.x - o.x), r3(p.y - o.y), r3(p.z - o.z)] as Vec3), width: this.currentWidth(), closed: false, smooth: true },
      props: {},
      notes: '',
      precision: pen.role === 'zone' ? 'loose' : 'exact'
    };
    el.id = this.ed.newId(el);
    return el;
  }

  private redraw() {
    for (const c of [...this.preview.children]) c.removeFromParent();
    const pts = [...this.pts];
    if (this.hoverPt && pts.length) pts.push(this.hoverPt);
    if (pts.length >= 2) {
      const b = buildElement(this.makeElement(pts), this.ed.project, { labels: false });
      for (const p of b.pickables) p.raycast = () => {};
      this.preview.add(b.root);
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
      this.engine.label('line:len', `${fmt(len, 1)} m · width ${fmt(this.currentWidth())} m`, pts[pts.length - 1].clone().add(new THREE.Vector3(0, 0.6, 0)));
    } else this.engine.clearLabels('line:');
    this.engine.invalidate();
  }

  private finish() {
    const pts = this.pts;
    this.reset();
    if (pts.length < 2) return;
    const el = this.makeElement(pts);
    this.ed.add([el]);
    const sc = this.engine.toScreen(pts[pts.length - 1]);
    this.ed.inlineTag = { id: el.id, x: sc.x, y: sc.y };
  }

  private reset() {
    this.pts = [];
    this.press = null;
    for (const c of [...this.preview.children]) c.removeFromParent();
    this.engine.clearLabels('line:');
    this.ed.hud = null;
  }

  key(e: KeyboardEvent) {
    if (e.key === 'Enter' && this.pts.length >= 2) {
      this.finish();
      return true;
    }
    if (e.key === 'Backspace' && this.pts.length) {
      this.pts.pop();
      this.redraw();
      return true;
    }
    if (e.key === '[' || e.key === ']') {
      this.width = Math.max(0.25, this.currentWidth() + (e.key === ']' ? 0.5 : -0.5));
      this.redraw();
      this.ed.toast(`Path width ${fmt(this.width)} m`, 'info');
      return true;
    }
    return false;
  }

  cancel() {
    if (this.pts.length || this.press) {
      this.reset();
      return true;
    }
    return false;
  }
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;
