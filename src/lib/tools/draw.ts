import * as THREE from 'three';
import type { Engine } from '$lib/engine/Engine';
import type { ShapeData, ShapeElement, Vec2 } from '$lib/model/types';
import type { DrawShape } from '$lib/editor/editor.svelte';
import { DRAW_SHAPES } from '$lib/editor/editor.svelte';
import { buildElement } from '$lib/engine/objects';
import { lineMaterial } from '$lib/engine/materials';
import { innerRadius, outerFromInner, polygonName, prismPoints, shapeName, slopeInfo, SMOOTH_SIDES } from '$lib/model/shapes';
import { CursorMark } from './cursor';
import { WorkPlane, fmt, simplify, snapValue } from './plane';
import { planeName, resolvePlane, showSnapLabel, snapOnPlane } from './snap';
import { TypeBuffer } from './typing';
import type { PEvent, Tool } from './types';

type Foot =
  | { kind: 'rect'; a0: number; b0: number; a1: number; b1: number }
  | { kind: 'poly'; pts: Vec2[] }
  /** regular polygon / circle / cone: center (ca, cb), outer radius, angle of the first corner (deg, in-plane) */
  | { kind: 'prism'; ca: number; cb: number; radius: number; angle: number; sides: number; smooth: boolean; taper: number }
  /** ramp / stairs: from (a0, b0) up toward (a1, b1) */
  | { kind: 'slope'; a0: number; b0: number; a1: number; b1: number; width: number; stairs: boolean };

type State =
  | { k: 'idle' }
  | { k: 'press'; plane: WorkPlane; p0: THREE.Vector3; sx: number; sy: number; alt: boolean; hit: { point: THREE.Vector3; normal: THREE.Vector3 } | null }
  | { k: 'rect'; plane: WorkPlane; p0: THREE.Vector3; p1: THREE.Vector3 }
  | { k: 'radial'; plane: WorkPlane; p0: THREE.Vector3; foot: Extract<Foot, { kind: 'prism' }>; fit: boolean }
  | { k: 'run'; plane: WorkPlane; p0: THREE.Vector3; p1: THREE.Vector3 }
  | { k: 'lasso'; plane: WorkPlane; pts: Vec2[] }
  | { k: 'poly'; plane: WorkPlane; pts: THREE.Vector3[]; hover: THREE.Vector3 | null; closing: boolean }
  | { k: 'height'; plane: WorkPlane; foot: Foot; h: number; preset: number; sx: number; sy: number; t0: number | null; moved: boolean; note?: string };

export class DrawTool implements Tool {
  engine: Engine;
  s: State = { k: 'idle' };
  cursor: CursorMark;
  preview = new THREE.Group();
  rubber: THREE.Line;
  typed = new TypeBuffer();
  lastHeight: Record<string, number> = {};

  constructor(engine: Engine) {
    this.engine = engine;
    this.cursor = new CursorMark(engine);
    this.rubber = new THREE.Line(new THREE.BufferGeometry(), lineMaterial('#4da3ff', 1, false));
    this.rubber.renderOrder = 31;
    this.rubber.raycast = () => {};
    engine.overlay.add(this.preview, this.rubber);
  }

  get ed() {
    return this.engine.editor;
  }
  get shape(): DrawShape {
    return this.ed.drawShape;
  }

  activate() {
    this.preview.visible = true;
    this.reset();
  }
  deactivate() {
    this.reset();
    this.cursor.update(null, null);
    showSnapLabel(this.engine, null);
  }
  busy() {
    return this.s.k !== 'idle';
  }

  private idleHint() {
    const info = DRAW_SHAPES.find((d) => d.key === this.shape)!;
    const what = this.shape === 'ngon' ? `${polygonName(this.ed.ngonSides)} (${this.ed.ngonSides} sides)` : info.label.toLowerCase();
    return `${what}: ${info.hint.toLowerCase()} · click-click-click = any polygon · D cycles shapes · Alt-click a face to lock the plane · Q/E plane height`;
  }

  private reset() {
    this.s = { k: 'idle' };
    this.clearPreview();
    this.rubber.visible = false;
    this.typed.clear();
    this.ed.hud = null;
    this.engine.clearLabels('draw:');
    this.ed.hint = this.idleHint();
  }

