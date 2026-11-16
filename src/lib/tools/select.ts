import * as THREE from 'three';
import type { Engine } from '$lib/engine/Engine';
import type { Level, LevelElement, Vec2, Vec3 } from '$lib/model/types';
import { localBounds, matrixOf, quatOf, transformFromMatrix, worldBounds } from '$lib/model/space';
import { innerRadius, taperOf } from '$lib/model/shapes';
import { defaultSteps } from '$lib/engine/geometry';
import { dashedMaterial } from '$lib/engine/materials';
import { WorkPlane, fmt, snapValue } from './plane';
import { TypeBuffer } from './typing';
import type { PEvent, Tool } from './types';

type HandleKind = 'face' | 'height' | 'edge' | 'vertex' | 'lift' | 'rotate' | 'aim' | 'radius' | 'ppoint' | 'pradius' | 'taper' | 'tiltX' | 'tiltZ' | 'scale';
interface HandleData {
  handle: HandleKind;
  axis?: 0 | 1 | 2;
  sign?: number;
  i?: number;
  dir?: THREE.Vector3; // world direction for linear handles
}

type Drag =
  | { k: 'none' }
  | { k: 'press'; sx: number; sy: number; hitId: string | null; point: THREE.Vector3 | null; normal?: THREE.Vector3; alt: boolean; shift: boolean; wasSelected: boolean; align?: boolean }
  | { k: 'move'; from: Level; ids: string[]; start: THREE.Vector3; plane: THREE.Plane; orig: Map<string, Vec3>; anchor: Vec3; delta: THREE.Vector3; dup: boolean; srcIds: string[] }
  | { k: 'handle'; from: Level; id: string; el: LevelElement; h: HandleData; origin: THREE.Vector3; t0: number; extra?: any; startX?: number; startY?: number }
  | { k: 'marquee'; sx: number; sy: number; additive: boolean; base: string[] };

const HANDLE_PX = 15;
const PICK_DISC = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false, side: THREE.DoubleSide });

export class SelectTool implements Tool {
  engine: Engine;
  drag: Drag = { k: 'none' };
  handles = new THREE.Group();
  dropLines = new THREE.Group();
  typed = new TypeBuffer();
  lastDup: { srcIds: string[]; ids: string[]; delta: THREE.Vector3; from: Level } | null = null;
  private handleKey = '';
  private hook = () => this.scaleHandles();

  constructor(engine: Engine) {
    this.engine = engine;
    engine.overlay.add(this.handles, this.dropLines);
  }
  get ed() {
    return this.engine.editor;
  }

  activate() {
    this.engine.frameHooks.add(this.hook);
    this.refreshHandles(true);
  }
  deactivate() {
    this.engine.frameHooks.delete(this.hook);
    this.clearHandles();
    this.engine.clearLabels('sel:');
    this.ed.hovered = null;
    this.engine.refreshHighlights();
  }
  busy() {
    return this.drag.k !== 'none';
  }
  onLevelChanged() {
    this.refreshHandles();
  }