  private clearPreview() {
    for (const c of [...this.preview.children]) {
      c.removeFromParent();
      c.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
  }

  private presetHeight(foot?: Foot) {
    const pen = this.ed.currentPen;
    if (foot?.kind === 'slope') return this.lastHeight.slope ?? 1.5;
    const k = pen.role;
    if (this.lastHeight[k] != null) return this.lastHeight[k];
    if (k === 'zone') return 0;
    if (k === 'cut') return 2.5;
    if (pen.category === 'geometry' && pen.key === 'platform') return 1;
    return this.ed.project.defaults.height;
  }

  private isLassoPen() {
    return this.ed.currentPen.role === 'zone' && this.shape === 'box';
  }

  // -------------------------------------------------------------- pointer
  hover(e: PEvent) {
    const s = this.s;
    if (s.k === 'height') return this.heightMove(e);
    if (s.k === 'poly') {
      const raw = this.engine.planeHit(e.x, e.y, s.plane.plane);
      if (!raw) return;
      const sn = snapOnPlane(this.engine, s.plane, raw, e.x, e.y, e.mod);
      let p = sn.point;
      if (e.shift && s.pts.length) p = constrain(s.plane, s.pts[s.pts.length - 1], p);
      const first = this.engine.toScreen(s.pts[0]);
      s.closing = s.pts.length >= 3 && Math.hypot(first.x - e.x, first.y - e.y) < 12;
      if (s.closing) p = s.pts[0].clone();
      s.hover = p;
      this.cursor.update(p, s.plane, s.closing || sn.vertex);
      showSnapLabel(this.engine, s.closing ? null : sn);
      this.drawPoly();
      this.engine.updateCursor(p, { capsule: s.plane.horizontal });
      return;
    }
    const { wp } = resolvePlane(this.engine, e.x, e.y, true);
    const raw = this.engine.planeHit(e.x, e.y, wp.plane);
    if (!raw) {
      this.cursor.update(null, null);
      this.engine.updateCursor(null);
      showSnapLabel(this.engine, null);
      return;
    }
    const sn = snapOnPlane(this.engine, wp, raw, e.x, e.y, e.mod);
    this.cursor.update(sn.point, wp, sn.vertex);
    showSnapLabel(this.engine, sn);
    this.engine.updateCursor(sn.point, { capsule: wp.horizontal });
    this.ed.hint = `${planeName(this.engine, wp)} — ${this.idleHint()}`;
  }

  down(e: PEvent) {
    const s = this.s;
    if (s.k === 'height') return this.commit();
    if (s.k === 'poly') {
      if (s.closing) return this.closePoly();
      const p = s.hover;
      if (!p) return;
      const last = s.pts[s.pts.length - 1];
      if (last && last.distanceTo(p) < 1e-3) return;
      s.pts.push(p.clone());
      this.drawPoly();
      return;
    }
    const { wp } = resolvePlane(this.engine, e.x, e.y, true);
    const hit = e.alt ? this.engine.pickSolid(e.x, e.y) : null;
    const raw = this.engine.planeHit(e.x, e.y, wp.plane);
    if (!raw) return;
    const p0 = snapOnPlane(this.engine, wp, raw, e.x, e.y, e.mod).point;
    this.s = { k: 'press', plane: wp, p0, sx: e.x, sy: e.y, alt: e.alt, hit: hit ? { point: hit.point, normal: hit.normal } : null };
  }

  move(e: PEvent) {
    const s = this.s;
    if (s.k === 'press') {
      if (Math.hypot(e.x - s.sx, e.y - s.sy) < 5) return;
      const sh = this.shape;
      if (sh === 'ngon' || sh === 'circle' || sh === 'cone') {
        this.s = { k: 'radial', plane: s.plane, p0: s.p0, fit: s.alt, foot: this.newRound(s.plane, s.p0) };
      } else if (sh === 'ramp' || sh === 'stairs') {
        this.s = { k: 'run', plane: s.plane, p0: s.p0, p1: s.p0.clone() };
      } else if (this.isLassoPen() !== s.alt) {
        this.s = { k: 'lasso', plane: s.plane, pts: [s.plane.toLocal(s.p0)] };
      } else this.s = { k: 'rect', plane: s.plane, p0: s.p0, p1: s.p0.clone() };
    }
    const t = this.s;
    if (t.k === 'rect') {
      const raw = this.engine.planeHit(e.x, e.y, t.plane.plane);
      if (!raw) return;
      let p1 = snapOnPlane(this.engine, t.plane, raw, e.x, e.y, e.mod).point;
      if (e.shift) {
        const [a0, b0] = t.plane.toLocal(t.p0);
        const [a1, b1] = t.plane.toLocal(p1);
        const m = Math.max(Math.abs(a1 - a0), Math.abs(b1 - b0));
        p1 = t.plane.toWorld(a0 + Math.sign(a1 - a0 || 1) * m, b0 + Math.sign(b1 - b0 || 1) * m);
      }
      t.p1 = p1;
      this.cursor.update(p1, t.plane);
      this.engine.updateCursor(p1, { capsule: t.plane.horizontal });
      const [a0, b0] = t.plane.toLocal(t.p0);
      const [a1, b1] = t.plane.toLocal(p1);
      this.showFoot(t.plane, { kind: 'rect', a0, b0, a1, b1 }, 0.02);
      this.ed.hud = this.hudAt(e, this.typed.value ? `size ${this.typed.value}` : `${fmt(Math.abs(a1 - a0))} × ${fmt(Math.abs(b1 - b0))} m`, 'type 4,6 ⏎');
      return;
    }
    if (t.k === 'radial') return this.radialMove(t, e);
    if (t.k === 'run') return this.runMove(t, e);
    if (t.k === 'lasso') {
      const raw = this.engine.planeHit(e.x, e.y, t.plane.plane);
      if (!raw) return;
      const l = t.plane.toLocal(raw);
      const last = t.pts[t.pts.length - 1];
      if (Math.hypot(l[0] - last[0], l[1] - last[1]) > 0.35) t.pts.push(l);
      this.cursor.update(raw, t.plane);
      const pts = t.pts.map(([a, b]) => t.plane.toWorld(a, b));
      pts.push(pts[0]);
      this.rubber.geometry.setFromPoints(pts);
      this.rubber.visible = true;
      this.ed.hud = this.hudAt(e, 'freehand area', 'release to finish');
      return;
    }
    if (t.k === 'height') return this.heightMove(e);
    if (t.k === 'poly') return this.hover(e);
  }

  up(e: PEvent) {
    const s = this.s;
    if (s.k === 'press' && s.alt && s.hit) {
      // Alt-click a face: draw on that face's plane until Esc
      const locked = WorkPlane.fromHit(s.hit.point, s.hit.normal);
      locked.kind = 'locked';
      (this.engine.tools as any).locked = locked;
      this.reset();
      this.ed.toast('Drawing plane locked to that face — Esc to unlock', 'info');
      this.hover(e);
      return;
    }
    if (s.k === 'press') {
      this.s = { k: 'poly', plane: s.plane, pts: [s.p0.clone()], hover: s.p0.clone(), closing: false };
      this.ed.hint = 'Click to add points · click the first point or press Enter to close · Backspace removes the last point · Esc cancels';
      this.drawPoly();
      return;
    }
    if (s.k === 'rect') {
      const [a0, b0] = s.plane.toLocal(s.p0);
      const [a1, b1] = s.plane.toLocal(s.p1);
      const min = this.ed.snapStep * 0.5;
      if (Math.abs(a1 - a0) < min || Math.abs(b1 - b0) < min) return this.reset();
      this.toHeight(s.plane, { kind: 'rect', a0, b0, a1, b1 }, e);
      return;
    }
    if (s.k === 'radial') {
      if (s.foot.radius < this.ed.snapStep * 0.25) return this.reset();
      this.toHeight(s.plane, s.foot, e);
      return;
    }
    if (s.k === 'run') {
      const foot = this.slopeFoot(s);
      if (Math.hypot(foot.a1 - foot.a0, foot.b1 - foot.b0) < this.ed.snapStep * 0.5) return this.reset();
      // released on something higher? the rise snaps to that surface
      const hit = this.engine.pickSolid(e.x, e.y);
      let preset: number | null = null;
      let note: string | undefined;
      if (hit && hit.normal.dot(s.plane.normal) > 0.9) {
        const d = s.plane.plane.distanceToPoint(hit.point);
        if (d > 0.05) {
          preset = Math.round(d * 1000) / 1000;
          note = `reaches ${hit.id ?? 'the surface'}`;
        }
      }
      this.toHeight(s.plane, foot, e, preset, note);
      return;
    }
    if (s.k === 'lasso') {
      this.rubber.visible = false;
      const pts = simplify(s.pts, 0.25);
      if (pts.length < 3 || Math.abs(area(pts)) < 0.5) return this.reset();
      const step = this.ed.snapStep;
      const snapped = pts.map(([a, b]) => [snapValue(a, step / 2, !e.mod), snapValue(b, step / 2, !e.mod)] as Vec2);
      this.toHeight(s.plane, { kind: 'poly', pts: dedupe(snapped) }, e);
    }
  }

  dblclick(e: PEvent) {
    const s = this.s;
    if (s.k === 'poly') {
      const distinct = dedupe(s.pts.map((p) => s.plane.toLocal(p)));
      if (distinct.length >= 3) return this.closePoly();
      this.reset();
      const hit = this.engine.pickElement(e.x, e.y);
      if (hit?.id) {
        this.ed.selection = [hit.id];
        this.ed.setTool('select');
      }
    }
  }

  leave() {
    if (this.s.k === 'idle') {
      this.cursor.update(null, null);
      showSnapLabel(this.engine, null);
    }
  }

  // -------------------------------------------------------------- round shapes
  private newRound(plane: WorkPlane, p0: THREE.Vector3): Extract<Foot, { kind: 'prism' }> {
    const [ca, cb] = plane.toLocal(p0);
    const sh = this.shape;
    return { kind: 'prism', ca, cb, radius: 0, angle: 0, sides: sh === 'ngon' ? this.ed.ngonSides : SMOOTH_SIDES, smooth: sh !== 'ngon', taper: sh === 'cone' ? 0 : 1 };
  }

  private radialMove(t: Extract<State, { k: 'radial' }>, e: PEvent) {
    const raw = this.engine.planeHit(e.x, e.y, t.plane.plane);
    if (!raw) return;
    const fit = t.fit || e.alt;
    const sn = snapOnPlane(this.engine, t.plane, raw, e.x, e.y, e.mod);
    const f = t.foot;
    f.sides = f.smooth ? SMOOTH_SIDES : this.ed.ngonSides;
    const [a0, b0] = t.plane.toLocal(t.p0);
    if (fit) {
      // fit inside the box dragged from corner to corner
      const [a1, b1] = t.plane.toLocal(e.mod ? raw : sn.point);
      let w = Math.abs(a1 - a0), d = Math.abs(b1 - b0);
      if (e.shift) w = d = Math.max(w, d);
      const best = fitInBox(f.sides, w, d);
      f.ca = a0 + (Math.sign(a1 - a0) || 1) * (w / 2) - best.mx * best.radius;
      f.cb = b0 + (Math.sign(b1 - b0) || 1) * (d / 2) - best.mz * best.radius;
      f.radius = best.radius;
      f.angle = best.angle;
      this.rubber.geometry.dispose();
      this.rubber.geometry = new THREE.BufferGeometry().setFromPoints([t.plane.toWorld(a0, b0), t.plane.toWorld(a0 + (Math.sign(a1 - a0) || 1) * w, b0), t.plane.toWorld(a0 + (Math.sign(a1 - a0) || 1) * w, b0 + (Math.sign(b1 - b0) || 1) * d), t.plane.toWorld(a0, b0 + (Math.sign(b1 - b0) || 1) * d), t.plane.toWorld(a0, b0)]);
      this.rubber.visible = true;
    } else {
      this.rubber.visible = false;
      f.ca = a0;
      f.cb = b0;
      const target = sn.vertex ? sn.point : raw;
      const [a1, b1] = t.plane.toLocal(target);
      let r = Math.hypot(a1 - a0, b1 - b0);
      let ang = (Math.atan2(b1 - b0, a1 - a0) * 180) / Math.PI;
      if (!sn.vertex && !e.mod) {
        r = snapValue(r, this.ed.snapStep / 2, true);
        ang = Math.round(ang / 15) * 15;
      }
      if (this.typed.value) {
        const n = this.typed.numbers()[0];
        if (Number.isFinite(n)) r = /f/i.test(this.typed.value) ? outerFromInner(n, f.sides) : n;
      }
      f.radius = r;
      f.angle = ang;
    }
    this.cursor.update(sn.point, t.plane, sn.vertex);
    showSnapLabel(this.engine, sn);
    this.showFoot(t.plane, f, f.taper === 0 ? Math.max(0.5, f.radius) : 0.02);
    this.ed.hud = this.hudAt(e, this.typed.value ? `radius ${this.typed.value}` : roundLabel(f), fit ? 'fitting in the box · Shift = square' : 'type 2 ⏎ (to corner) or 2f ⏎ (to flat) · [ ] sides · Alt fits in a box');
  }

  // -------------------------------------------------------------- ramps & stairs
  private slopeFoot(t: Extract<State, { k: 'run' }>): Extract<Foot, { kind: 'slope' }> {
    const [a0, b0] = t.plane.toLocal(t.p0);
    const [a1, b1] = t.plane.toLocal(t.p1);
    return { kind: 'slope', a0, b0, a1, b1, width: this.ed.rampWidth, stairs: this.shape === 'stairs' };
  }

  private runMove(t: Extract<State, { k: 'run' }>, e: PEvent) {
    // over a higher surface, the ramp ends right under the cursor (not where the ray would reach the ground)
    const over = this.engine.pickSolid(e.x, e.y);
    const higher = over && over.normal.dot(t.plane.normal) > 0.9 && t.plane.plane.distanceToPoint(over.point) > 0.05;
    const raw = higher ? t.plane.plane.projectPoint(over!.point, new THREE.Vector3()) : this.engine.planeHit(e.x, e.y, t.plane.plane);
    if (!raw) return;
    const sn = higher ? { point: t.plane.snap(raw, this.ed.snapStep), vertex: false } : snapOnPlane(this.engine, t.plane, raw, e.x, e.y, e.mod);
    let p1 = sn.point;
    if (!e.mod) {
      p1 = constrain(t.plane, t.p0, p1, e.shift ? 90 : 45);
      const dir = p1.clone().sub(t.p0);
      const len = Math.round(dir.length() / (this.ed.snapStep / 2)) * (this.ed.snapStep / 2);
      if (dir.lengthSq() > 1e-9) p1 = t.p0.clone().addScaledVector(dir.normalize(), len);
    }
    if (this.typed.value) {
      const n = this.typed.numbers()[0];
      const dir = p1.clone().sub(t.p0);
      if (Number.isFinite(n) && dir.lengthSq() > 1e-6) p1 = t.p0.clone().addScaledVector(dir.normalize(), n);
    }
    t.p1 = p1;
    this.cursor.update(p1, t.plane, sn.vertex);
    showSnapLabel(this.engine, sn);
    const foot = this.slopeFoot(t);
    const hit = over;
    const d = higher ? t.plane.plane.distanceToPoint(over!.point) : 0;
    this.showFoot(t.plane, foot, d > 0.05 ? d : 0.05);
    const run = t.p0.distanceTo(p1);
    this.ed.hud = this.hudAt(e, this.typed.value ? `run ${this.typed.value}` : `run ${fmt(run)} m${d > 0.05 ? ` → up ${fmt(d)} m onto ${hit?.id ?? 'surface'}` : ''}`, 'release on a higher surface to reach it · [ ] width · type a length ⏎');
  }

  // -------------------------------------------------------------- polygon
  private drawPoly() {
    const s = this.s;
    if (s.k !== 'poly') return;
    const pts = [...s.pts];
    if (s.hover) pts.push(s.hover);
    this.rubber.geometry.dispose();
    this.rubber.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.rubber.visible = true;
    this.engine.clearLabels('draw:');
    if (s.hover && s.pts.length) {
      const a = s.pts[s.pts.length - 1];
      const len = a.distanceTo(s.hover);
      if (len > 0.01) this.engine.label('draw:seg', this.typed.value ? `${this.typed.value} m` : `${fmt(len)} m`, a.clone().lerp(s.hover, 0.5));
    }
    this.engine.invalidate();
  }

  private closePoly() {
    const s = this.s;
    if (s.k !== 'poly') return;
    const pts = dedupe(s.pts.map((p) => s.plane.toLocal(p)));
    this.rubber.visible = false;
    if (pts.length < 3) return this.reset();
    this.toHeight(s.plane, { kind: 'poly', pts }, null);
  }

  // -------------------------------------------------------------- height
  private toHeight(plane: WorkPlane, foot: Foot, e: PEvent | null, preset?: number | null, note?: string) {
    const h0 = preset ?? this.presetHeight(foot);
    this.typed.clear();
    this.rubber.visible = false;
    this.s = { k: 'height', plane, foot, h: h0, preset: h0, sx: e?.x ?? -1, sy: e?.y ?? -1, t0: null, moved: false, note };
    this.showFoot(plane, foot, h0);
    this.ed.hint =
      foot.kind === 'slope'
        ? `Move up to set how high it climbs · click to finish (click without moving keeps ${fmt(h0)} m${note ? ', ' + note : ''}) · [ ] width · type a rise ⏎`
        : `Move to set the height · click to finish (click without moving keeps ${fmt(h0)} m) · type a height ⏎ · Esc cancels`;
    if (e) this.heightHud(e);
  }

  private heightMove(e: PEvent) {
    const s = this.s;
    if (s.k !== 'height') return;
    if (s.sx < 0) {
      s.sx = e.x;
      s.sy = e.y;
    }
    if (!s.moved && Math.hypot(e.x - s.sx, e.y - s.sy) < 6) return;
    const c = footCenter(s.plane, s.foot);
    const viewDir = new THREE.Vector3();
    this.engine.rig.camera.getWorldDirection(viewDir);
    const parallel = Math.abs(viewDir.dot(s.plane.normal)) > 0.93;
    let h: number;
    if (parallel) {
      h = s.preset + (s.sy - e.y) * this.engine.pixelSize(c) * 1.5;
    } else {
      const t = this.engine.lineHit(e.x, e.y, c, s.plane.normal);
      if (s.t0 == null) s.t0 = t;
      h = s.preset + (t - s.t0);
    }
    s.moved = true;
    const role = this.ed.currentPen.role;
    if (role !== 'zone' && role !== 'cut' && Math.abs(h) < this.ed.snapStep / 2) h = this.ed.snapStep / 2;
    s.h = snapValue(h, this.ed.snapStep / (e.mod ? 1e9 : 2), !e.mod);
    this.showFoot(s.plane, s.foot, s.h);
    this.heightHud(e);
  }

  private heightHud(e: PEvent) {
    const s = this.s;
    if (s.k !== 'height') return;
    if (this.typed.value) {
      this.ed.hud = this.hudAt(e, `${s.foot.kind === 'slope' ? 'rise' : 'height'} ${this.typed.value}`, 'Enter to finish');
      return;
    }
    if (s.foot.kind === 'slope') {
      const el = this.makeElement(s.plane, s.foot, s.h);
      const info = slopeInfo(el.shape, this.ed.project.character);
      this.ed.hud = this.hudAt(e, `rise ${fmt(Math.abs(s.h))} m · ${info?.verdict ?? ''}`, `${s.note ? s.note + ' · ' : ''}width ${fmt(s.foot.width)} m ([ ])`);
      return;
    }
    this.ed.hud = this.hudAt(e, `height ${fmt(s.h)} m`, s.foot.kind === 'prism' ? roundLabel(s.foot) : 'type 3 ⏎');
  }

  makeElement(plane: WorkPlane, foot: Foot, h: number): ShapeElement {
    const pen = this.ed.currentPen;
    const lift = Math.min(0, h);
    const H = Math.abs(h);
    let shape: ShapeData;
    let ca: number, cb: number, yaw = 0;
    if (foot.kind === 'rect') {
      ca = (foot.a0 + foot.a1) / 2;
      cb = (foot.b0 + foot.b1) / 2;
      shape = { kind: 'box', size: [r3(Math.abs(foot.a1 - foot.a0)), r3(H), r3(Math.abs(foot.b1 - foot.b0))] };
    } else if (foot.kind === 'poly') {
      const cx = foot.pts.reduce((a, p) => a + p[0], 0) / foot.pts.length;
      const cz = foot.pts.reduce((a, p) => a + p[1], 0) / foot.pts.length;
      const step = this.ed.snapStep;
      ca = Math.round(cx / step) * step;
      cb = Math.round(cz / step) * step;
      shape = { kind: 'extrude', points: foot.pts.map(([a, b]) => [r3(a - ca), r3(b - cb)] as Vec2), height: r3(H) };
    } else if (foot.kind === 'prism') {
      ca = foot.ca;
      cb = foot.cb;
      // first corner on local +X, rotated in-plane toward the drag direction
      yaw = -foot.angle;
      shape = { kind: 'prism', sides: foot.sides, radius: r3(Math.max(0.01, foot.radius)), height: r3(H) };
      if (foot.smooth) shape.smooth = true;
      if (foot.taper < 1) shape.taper = foot.taper;
    } else {
      ca = (foot.a0 + foot.a1) / 2;
      cb = (foot.b0 + foot.b1) / 2;
      const da = foot.a1 - foot.a0, db = foot.b1 - foot.b0;
      yaw = (Math.atan2(da, db) * 180) / Math.PI; // local +Z (uphill) toward the drag
      if (h < 0) yaw += 180; // going down: it rises back toward the start
      const run = Math.hypot(da, db);
      shape = { kind: foot.stairs ? 'stairs' : 'ramp', size: [r3(foot.width), r3(Math.max(0.05, H)), r3(run)] };
    }
    const pos = plane.toWorld(ca, cb, lift);
    const el: ShapeElement = {
      id: '',
      type: 'shape',
      tags: [...pen.tags],
      role: pen.role === 'guide' ? 'zone' : pen.role,
      transform: { position: [r3(pos.x), r3(pos.y), r3(pos.z)], rotation: plane.rotation(yaw) },
      shape,
      props: {},
      notes: '',
      precision: pen.role === 'zone' ? 'loose' : 'exact'
    };
    if (this.ed.level.storeys.length > 1) {
      const st = [...this.ed.level.storeys].sort((a, b) => b.y - a.y).find((s) => s.y <= el.transform.position[1] + 0.01);
      if (st) el.storey = st.id;
    }
    el.id = this.ed.newId(el);
    return el;
  }

  private showFoot(plane: WorkPlane, foot: Foot, h: number) {
    this.clearPreview();
    const el = this.makeElement(plane, foot, h);
    const b = buildElement(el, this.ed.project, { labels: false });
    for (const p of b.pickables) p.raycast = () => {};
    this.preview.add(b.root);
    this.engine.clearLabels('draw:');
    const s = this.s;
    const c = footCenter(plane, foot);
    if (foot.kind === 'rect' && (s.k === 'height' || s.k === 'rect')) {
      const w = Math.abs(foot.a1 - foot.a0), d = Math.abs(foot.b1 - foot.b0);
      this.engine.label('draw:w', `${fmt(w)} m`, plane.toWorld((foot.a0 + foot.a1) / 2, Math.min(foot.b0, foot.b1)));
      this.engine.label('draw:d', `${fmt(d)} m`, plane.toWorld(Math.max(foot.a0, foot.a1), (foot.b0 + foot.b1) / 2));
    }
    if (foot.kind === 'prism' && foot.radius > 0.01) {
      const a = (foot.angle * Math.PI) / 180;
      const corner = plane.toWorld(foot.ca + Math.cos(a) * foot.radius, foot.cb + Math.sin(a) * foot.radius);
      const ctr = plane.toWorld(foot.ca, foot.cb);
      this.rubberLine([ctr, corner]);
      this.engine.label('draw:r', `r ${fmt(foot.radius)} m`, ctr.clone().lerp(corner, 0.5));
    }
    if (foot.kind === 'slope') {
      const a = plane.toWorld(foot.a0, foot.b0), z = plane.toWorld(foot.a1, foot.b1);
      this.engine.label('draw:run', `${fmt(a.distanceTo(z))} m`, a.clone().lerp(z, 0.5));
    }
    if (s.k === 'height') this.engine.label('draw:h', `↑ ${fmt(h)} m`, c.clone().addScaledVector(plane.normal, Math.max(h, 0) + 0.3));
    this.engine.invalidate();
  }

  private rubberLine(pts: THREE.Vector3[]) {
    this.rubber.geometry.dispose();
    this.rubber.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.rubber.visible = true;
  }

  private commit() {
    const s = this.s;
    if (s.k !== 'height') return;
    const el = this.makeElement(s.plane, s.foot, s.h);
    if (s.foot.kind === 'slope') this.lastHeight.slope = Math.abs(s.h);
    else this.lastHeight[this.ed.currentPen.role] = s.h;
    this.reset();
    this.ed.add([el]);
    const top = new THREE.Vector3(...el.transform.position);
    const sc = this.engine.toScreen(top.add(new THREE.Vector3(0, Math.abs(s.h), 0)));
    this.ed.inlineTag = { id: el.id, x: sc.x, y: sc.y };
    const info = slopeInfo(el.shape, this.ed.project.character);
    if (info && !info.walkable) this.ed.toast(`${shapeName(el.shape)}: ${info.verdict}`, 'warn');
  }

  // -------------------------------------------------------------- keys
  /** [ ] change sides (n-gon) or width (ramps / stairs); usable while idle too */
  private bracket(dir: number) {
    const s = this.s;
    const slope = this.shape === 'ramp' || this.shape === 'stairs' || (s.k === 'height' && s.foot.kind === 'slope');
    if (slope) {
      this.ed.rampWidth = Math.max(0.5, this.ed.rampWidth + dir * 0.5);
      if (s.k === 'height' && s.foot.kind === 'slope') {
        s.foot.width = this.ed.rampWidth;
        this.showFoot(s.plane, s.foot, s.h);
      }
      this.ed.toast(`Width ${fmt(this.ed.rampWidth)} m`, 'info');
      return true;
    }
    if (this.shape === 'ngon' || (s.k === 'height' && s.foot.kind === 'prism' && !s.foot.smooth) || (s.k === 'radial' && !s.foot.smooth)) {
      this.ed.ngonSides = Math.max(3, Math.min(16, this.ed.ngonSides + dir));
      if (s.k === 'radial') {
        s.foot.sides = this.ed.ngonSides;
        this.showFoot(s.plane, s.foot, 0.02);
      }
      if (s.k === 'height' && s.foot.kind === 'prism') {
        s.foot.sides = this.ed.ngonSides;
        this.showFoot(s.plane, s.foot, s.h);
      }
      this.ed.hint = this.idleHint();
      this.ed.toast(`${polygonName(this.ed.ngonSides)} · ${this.ed.ngonSides} sides`, 'info');
      return true;
    }
    return false;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === '[' || e.key === ']') return this.bracket(e.key === ']' ? 1 : -1);
    const s = this.s;
    if (s.k === 'poly') {
      if (e.key === 'Enter' && !this.typed.value) {
        this.closePoly();
        return true;
      }
      if (e.key === 'Backspace' && !this.typed.value) {
        s.pts.pop();
        if (!s.pts.length) this.reset();
        else this.drawPoly();
        return true;
      }
      const r = this.typed.handle(e);
      if (r === 'typed') {
        this.drawPoly();
        return true;
      }
      if (r === 'enter' && s.hover && s.pts.length) {
        const len = this.typed.numbers()[0];
        const a = s.pts[s.pts.length - 1];
        const dir = s.hover.clone().sub(a).normalize();
        if (len && dir.lengthSq() > 0.5) s.pts.push(a.clone().addScaledVector(dir, len));
        this.typed.clear();
        this.drawPoly();
        return true;
      }
    }
    if (s.k === 'rect') {
      const r = this.typed.handle(e);
      if (r === 'typed') {
        this.ed.hud = { ...(this.ed.hud ?? { x: 0, y: 0, text: '' }), text: `size ${this.typed.value}`, input: this.typed.value };
        return true;
      }
      if (r === 'enter') {
        const [w, d] = this.typed.numbers();
        const [a0, b0] = s.plane.toLocal(s.p0);
        const [a1, b1] = s.plane.toLocal(s.p1);
        const sa = Math.sign(a1 - a0) || 1, sb = Math.sign(b1 - b0) || 1;
        const W = w ?? Math.abs(a1 - a0), D = d ?? w ?? Math.abs(b1 - b0);
        this.toHeight(s.plane, { kind: 'rect', a0, b0, a1: a0 + sa * W, b1: b0 + sb * D }, null);
        return true;
      }
    }
    if (s.k === 'radial') {
      const r = this.typed.handle(e, 'fF');
      if (r === 'typed') {
        this.ed.hud = { ...(this.ed.hud ?? { x: this.engine.width / 2, y: this.engine.height / 2, text: '' }), text: `radius ${this.typed.value}`, input: '2 = to corner · 2f = to flat' };
        return true;
      }
      if (r === 'enter') {
        const n = this.typed.numbers()[0];
        if (Number.isFinite(n) && n > 0) s.foot.radius = /f/i.test(this.typed.value) ? outerFromInner(n, s.foot.sides) : n;
        this.toHeight(s.plane, s.foot, null);
        return true;
      }
    }
    if (s.k === 'run') {
      const r = this.typed.handle(e);
      if (r === 'typed') return true;
      if (r === 'enter') {
        const n = this.typed.numbers()[0];
        const dir = s.p1.clone().sub(s.p0);
        if (Number.isFinite(n) && dir.lengthSq() > 1e-6) s.p1 = s.p0.clone().addScaledVector(dir.normalize(), n);
        this.toHeight(s.plane, this.slopeFoot(s), null);
        return true;
      }
    }
    if (s.k === 'height') {
      const r = this.typed.handle(e);
      if (r === 'typed') {
        this.ed.hud = { ...(this.ed.hud ?? { x: this.engine.width / 2, y: this.engine.height / 2, text: '' }), text: `${s.foot.kind === 'slope' ? 'rise' : 'height'} ${this.typed.value}`, input: this.typed.value };
        return true;
      }
      if (r === 'enter') {
        const h = this.typed.numbers()[0];
        if (Number.isFinite(h)) s.h = h;
        this.commit();
        return true;
      }
      if (e.key === 'Enter') {
        this.commit();
        return true;
      }
    }
    return false;
  }