  // ------------------------------------------------------------------ handles
  private clearHandles() {
    for (const c of [...this.handles.children]) {
      c.removeFromParent();
      c.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.engine.handlePickables = [];
    for (const c of [...this.dropLines.children]) c.removeFromParent();
    this.handleKey = '';
  }

  refreshHandles(force = false) {
    const sel = this.ed.selected;
    const key = sel.map((e) => e.id + ':' + JSON.stringify(e)).join('|') + this.ed.tool;
    if (!force && key === this.handleKey) return;
    this.clearHandles();
    this.handleKey = key;
    if (this.ed.tool !== 'select') return;
    // drop lines under floating selected things
    for (const e of sel) this.addDropLine(e);
    if (sel.length !== 1) {
      if (sel.length > 1) {
        const b = new THREE.Box3();
        for (const e of sel) b.union(worldBounds(e, this.ed.project));
        const c = b.getCenter(new THREE.Vector3());
        this.addHandle({ handle: 'lift', dir: new THREE.Vector3(0, 1, 0) }, new THREE.Vector3(c.x, b.max.y + 0.9, c.z), '#43d17a', 'lift');
        this.addHandle({ handle: 'scale' }, b.max.clone(), '#ffffff', 'cube');
      }
      this.engine.invalidate();
      return;
    }
    const e = sel[0];
    if (e.locked) return;
    const m = matrixOf(e.transform);
    const q = quatOf(e.transform.rotation);
    const lb = localBounds(e, this.ed.project);
    const W = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(m);
    const D = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(q).normalize();
    const top = W((lb.min.x + lb.max.x) / 2, lb.max.y, (lb.min.z + lb.max.z) / 2);
    const upDir = D(0, 1, 0);

    const sh = e.type === 'shape' ? e.shape : null;
    if (sh && sh.kind === 'prism') {
      const R = sh.radius ?? 1, h = sh.height ?? 0, t = taperOf(sh);
      if (!sh.infinite) this.addHandle({ handle: 'height', dir: upDir }, W(0, h, 0), '#4da3ff', 'arrow');
      this.addHandle({ handle: 'pradius', dir: D(1, 0, 0) }, W(R, h / 2, 0), '#4da3ff', 'arrow');
      if (!sh.infinite && !sh.hollow && h > 0.05) this.addHandle({ handle: 'taper', dir: D(-1, 0, 0) }, W(R * t, h, 0), '#e57373', 'dot');
    } else if (sh && sh.size) {
      const [sx, sy, sz] = sh.size;
      const midY = sy / 2;
      this.addHandle({ handle: 'face', axis: 0, sign: 1, dir: D(1, 0, 0) }, W(sx / 2, midY, 0), '#4da3ff', 'arrow');
      this.addHandle({ handle: 'face', axis: 0, sign: -1, dir: D(-1, 0, 0) }, W(-sx / 2, midY, 0), '#4da3ff', 'arrow');
      this.addHandle({ handle: 'face', axis: 2, sign: 1, dir: D(0, 0, 1) }, W(0, midY, sz / 2), '#4da3ff', 'arrow');
      this.addHandle({ handle: 'face', axis: 2, sign: -1, dir: D(0, 0, -1) }, W(0, midY, -sz / 2), '#4da3ff', 'arrow');
      if (!sh.infinite) this.addHandle({ handle: 'face', axis: 1, sign: 1, dir: upDir }, W(0, sy, 0), '#4da3ff', 'arrow');
      if (sh.kind === 'box' && !sh.hollow && !sh.infinite && sy > 0.05) {
        const t = taperOf(sh);
        this.addHandle({ handle: 'taper', dir: D(-sx, 0, -sz) }, W((sx / 2) * t, sy, (sz / 2) * t), '#e57373', 'dot');
      }
    } else if (e.type === 'shape' && e.shape.kind === 'extrude') {
      const pts = e.shape.points!;
      const h = e.shape.height ?? 0;
      if (!e.shape.infinite) this.addHandle({ handle: 'height', dir: upDir }, W(centroid(pts)[0], h, centroid(pts)[1]), '#4da3ff', 'arrow');
      const ccw = signedArea(pts) > 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        this.addHandle({ handle: 'vertex', i }, W(a[0], 0, a[1]), '#ffffff', 'dot');
        const ex = b[0] - a[0], ez = b[1] - a[1];
        const len = Math.hypot(ex, ez) || 1;
        // outward normal
        const nx = (ccw ? ez : -ez) / len, nz = (ccw ? -ex : ex) / len;
        if (len > 0.6) this.addHandle({ handle: 'edge', i, dir: D(nx, 0, nz) }, W((a[0] + b[0]) / 2, h / 2, (a[1] + b[1]) / 2), '#4da3ff', 'arrow');
      }
      if (!e.shape.infinite && !e.shape.hollow && h > 0.05) {
        const [cx, cz] = centroid(pts), t = taperOf(e.shape);
        this.addHandle({ handle: 'taper', dir: D(cx - pts[0][0], 0, cz - pts[0][1]) }, W(cx + (pts[0][0] - cx) * t, h, cz + (pts[0][1] - cz) * t), '#e57373', 'dot');
      }
    } else if (e.type === 'marker') {
      const fwd = D(0, 0, 1);
      const p = new THREE.Vector3(...e.transform.position);
      this.addHandle({ handle: 'aim' }, p.clone().addScaledVector(fwd, Math.max(1.3, lb.max.z + 0.9)).setY(p.y + 0.1), '#ffb300', 'dot');
      const r = e.marker.radius > 0 ? e.marker.radius : Math.max(lb.max.x, 0.5) + 0.8;
      this.addHandle({ handle: 'radius' }, p.clone().add(D(1, 0, 0).multiplyScalar(r)).setY(p.y + 0.05), '#b39ddb', 'dot');
    } else if (e.type === 'path') {
      e.path.points.forEach((pt, i) => this.addHandle({ handle: 'ppoint', i }, W(pt[0], pt[1] + 0.1, pt[2]), '#ffffff', 'dot'));
    }
    if (e.type === 'path') this.addHandle({ handle: 'scale' }, W(lb.max.x, lb.max.y, lb.max.z), '#ffffff', 'cube');
    if (e.type !== 'path') {
      this.addHandle({ handle: 'lift', dir: new THREE.Vector3(0, 1, 0) }, top.clone().add(new THREE.Vector3(0, 0.9, 0)), '#43d17a', 'lift');
      if (e.type !== 'marker') {
        const corner = W(lb.max.x, lb.min.y + 0.05, lb.max.z);
        this.addHandle({ handle: 'rotate' }, corner.add(D(1, 0, 1).multiplyScalar(0.6)), '#ffb300', 'rotate');
      }
      if (e.type === 'shape' || e.type === 'stamp' || e.type === 'note') {
        const midY = (lb.min.y + lb.max.y) / 2;
        this.addHandle({ handle: 'tiltX', dir: D(1, 0, 0) }, W(lb.max.x + 0.9, midY, 0), '#ef5350', 'ring', D(1, 0, 0));
        this.addHandle({ handle: 'tiltZ', dir: D(0, 0, 1) }, W(0, midY, lb.max.z + 0.9), '#4d8ef7', 'ring', D(0, 0, 1));
      }
      if (e.type === 'shape' || (e.type === 'marker' && e.marker.radius > 0)) {
        this.addHandle({ handle: 'scale' }, W(lb.max.x, lb.max.y, lb.max.z), '#ffffff', 'cube');
      }
    }
    this.scaleHandles();
    this.engine.invalidate();
  }