  cancel() {
    if (this.s.k !== 'idle') {
      this.reset();
      return true;
    }
    if ((this.engine.tools as any).locked) {
      (this.engine.tools as any).locked = null;
      this.ed.toast('Plane unlocked', 'info');
      return true;
    }
    return false;
  }

  private hudAt(e: PEvent, text: string, hint: string) {
    return { text, input: hint, x: e.x, y: e.y };
  }
}

function roundLabel(f: Extract<Foot, { kind: 'prism' }>) {
  const name = f.smooth ? (f.taper === 0 ? 'cone' : 'circle') : polygonName(f.sides);
  if (f.smooth) return `${name} · r ${fmt(f.radius)} m · ⌀ ${fmt(f.radius * 2)} m`;
  return `${name} · r ${fmt(f.radius)} m to corner · ${fmt(innerRadius(f.radius, f.sides))} m to flat · ${Math.round(f.angle)}°`;
}

/** Largest regular polygon (in one of its natural orientations) that fits a w × d box, centered in it. */
function fitInBox(sides: number, w: number, d: number) {
  let best = { radius: 0, angle: 0, mx: 0, mz: 0 };
  for (const off of [0, 180 / sides, 90, 90 + 180 / sides]) {
    const a = (off * Math.PI) / 180;
    const pts = prismPoints(sides, 1).map(([x, z]) => [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)]);
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    const ex = Math.max(...xs) - Math.min(...xs), ez = Math.max(...zs) - Math.min(...zs);
    const r = Math.min(w / ex, d / ez);
    if (r > best.radius + 1e-9) best = { radius: r, angle: off, mx: (Math.max(...xs) + Math.min(...xs)) / 2, mz: (Math.max(...zs) + Math.min(...zs)) / 2 };
  }
  return best;
}

function footCenter(plane: WorkPlane, f: Foot) {
  if (f.kind === 'rect' || f.kind === 'slope') return plane.toWorld((f.a0 + f.a1) / 2, (f.b0 + f.b1) / 2);
  if (f.kind === 'prism') return plane.toWorld(f.ca, f.cb);
  const a = f.pts.reduce((s, p) => s + p[0], 0) / f.pts.length;
  const b = f.pts.reduce((s, p) => s + p[1], 0) / f.pts.length;
  return plane.toWorld(a, b);
}

function constrain(plane: WorkPlane, from: THREE.Vector3, p: THREE.Vector3, stepDeg = 45) {
  const [a0, b0] = plane.toLocal(from);
  const [a1, b1] = plane.toLocal(p);
  const da = a1 - a0, db = b1 - b0;
  const step = (stepDeg * Math.PI) / 180;
  const ang = Math.round(Math.atan2(db, da) / step) * step;
  const len = Math.hypot(da, db);
  return plane.toWorld(a0 + Math.cos(ang) * len, b0 + Math.sin(ang) * len);
}

function dedupe(pts: Vec2[]) {
  const out: Vec2[] = [];
  for (const p of pts) {
    const l = out[out.length - 1];
    if (!l || Math.hypot(l[0] - p[0], l[1] - p[1]) > 1e-3) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-3) out.pop();
  return out;
}
function area(pts: Vec2[]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;