  private addDropLine(e: LevelElement) {
    const b = worldBounds(e, this.ed.project);
    if (b.min.y < 0.3) return;
    const c = b.getCenter(new THREE.Vector3());
    const ray = new THREE.Raycaster(new THREE.Vector3(c.x, b.min.y - 0.01, c.z), new THREE.Vector3(0, -1, 0), 0, 500);
    const solids = this.engine.pickables.filter((p) => p.userData.solid && p.userData.elementId !== e.id);
    const hit = ray.intersectObjects(solids, false)[0];
    const yb = hit ? hit.point.y : Math.min(0, this.ed.planeY);
    if (b.min.y - yb < 0.3) return;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(c.x, b.min.y, c.z), new THREE.Vector3(c.x, yb, c.z)]), dashedMaterial('#9ccaff', 0.25, 0.18, false));
    line.computeLineDistances();
    line.renderOrder = 25;
    this.dropLines.add(line);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.25, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#9ccaff', transparent: true, opacity: 0.5, depthTest: false }));
    dot.position.set(c.x, yb + 0.02, c.z);
    dot.renderOrder = 25;
    this.dropLines.add(dot);
    this.engine.label('sel:drop:' + e.id, `${fmt(b.min.y - yb)} m`, new THREE.Vector3(c.x, (b.min.y + yb) / 2, c.z), 'dim small');
  }

  private addHandle(data: HandleData, pos: THREE.Vector3, color: string, shape: 'arrow' | 'dot' | 'lift' | 'rotate' | 'ring' | 'cube', axis?: THREE.Vector3) {
    let geo: THREE.BufferGeometry;
    if (shape === 'ring') geo = new THREE.TorusGeometry(0.55, 0.13, 8, 28);
    else if (shape === 'cube') geo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    else
    if (shape === 'arrow') geo = new THREE.ConeGeometry(0.55, 1.4, 14).translate(0, 0.9, 0);
    else if (shape === 'lift') {
      const a = new THREE.ConeGeometry(0.5, 1, 12).translate(0, 1.0, 0);
      geo = a;
    } else if (shape === 'rotate') geo = new THREE.TorusGeometry(0.6, 0.18, 8, 24).rotateX(Math.PI / 2);
    else geo = new THREE.SphereGeometry(0.55, 14, 10);
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos);
    if (data.dir && shape === 'arrow') m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), data.dir.clone().normalize());
    if (axis && shape === 'ring') m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis); // torus lies in its XY plane
    m.renderOrder = 40;
    m.userData = { ...data, color, base: pos.clone() };
    this.handles.add(m);
    this.engine.handlePickables.push(m);
    if (shape === 'ring' || shape === 'rotate') {
      // grab anywhere on the ring's disc, not just the thin torus
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.75, 20), PICK_DISC);
      if (shape === 'rotate') disc.rotation.x = -Math.PI / 2;
      disc.userData = m.userData;
      m.add(disc);
      this.engine.handlePickables.push(disc);
    }
    if (shape === 'lift') {
      const down = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 12).rotateX(Math.PI).translate(0, -0.1, 0), mat);
      down.renderOrder = 40;
      down.raycast = () => {};
      m.add(down);
    }
  }

  private scaleHandles() {
    for (const h of this.handles.children) {
      const s = this.engine.pixelSize(h.position) * HANDLE_PX;
      h.scale.setScalar(s);
    }
  }

  // ------------------------------------------------------------------ pointer
  hover(e: PEvent) {
    const h = this.engine.pickHandle(e.x, e.y);
    for (const c of this.handles.children) {
      const m = c as THREE.Mesh;
      (m.material as THREE.MeshBasicMaterial).color.set(c === h || c === h?.parent ? '#ffffff' : c.userData.color);
    }
    this.engine.container.classList.toggle('on-handle', !!h);
    if (h) {
      this.ed.hint = handleHint(h.userData.handle);
      this.setHover(null);
      this.engine.invalidate();
      return;
    }
    const hit = this.engine.pickElement(e.x, e.y);
    this.setHover(hit?.id ?? null);
    this.ed.hint = hit?.id
      ? `${hit.id} — click to select · drag to move · Alt-drag to duplicate · Shift-click to add`
      : this.ed.selection.length
        ? 'Alt-click a face to set the selection onto it · R ramp · Shift+S stairs · C round · H room · X cut ⇄ solid · , . rotate · ⌫ delete'
        : 'Click to select · drag on empty space to box-select';
    this.engine.updateCursor(hit?.point ?? null, {});
  }

  private setHover(id: string | null) {
    if (this.ed.hovered === id) return;
    this.ed.hovered = id;
    this.engine.refreshHighlights();
  }

  down(e: PEvent) {
    const h = this.engine.pickHandle(e.x, e.y);
    if (h && this.ed.selection.length) {
      this.startHandle(h, e);
      return;
    }
    const hit = this.engine.pickElement(e.x, e.y);
    const id = hit?.id ?? null;
    const wasSelected = !!id && this.ed.selection.includes(id);
    if (e.alt && hit && !wasSelected && this.ed.selection.length) {
      // Alt-click another face = set the selection onto it (on release, if the mouse didn't move)
      this.drag = { k: 'press', sx: e.x, sy: e.y, hitId: id, point: hit.point, normal: hit.normal, alt: true, shift: false, wasSelected: false, align: true };
      return;
    }
    if (id && !wasSelected) {
      this.ed.selection = e.shift ? [...this.ed.selection, id] : [id];
      this.engine.refreshHighlights();
      this.refreshHandles();
    }
    this.drag = { k: 'press', sx: e.x, sy: e.y, hitId: id, point: hit?.point ?? null, alt: e.alt, shift: e.shift, wasSelected };
  }

  move(e: PEvent) {
    const d = this.drag;
    if (d.k === 'none') return this.hover(e);
    if (d.k === 'press') {
      if (Math.hypot(e.x - d.sx, e.y - d.sy) < 4) return;
      if (d.align) return;
      if (d.hitId && d.point) this.startMove(d, e);
      else this.drag = { k: 'marquee', sx: d.sx, sy: d.sy, additive: d.shift, base: d.shift ? this.ed.selection : [] };
    }
    const t = this.drag;
    if (t.k === 'move') this.doMove(t, e);
    else if (t.k === 'handle') this.doHandle(t, e);
    else if (t.k === 'marquee') this.doMarquee(t, e);
  }

  up(e: PEvent) {
    const d = this.drag;
    this.drag = { k: 'none' };
    this.ed.hud = null;
    if (d.k === 'press') {
      if (d.align && d.point && d.normal && Math.hypot(e.x - d.sx, e.y - d.sy) < 4) {
        this.alignToFace(d.point, d.normal, e.mod);
        return;
      }
      if (!d.hitId) {
        if (!d.shift) this.ed.selection = [];
      } else if (d.shift && d.wasSelected) {
        this.ed.selection = this.ed.selection.filter((i) => i !== d.hitId);
      } else if (!d.shift && d.wasSelected) {
        this.ed.selection = [d.hitId];
      }
      this.engine.refreshHighlights();
      this.refreshHandles();
      return;
    }
    if (d.k === 'move') {
      this.engine.clearLabels('sel:mv');
      if (this.ed.level !== d.from) {
        this.ed.commit(this.ed.level, d.from);
        if (d.dup) this.lastDup = { srcIds: d.srcIds, ids: d.ids, delta: d.delta.clone(), from: d.from };
      }
      this.refreshHandles(true);
    } else if (d.k === 'handle') {
      this.engine.clearLabels('sel:h');
      if (this.ed.level !== d.from) this.ed.commit(this.ed.level, d.from);
      this.refreshHandles(true);
    } else if (d.k === 'marquee') {
      this.ed.marquee = null;
    }
    this.typed.clear();
    this.hover(e);
  }

  dblclick(e: PEvent) {
    const hit = this.engine.pickElement(e.x, e.y);
    if (!hit?.id) return;
    const el = this.ed.get(hit.id);
    if (!el) return;
    if (el.type === 'note') {
      this.ed.editingNote = el.id;
      return;
    }
    if (el.type === 'path') {
      // insert a point at the nearest segment
      const local = new THREE.Vector3().copy(hit.point).applyMatrix4(matrixOf(el.transform).invert());
      let best = 0, bd = Infinity;
      const pts = el.path.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = new THREE.Vector3(...pts[i]), b = new THREE.Vector3(...pts[i + 1]);
        const l = new THREE.Line3(a, b);
        const c = l.closestPointToPoint(local, true, new THREE.Vector3());
        const dd = c.distanceTo(local);
        if (dd < bd) {
          bd = dd;
          best = i;
        }
      }
      this.ed.patch([el.id], (x) => {
        if (x.type === 'path') x.path.points.splice(best + 1, 0, [r3(local.x), r3(pts[best][1]), r3(local.z)]);
      });
      this.ed.toast('Point added — Alt-click a point to delete it', 'info');
      return;
    }
    this.engine.frameSelection();
  }

  // ------------------------------------------------------------------ move
  private startMove(d: Extract<Drag, { k: 'press' }>, e: PEvent) {
    const from = this.ed.level;
    let ids = this.ed.selection.filter((i) => !this.ed.get(i)?.locked);
    const srcIds = [...ids];
    let dup = false;
    if (d.alt) {
      const clones = this.ed.cloneElements(this.ed.selected);
      this.ed.preview(this.ed.withElements([...from.elements, ...clones]));
      ids = clones.map((c) => c.id);
      this.ed.selection = ids;
      dup = true;
    }
    const orig = new Map<string, Vec3>();
    for (const id of ids) {
      const el = this.ed.get(id);
      if (el) orig.set(id, [...el.transform.position] as Vec3);
    }
    const anchor = orig.get(d.hitId && orig.has(d.hitId) ? d.hitId : ids[0]) ?? [0, 0, 0];
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), d.point!);
    this.drag = { k: 'move', from, ids, start: d.point!.clone(), plane, orig, anchor, delta: new THREE.Vector3(), dup, srcIds };
    this.clearHandles();
  }

  private doMove(t: Extract<Drag, { k: 'move' }>, e: PEvent) {
    const p = this.engine.planeHit(e.x, e.y, t.plane);
    if (!p) return;
    const raw = p.sub(t.start);
    raw.y = 0;
    if (e.shift) {
      if (Math.abs(raw.x) > Math.abs(raw.z)) raw.z = 0;
      else raw.x = 0;
    }
    const step = this.ed.snapStep;
    const snapOn = !e.mod && this.ed.snap;
    // snap the anchor's resulting position to the grid
    const nx = snapValue(t.anchor[0] + raw.x, step, snapOn) - t.anchor[0];
    const nz = snapValue(t.anchor[2] + raw.z, step, snapOn) - t.anchor[2];
    let delta = new THREE.Vector3(nx, 0, nz);
    if (this.typed.value) {
      const n = this.typed.numbers()[0];
      if (Number.isFinite(n) && raw.lengthSq() > 1e-6) delta = raw.clone().normalize().multiplyScalar(n);
    }
    this.applyMove(t, delta);
    const lp = new THREE.Vector3(...t.anchor).add(delta).add(new THREE.Vector3(0, 0.4, 0));
    this.engine.label('sel:mv', `${fmt(delta.length())} m${t.dup ? ' (copy)' : ''}`, lp);
    this.ed.hud = { text: this.typed.value ? `move ${this.typed.value} m` : `Δ ${fmt(delta.x)}, ${fmt(delta.z)}`, input: 'type a distance ⏎', x: e.x, y: e.y };
  }

  private applyMove(t: Extract<Drag, { k: 'move' }>, delta: THREE.Vector3) {
    t.delta.copy(delta);
    const set = new Set(t.ids);
    const base = this.ed.level;
    this.ed.preview({
      ...base,
      elements: base.elements.map((el) => {
        if (!set.has(el.id)) return el;
        const o = t.orig.get(el.id)!;
        return { ...el, transform: { ...el.transform, position: [r3(o[0] + delta.x), r3(o[1] + delta.y), r3(o[2] + delta.z)] } };
      })
    });
  }

  // ------------------------------------------------------------------ handles
  private startHandle(h: THREE.Object3D, e: PEvent) {
    const id = this.ed.selection[0];
    const data = h.userData as HandleData & { base: THREE.Vector3 };
    const from = this.ed.level;
    if (data.handle === 'scale') {
      const b = new THREE.Box3();
      for (const s of this.ed.selected) b.union(worldBounds(s, this.ed.project));
      const one = this.ed.selection.length === 1 ? this.ed.selected[0] : null;
      const anchor = e.alt ? b.getCenter(new THREE.Vector3()) : one && one.type === 'shape' ? new THREE.Vector3(...one.transform.position) : new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2);
      const dir = data.base.clone().sub(anchor);
      const len = dir.length() || 1;
      const t0 = this.engine.lineHit(e.x, e.y, anchor, dir.clone().normalize());
      const orig = new Map(this.ed.selected.map((s) => [s.id, structuredClone(s)]));
      this.drag = { k: 'handle', from, id: '*', el: this.ed.selected[0], h: data, origin: anchor, t0, extra: { orig, len, dir: dir.normalize(), t0 } };
      return;
    }
    if (data.handle === 'lift' && this.ed.selection.length > 1) {
      const orig = new Map<string, Vec3>();
      for (const s of this.ed.selected) orig.set(s.id, [...s.transform.position] as Vec3);
      const t0 = this.engine.lineHit(e.x, e.y, data.base, new THREE.Vector3(0, 1, 0));
      this.drag = { k: 'handle', from, id: '*', el: this.ed.selected[0], h: data, origin: data.base.clone(), t0, extra: orig };
      return;
    }
    const el = structuredClone(this.ed.get(id)!);
    if (data.handle === 'ppoint' && e.alt && el.type === 'path') {
      if (el.path.points.length <= 2) {
        this.ed.toast('A path needs at least 2 points', 'warn');
        return;
      }
      this.ed.patch([id], (x) => {
        if (x.type === 'path') x.path.points.splice(data.i!, 1);
      });
      return;
    }
    if (data.handle === 'vertex' && e.alt && el.type === 'shape') {
      if ((el.shape.points?.length ?? 0) <= 3) return;
      this.ed.patch([id], (x) => {
        if (x.type === 'shape') x.shape.points!.splice(data.i!, 1);
      });
      return;
    }
    const origin = data.base.clone();
    let t0 = 0;
    if (data.dir) t0 = this.engine.lineHit(e.x, e.y, origin, data.dir);
    this.drag = { k: 'handle', from, id, el, h: data, origin, t0, startX: e.x, startY: e.y };
    this.ed.hovered = null;
  }

  private doHandle(t: Extract<Drag, { k: 'handle' }>, e: PEvent) {
    const step = this.ed.snapStep;
    const snapOn = !e.mod && this.ed.snap;
    const h = t.h;
    const el = structuredClone(t.el);
    const m = matrixOf(t.el.transform);
    const inv = m.clone().invert();
    let label = '';
    let labelPos = t.origin.clone();

    if (h.handle === 'scale') {
      const x = t.extra as { orig: Map<string, LevelElement>; len: number; dir: THREE.Vector3; t0: number };
      const tt = this.engine.lineHit(e.x, e.y, t.origin, x.dir);
      let f = Math.max(0.05, tt / x.len);
      f = snapOn ? Math.max(0.05, Math.round(f * 20) / 20) : Math.round(f * 1000) / 1000;
      this.ed.preview({ ...t.from, elements: t.from.elements.map((el) => (x.orig.has(el.id) ? scaleElement(x.orig.get(el.id)!, f, t.origin) : el)) });
      this.engine.label('sel:h', `× ${f.toFixed(2)}`, t.origin.clone().addScaledVector(x.dir, x.len * f + 0.6));
      return;
    }
    if (h.handle === 'tiltX' || h.handle === 'tiltZ') {
      const axis = h.dir!.clone().normalize();
      const pivot = new THREE.Vector3(...t.el.transform.position);
      // drag in the ring's own plane, around the point where the axis passes through it
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, t.origin);
      const center = pivot.clone().addScaledVector(axis, axis.dot(t.origin.clone().sub(pivot)));
      const p = this.engine.planeHit(e.x, e.y, plane);
      if (!p) return;
      if (t.extra == null) t.extra = this.engine.planeHit(t.startX ?? e.x, t.startY ?? e.y, plane)?.sub(center) ?? t.origin.clone().sub(center);
      const a0 = (t.extra as THREE.Vector3).clone().normalize();
      const a1 = p.clone().sub(center).normalize();
      let deg = (Math.atan2(axis.dot(new THREE.Vector3().crossVectors(a0, a1)), a0.dot(a1)) * 180) / Math.PI;
      deg = snapOn ? Math.round(deg / 15) * 15 : Math.round(deg);
      const q = new THREE.Quaternion().setFromAxisAngle(axis, (deg * Math.PI) / 180).multiply(quatOf(t.el.transform.rotation));
      const eul = new THREE.Euler().setFromQuaternion(q, 'YXZ');
      el.transform.rotation = [eul.x, eul.y, eul.z].map((v) => Math.round(((v * 180) / Math.PI) * 1000) / 1000 || 0) as Vec3;
      this.ed.preview({ ...t.from, elements: t.from.elements.map((x) => (x.id === t.id ? el : x)) });
      this.engine.label('sel:h', `tilt ${deg > 0 ? '+' : ''}${deg}°`, pivot.clone().add(new THREE.Vector3(0, 1.2, 0)));
      return;
    }
    if (h.handle === 'lift') {
      let dy = this.engine.lineHit(e.x, e.y, t.origin, new THREE.Vector3(0, 1, 0)) - t.t0;
      if (t.id === '*') {
        const orig = t.extra as Map<string, Vec3>;
        const anchorY = [...orig.values()][0][1];
        dy = snapValue(anchorY + dy, step / 2, snapOn) - anchorY;
        this.ed.preview({
          ...t.from,
          elements: t.from.elements.map((x) => (orig.has(x.id) ? { ...x, transform: { ...x.transform, position: [x.transform.position[0], r3(orig.get(x.id)![1] + dy), x.transform.position[2]] as Vec3 } } : x))
        });
        this.engine.label('sel:h', `↕ ${fmt(dy)} m`, t.origin.clone().add(new THREE.Vector3(0, dy + 0.6, 0)));
        return;
      }
      const y = snapValue(t.el.transform.position[1] + dy, step / 2, snapOn);
      el.transform.position[1] = r3(y);
      label = `y = ${fmt(y)} m`;
      labelPos = t.origin.clone().setY(t.origin.y + (y - t.el.transform.position[1]) + 0.6);
    } else if (h.handle === 'face' && el.type === 'shape' && el.shape.size) {
      const dt = this.engine.lineHit(e.x, e.y, t.origin, h.dir!) - t.t0;
      const ax = h.axis!;
      const s0 = t.el.type === 'shape' ? t.el.shape.size![ax] : 1;
      const minS = step / 2;
      let ns = snapValue(s0 + dt, step / 2, snapOn);
      if (ns < minS) ns = minS;
      const grow = ns - s0;
      el.shape.size![ax] = r3(ns);
      // keep the opposite face fixed
      const shiftLocal = new THREE.Vector3();
      if (ax === 1) shiftLocal.set(0, 0, 0);
      else shiftLocal.setComponent(ax, (grow / 2) * h.sign!);
      const shiftWorld = shiftLocal.applyQuaternion(quatOf(t.el.transform.rotation));
      const p = t.el.transform.position;
      el.transform.position = [r3(p[0] + shiftWorld.x), r3(p[1] + shiftWorld.y), r3(p[2] + shiftWorld.z)];
      label = `${['width', 'height', 'depth'][ax]} ${fmt(ns)} m`;
      labelPos = t.origin.clone().addScaledVector(h.dir!, grow + 1.2);
    } else if (h.handle === 'height' && el.type === 'shape') {
      const dt = this.engine.lineHit(e.x, e.y, t.origin, h.dir!) - t.t0;
      const h0 = t.el.type === 'shape' ? t.el.shape.height ?? 0 : 0;
      const nh = Math.max(el.role === 'zone' ? 0 : step / 2, snapValue(h0 + dt, step / 2, snapOn));
      el.shape.height = r3(nh);
      label = `height ${fmt(nh)} m`;
      labelPos = t.origin.clone().addScaledVector(h.dir!, nh - h0 + 1);
    } else if (h.handle === 'edge' && el.type === 'shape' && t.el.type === 'shape') {
      const dt = snapValue(this.engine.lineHit(e.x, e.y, t.origin, h.dir!) - t.t0, step / 2, snapOn);
      const localDir = h.dir!.clone().applyQuaternion(quatOf(t.el.transform.rotation).invert());
      const pts = t.el.shape.points!.map((p) => [...p] as Vec2);
      const i = h.i!, j = (i + 1) % pts.length;
      for (const k of [i, j]) pts[k] = [r3(pts[k][0] + localDir.x * dt), r3(pts[k][1] + localDir.z * dt)];
      el.shape.points = pts;
      label = `push ${fmt(dt)} m`;
      labelPos = t.origin.clone().addScaledVector(h.dir!, dt + 1);
    } else if (h.handle === 'vertex' && el.type === 'shape' && t.el.type === 'shape') {
      const base = new THREE.Vector3(0, 0, 0).applyMatrix4(m);
      const n = new THREE.Vector3(0, 1, 0).applyQuaternion(quatOf(t.el.transform.rotation));
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, base);
      const p = this.engine.planeHit(e.x, e.y, plane);
      if (!p) return;
      // snap in world (for horizontal shapes this aligns with the grid)
      if (snapOn) {
        if (Math.abs(n.y) > 0.99) {
          p.x = Math.round(p.x / step) * step;
          p.z = Math.round(p.z / step) * step;
        }
      }
      const l = p.clone().applyMatrix4(inv);
      el.shape.points = t.el.shape.points!.map((q, k) => (k === h.i ? [r3(l.x), r3(l.z)] : q));
      label = `(${fmt(p.x)}, ${fmt(p.z)})`;
      labelPos = p.clone().add(new THREE.Vector3(0, 0.6, 0));
    } else if (h.handle === 'rotate') {
      const c = new THREE.Vector3(...t.el.transform.position);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), c);
      const p = this.engine.planeHit(e.x, e.y, plane);
      if (!p) return;
      if (t.extra == null) t.extra = Math.atan2(t.origin.x - c.x, t.origin.z - c.z);
      const a = Math.atan2(p.x - c.x, p.z - c.z);
      let deg = ((a - t.extra) * 180) / Math.PI;
      deg = snapOn ? Math.round(deg / 15) * 15 : Math.round(deg);
      el.transform.rotation = yawAdd(t.el.transform.rotation, deg);
      label = `${deg > 0 ? '+' : ''}${deg}°`;
      labelPos = c.clone().add(new THREE.Vector3(0, 1, 0));
    } else if (h.handle === 'aim' && el.type === 'marker') {
      const c = new THREE.Vector3(...t.el.transform.position);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), c);
      const p = this.engine.planeHit(e.x, e.y, plane);
      if (!p) return;
      let yaw = (Math.atan2(p.x - c.x, p.z - c.z) * 180) / Math.PI;
      yaw = snapOn ? Math.round(yaw / 15) * 15 : Math.round(yaw);
      el.transform.rotation = [0, ((yaw % 360) + 360) % 360, 0];
      label = `facing ${el.transform.rotation[1]}°`;
      labelPos = c.clone().add(new THREE.Vector3(0, 2.2, 0));
    } else if (h.handle === 'radius' && el.type === 'marker') {
      const c = new THREE.Vector3(...t.el.transform.position);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), c);
      const p = this.engine.planeHit(e.x, e.y, plane);
      if (!p) return;
      let r = Math.hypot(p.x - c.x, p.z - c.z);
      r = snapOn ? Math.round(r / step) * step : r3(r);
      if (r < 0.6) r = 0;
      el.marker.radius = r3(r);
      label = r ? `radius ${fmt(r)} m` : 'no radius';
      labelPos = p.clone().add(new THREE.Vector3(0, 0.5, 0));
    } else if (h.handle === 'ppoint' && el.type === 'path' && t.el.type === 'path') {
      const pt = t.el.path.points[h.i!];
      const wp = new THREE.Vector3(...pt).applyMatrix4(m);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), wp);
      const p = this.engine.planeHit(e.x, e.y, plane);
      if (!p) return;
      if (snapOn) {
        p.x = Math.round(p.x / step) * step;
        p.z = Math.round(p.z / step) * step;
      }
      const l = p.clone().applyMatrix4(inv);
      el.path.points = t.el.path.points.map((q, k) => (k === h.i ? [r3(l.x), q[1], r3(l.z)] : q));
      labelPos = p.clone().add(new THREE.Vector3(0, 0.5, 0));
      label = `(${fmt(p.x)}, ${fmt(p.z)})`;
    }
    if (h.handle === 'pradius' && el.type === 'shape' && t.el.type === 'shape') {
      const dt = this.engine.lineHit(e.x, e.y, t.origin, h.dir!) - t.t0;
      const r0 = t.el.shape.radius ?? 1;
      const r = Math.max(0.05, snapValue(r0 + dt, step / 2, snapOn));
      el.shape.radius = r3(r);
      const n = el.shape.smooth ? 0 : el.shape.sides ?? 6;
      label = n ? `r ${fmt(r)} m to corner · ${fmt(innerRadius(r, n))} m to flat` : `r ${fmt(r)} m · ⌀ ${fmt(2 * r)} m`;
      labelPos = t.origin.clone().addScaledVector(h.dir!, r - r0 + 1);
    }
    if (h.handle === 'taper' && el.type === 'shape' && t.el.type === 'shape') {
      const s0 = t.el.shape;
      const full = s0.kind === 'prism' ? s0.radius ?? 1 : s0.kind === 'box' ? Math.hypot(s0.size![0], s0.size![2]) / 2 : (() => { const c = centroid(s0.points!); return Math.hypot(s0.points![0][0] - c[0], s0.points![0][1] - c[1]); })();
      const dt = this.engine.lineHit(e.x, e.y, t.origin, h.dir!.clone().normalize()) - t.t0;
      let tp = (taperOf(s0) * full - dt) / full;
      tp = Math.max(0, Math.min(1, tp));
      if (snapOn) tp = Math.round(tp * 20) / 20;
      if (tp >= 1) delete el.shape.taper;
      else el.shape.taper = r3(tp);
      label = tp === 0 ? 'pointed (cone / pyramid)' : tp === 1 ? 'straight' : `top ${Math.round(tp * 100)}%${s0.kind === 'prism' ? ` · top r ${fmt((s0.radius ?? 1) * tp)} m` : ''}`;
      labelPos = t.origin.clone().add(new THREE.Vector3(0, 0.7, 0));
    }
    this.ed.preview({ ...t.from, elements: t.from.elements.map((x) => (x.id === t.id ? el : x)) });
    if (label) this.engine.label('sel:h', label, labelPos);
  }

  // ------------------------------------------------------------------ marquee
  private doMarquee(t: Extract<Drag, { k: 'marquee' }>, e: PEvent) {
    const x0 = Math.min(t.sx, e.x), x1 = Math.max(t.sx, e.x), y0 = Math.min(t.sy, e.y), y1 = Math.max(t.sy, e.y);
    this.ed.marquee = { x0, y0, x1, y1 };
    const ids: string[] = [];
    for (const el of this.ed.level.elements) {
      if (el.hidden || el.locked) continue;
      const c = worldBounds(el, this.ed.project).getCenter(new THREE.Vector3());
      const s = this.engine.toScreen(c);
      if (!s.behind && s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) ids.push(el.id);
    }
    const next = t.additive ? [...new Set([...t.base, ...ids])] : ids;
    if (next.join() !== this.ed.selection.join()) {
      this.ed.selection = next;
      this.engine.refreshHighlights();
    }
  }

  // ------------------------------------------------------------------ keys
  key(e: KeyboardEvent): boolean {
    const d = this.drag;
    if (d.k === 'move') {
      const r = this.typed.handle(e);
      if (r === 'typed') return true;
      if (r === 'enter') {
        const n = this.typed.numbers()[0];
        if (Number.isFinite(n) && d.delta.lengthSq() > 1e-6) this.applyMove(d, d.delta.clone().normalize().multiplyScalar(n));
        this.typed.clear();
        return true;
      }
    }
    // arrays after alt-duplicate: x5 or /5
    if (this.lastDup && d.k === 'none' && (this.typed.value || e.key === 'x' || e.key === '/' || e.key === '*')) {
      if (!this.typed.value && (e.key === 'x' || e.key === '*' || e.key === '/')) {
        if (this.ed.selection.join() !== this.lastDup.ids.join()) {
          this.lastDup = null;
          return false;
        }
        this.typed.value = e.key === '/' ? '/' : 'x';
        this.ed.hud = { text: `array ${this.typed.value}`, input: 'number ⏎', x: this.engine.width / 2, y: this.engine.height - 140 };
        return true;
      }
      if (/^[0-9]$/.test(e.key)) {
        this.typed.value += e.key;
        this.ed.hud = { text: `array ${this.typed.value}`, input: 'number ⏎', x: this.engine.width / 2, y: this.engine.height - 140 };
        return true;
      }
      if (e.key === 'Backspace') {
        this.typed.value = this.typed.value.slice(0, -1);
        if (!this.typed.value) this.ed.hud = null;
        return true;
      }
      if (e.key === 'Enter') {
        this.makeArray(this.typed.value);
        this.typed.clear();
        this.ed.hud = null;
        return true;
      }
      if (e.key === 'Escape') {
        this.typed.clear();
        this.ed.hud = null;
        return true;
      }
    }
    if (d.k !== 'none') return false;
    const sel = this.ed.selection;
    if (!sel.length) return false;
    const k = e.key;
    const step = this.ed.snapStep;
    if (k === 'Delete' || k === 'Backspace') {
      this.ed.remove(sel);
      return true;
    }
    if (k.startsWith('Arrow')) {
      const mult = e.shiftKey ? 10 : 1;
      const dir = this.cameraAxis(k);
      this.nudge([dir.x * step * mult, 0, dir.z * step * mult]);
      return true;
    }
    if (k === 'PageUp' || k === 'PageDown') {
      this.nudge([0, (k === 'PageUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1), 0]);
      return true;
    }
    if (k === ',' || k === '.' || k === '<' || k === '>') {
      const deg = (k === ',' || k === '<' ? 1 : -1) * (e.shiftKey ? 90 : 15);
      this.ed.patch(sel, (x) => {
        x.transform.rotation = x.type === 'marker' ? [0, (((x.transform.rotation[1] + deg) % 360) + 360) % 360, 0] : yawAdd(x.transform.rotation, deg);
      });
      return true;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const shapes = this.ed.selected.filter((x) => x.type === 'shape');
    if (k === 'r' && shapes.length) {
      this.convert('ramp');
      return true;
    }
    if (k === 'S' && shapes.length) {
      this.convert('stairs');
      return true;
    }
    if (k === 'c' && shapes.length) {
      this.convert('prism');
      return true;
    }
    if (k === 'b' && shapes.length) {
      this.convert('box');
      return true;
    }
    if (k === 'o' && shapes.length) {
      this.convert('blob');
      return true;
    }
    if (k === 'h' && shapes.length) {
      const any = shapes.some((s) => s.type === 'shape' && !s.shape.hollow);
      this.ed.patch(
        shapes.map((s) => s.id),
        (x) => {
          if (x.type !== 'shape') return;
          if (x.shape.kind !== 'box' && x.shape.kind !== 'extrude') {
            x.shape.kind = 'box';
          }
          x.shape.hollow = any ? { wall: this.ed.project.defaults.wall, floor: true, ceiling: false } : null;
          if (!any) delete x.shape.hollow;
          x.role = 'solid';
        }
      );
      this.ed.toast(any ? 'Hollow room — stamp doors into its walls with S' : 'Solid again', 'info');
      return true;
    }
    if (k === 'x' && shapes.length) {
      this.ed.patch(
        shapes.map((s) => s.id),
        (x) => {
          x.role = x.role === 'cut' ? 'solid' : 'cut';
        }
      );
      return true;
    }
    if (k === '[' || k === ']') {
      const f = k === ']' ? 1 : -1;
      this.ed.patch(sel, (x) => {
        if (x.type === 'path') x.path.width = Math.max(0.25, r3(x.path.width + f * 0.5));
        if (x.type === 'marker') x.marker.radius = Math.max(0, r3(x.marker.radius + f * 1));
      });
      return true;
    }
    return false;
  }

  private cameraAxis(key: string) {
    const f = new THREE.Vector3();
    this.engine.rig.camera.getWorldDirection(f);
    if (this.engine.rig.mode === 'plan') f.set(0, 0, -1);
    f.y = 0;
    if (Math.abs(f.x) > Math.abs(f.z)) f.set(Math.sign(f.x), 0, 0);
    else f.set(0, 0, Math.sign(f.z) || -1);
    const r = new THREE.Vector3(-f.z, 0, f.x);
    if (key === 'ArrowUp') return f;
    if (key === 'ArrowDown') return f.negate();
    if (key === 'ArrowRight') return r;
    return r.negate();
  }

  private nudge(d: Vec3) {
    this.ed.patch(this.ed.selection, (x) => {
      const p = x.transform.position;
      x.transform.position = [r3(p[0] + d[0]), r3(p[1] + d[1]), r3(p[2] + d[2])];
    });
  }

  convert(kind: 'box' | 'ramp' | 'stairs' | 'cylinder' | 'blob' | 'prism') {
    const ids = this.ed.selected.filter((x) => x.type === 'shape').map((x) => x.id);
    let rotated = false;
    this.ed.patch(ids, (x) => {
      if (x.type !== 'shape') return;
      const s = x.shape;
      if (s.kind === kind && (kind === 'ramp' || kind === 'stairs')) {
        // pressing again turns the slope direction
        x.transform.rotation = yawAdd(x.transform.rotation, 90);
        if (s.size) s.size = [s.size[2], s.size[1], s.size[0]];
        rotated = true;
        return;
      }
      if (s.kind === kind && kind === 'prism') {
        // pressing again: smooth ⇄ polygon
        s.smooth = !s.smooth || undefined;
        if (!s.smooth) delete s.smooth;
        s.sides = s.sides ?? this.ed.ngonSides;
        rotated = true;
        return;
      }
      if (s.kind === 'prism') {
        const R = s.radius ?? 1;
        s.size = [r3(2 * R), s.height ?? 1, r3(2 * R)];
        delete s.radius;
        delete s.height;
        delete s.sides;
        delete s.smooth;
      }
      if (s.kind === 'extrude') {
        const pts = s.points!;
        const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
        const c = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2).applyQuaternion(quatOf(x.transform.rotation));
        x.transform.position = [r3(x.transform.position[0] + c.x), r3(x.transform.position[1] + c.y), r3(x.transform.position[2] + c.z)];
        s.size = [r3(maxX - minX), s.height ?? 1, r3(maxZ - minZ)];
        delete s.points;
        delete s.height;
      }
      if (kind === 'prism') {
        const [w, h, d] = s.size ?? [1, 1, 1];
        s.kind = 'prism';
        s.radius = r3(Math.min(w, d) / 2);
        s.height = h;
        s.smooth = true;
        delete s.size;
        delete s.steps;
        return;
      }
      if (kind !== 'box' && kind !== 'stairs') delete s.taper;
      s.kind = kind;
      if (kind === 'stairs') s.steps = defaultSteps(s.size![1], this.ed.project.character.stepHeight);
      else delete s.steps;
      if (kind !== 'box') delete s.hollow;
    });
    if (kind === 'prism') this.ed.toast(rotated ? 'Switched round ⇄ polygon (sides in the inspector)' : 'Round — press C again for a polygon, drag the red dot to taper into a cone', 'info');
    else if (!rotated) this.ed.toast(`${kind[0].toUpperCase() + kind.slice(1)}${kind === 'ramp' || kind === 'stairs' ? ' — press again to turn it' : ''}`, 'info');
  }

  /** Set the selection onto a face: base on the hit point, local up = face normal. */
  private alignToFace(point: THREE.Vector3, normal: THREE.Vector3, free: boolean) {
    const sel = this.ed.selected.filter((x) => !x.locked);
    if (!sel.length) return;
    const first = sel[0];
    const wp = WorkPlane.fromHit(point, normal);
    const p = free ? point.clone() : wp.snap(point, this.ed.snapStep);
    const keepYaw = wp.horizontal ? first.transform.rotation[1] : 0;
    const rot = wp.horizontal ? ([0, keepYaw, 0] as Vec3) : wp.rotation(0);
    const target = matrixOf({ position: [p.x, p.y, p.z], rotation: rot });
    const delta = target.clone().multiply(matrixOf(first.transform).invert());
    const ids = new Set(sel.map((x) => x.id));
    this.ed.commit(
      this.ed.update(ids, (x) => {
        const t = transformFromMatrix(delta.clone().multiply(matrixOf(x.transform)));
        x.transform = { position: t.position.map(r3) as Vec3, rotation: t.rotation.map((v) => Math.round(v * 1000) / 1000 || 0) as Vec3 };
        return x;
      })
    );
    this.ed.toast(`Set onto the face${wp.horizontal ? '' : ` (tilted ${Math.round((Math.acos(Math.min(1, Math.abs(wp.normal.y))) * 180) / Math.PI)}°)`}`, 'ok');
    this.refreshHandles(true);
  }

  private makeArray(spec: string) {
    const ld = this.lastDup;
    if (!ld) return;
    const n = parseInt(spec.slice(1), 10);
    if (!Number.isFinite(n) || n < 1 || n > 200) return;
    const divide = spec.startsWith('/');
    const src = ld.srcIds.map((i) => ld.from.elements.find((e) => e.id === i)!).filter(Boolean);
    const keep = this.ed.level.elements.filter((e) => !ld.ids.includes(e.id));
    const base = { ...this.ed.level, elements: keep };
    const taken = new Set(keep.map((e) => e.id));
    const all: LevelElement[] = [];
    for (let k = 1; k <= n; k++) {
      const f = divide ? k / n : k;
      for (const s of src) {
        const c = structuredClone(s);
        c.id = this.ed.newId(c, taken);
        taken.add(c.id);
        const p = s.transform.position;
        c.transform.position = [r3(p[0] + ld.delta.x * f), r3(p[1] + ld.delta.y * f), r3(p[2] + ld.delta.z * f)];
        all.push(c);
      }
    }
    this.ed.commit({ ...base, elements: [...keep, ...all] });
    this.ed.selection = all.map((e) => e.id);
    this.lastDup = null;
    this.ed.toast(`${all.length} copies`, 'ok');
  }

  cancel() {
    const d = this.drag;
    if (d.k === 'move' || d.k === 'handle') {
      this.ed.preview(d.from);
      this.drag = { k: 'none' };
      this.engine.clearLabels('sel:');
      this.refreshHandles(true);
      return true;
    }
    if (d.k === 'marquee') {
      this.ed.marquee = null;
      this.drag = { k: 'none' };
      return true;
    }
    if (this.ed.selection.length) {
      this.ed.selection = [];
      this.engine.refreshHighlights();
      this.refreshHandles();
      return true;
    }
    return false;
  }
}

/** Scale an element by f about a world-space anchor (sizes, radii, points and its position). */
export function scaleElement(src: LevelElement, f: number, anchor: THREE.Vector3): LevelElement {
  const e = structuredClone(src);
  const p = new THREE.Vector3(...e.transform.position).sub(anchor).multiplyScalar(f).add(anchor);
  e.transform.position = [r3(p.x), r3(p.y), r3(p.z)];
  if (e.type === 'shape') {
    const s = e.shape;
    if (s.size) s.size = s.size.map((v) => r3(v * f)) as Vec3;
    if (s.points) s.points = s.points.map(([a, b]) => [r3(a * f), r3(b * f)] as Vec2);
    if (s.height != null) s.height = r3(s.height * f);
    if (s.radius != null) s.radius = r3(s.radius * f);
  } else if (e.type === 'path') {
    e.path.points = e.path.points.map((q) => q.map((v) => r3(v * f)) as Vec3);
    e.path.width = r3(e.path.width * f);
  } else if (e.type === 'marker') {
    e.marker.radius = r3(e.marker.radius * f);
  }
  return e;
}

function handleHint(k: HandleKind) {
  return (
    {
      face: 'Drag to push / pull this face',
      height: 'Drag to change the height',
      edge: 'Drag to push this wall in or out',
      vertex: 'Drag to move this corner · Alt-click deletes it',
      lift: 'Drag to raise / lower',
      rotate: 'Drag to rotate (15° steps, hold ⌘ for free)',
      aim: 'Drag to aim (facing)',
      radius: 'Drag to set an area radius',
      ppoint: 'Drag to move · Alt-click deletes · double-click the path to add points',
      pradius: 'Drag to change the radius',
      taper: 'Drag inward to taper the top — all the way makes a cone / pyramid',
      tiltX: 'Drag to tilt around the red axis (15° steps, ⌘ for free)',
      tiltZ: 'Drag to tilt around the blue axis (15° steps, ⌘ for free)',
      scale: 'Drag to scale proportionally (from the base; Alt from the center)'
    } as Record<HandleKind, string>
  )[k];
}

function yawAdd(rot: Vec3, deg: number): Vec3 {
  const q = quatOf(rot);
  const yq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (deg * Math.PI) / 180);
  const e = new THREE.Euler().setFromQuaternion(yq.multiply(q), 'YXZ');
  const f = (x: number) => {
    let d = Math.round(((x * 180) / Math.PI) * 1000) / 1000;
    if (Object.is(d, -0)) d = 0;
    return d;
  };
  return [f(e.x), f(e.y), f(e.z)];
}

function centroid(pts: Vec2[]): Vec2 {
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
}
function signedArea(pts: Vec2[]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;
export { yawAdd };
