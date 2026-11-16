import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, MeshBVH } from 'three-mesh-bvh';
import type { Editor } from '$lib/editor/editor.svelte';
import type { Level, LevelElement } from '$lib/model/types';
import { diffLevels } from '$lib/model/diff';
import { worldBounds, flatten } from '$lib/model/space';
import { buildElement, makeLabel, type Built } from './objects';
import { CameraRig } from './camera';
import { Grid } from './grid';
import { cleanEdges, subtract } from './geometry';
import { COLORS, lineMaterial } from './materials';
import { ToolManager } from '$lib/tools/manager';
import { reach } from '$lib/model/physics';

(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export interface Hit {
  id: string | null;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  object: THREE.Object3D;
  distance: number;
  solid: boolean;
}

export class Engine {
  editor: Editor;
  container!: HTMLElement;
  renderer!: THREE.WebGLRenderer;
  labelRenderer!: CSS2DRenderer;
  scene = new THREE.Scene();
  world = new THREE.Group();
  ghosts = new THREE.Group();
  overlay = new THREE.Group();
  analysisGroup = new THREE.Group();
  rig = new CameraRig();
  grid = new Grid();
  sun = new THREE.DirectionalLight('#ffffff', 2.1);
  built = new Map<string, Built>();
  pickables: THREE.Object3D[] = [];
  handlePickables: THREE.Object3D[] = [];
  tools!: ToolManager;
  raycaster = new THREE.Raycaster();
  frameHooks = new Set<(dt: number) => void>();
  width = 1;
  height = 1;
  private dirty = true;
  private raf = 0;
  private csgTimer: ReturnType<typeof setTimeout> | null = null;
  private disposers: (() => void)[] = [];
  private labelMap = new Map<string, CSS2DObject>();
  private camDrag: { mode: 'orbit' | 'pan'; x: number; y: number; moved: boolean } | null = null;
  private spaceDown = false;
  private flyKeys = new Set<string>();
  private lastTrackpad = 0;
  private lastT = performance.now();
  private capsule!: THREE.Group;
  private rings!: THREE.Group;
  private sectionPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 2);
  sectionGroup = new THREE.Group();
  private sectionKey = '';
  private sectionDirty = true;
  private sectionCap: THREE.Mesh | null = null;
  private captureSection: THREE.Plane | null = null;
  continuous = false; // walk mode renders every frame
  cameraOverride: THREE.Camera | null = null;

  constructor(editor: Editor) {
    this.editor = editor;
    editor.engine = this;
  }

  // ------------------------------------------------------------------ setup
  mount(container: HTMLElement) {
    this.container = container;
    const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false, alpha: false, stencil: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.localClippingEnabled = true;
    this.renderer = r;
    container.appendChild(r.domElement);
    r.domElement.classList.add('viewport-canvas');
    r.domElement.tabIndex = 0;

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'label-layer';
    container.appendChild(this.labelRenderer.domElement);

    this.scene.background = new THREE.Color('#1d2026');
    this.scene.fog = new THREE.Fog('#1d2026', 400, 1800);
    const hemi = new THREE.HemisphereLight('#dfe8f5', '#4a4136', 1.35);
    this.scene.add(hemi);
    this.sun.position.set(30, 50, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.world, this.ghosts, this.analysisGroup, this.sectionGroup, this.grid.mesh, this.overlay);

    this.capsule = this.makeCapsule();
    this.rings = new THREE.Group();
    this.overlay.add(this.capsule, this.rings);

    this.rig.onChange = () => this.invalidate();
    this.tools = new ToolManager(this);

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.disposers.push(() => ro.disconnect());
    this.resize();
    this.bindInput();

    this.disposers.push(this.editor.onLevel((lvl) => this.sync(lvl)));
    this.disposers.push(this.editor.onProject(() => this.rebuildAll()));
    this.sync(this.editor.level);
    this.tools.activate(this.editor.tool);
    this.loop();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.disposers.forEach((d) => d());
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
    if (this.editor.engine === this) this.editor.engine = null;
  }

  invalidate() {
    this.dirty = true;
  }

  private resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.rig.setAspect(w / h);
    this.invalidate();
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    if (this.rig.tick(now)) this.dirty = true;
    if (this.flyKeys.size && this.camDrag) {
      const f = (this.flyKeys.has('w') ? 1 : 0) - (this.flyKeys.has('s') ? 1 : 0);
      const r = (this.flyKeys.has('d') ? 1 : 0) - (this.flyKeys.has('a') ? 1 : 0);
      const u = (this.flyKeys.has('e') ? 1 : 0) - (this.flyKeys.has('q') ? 1 : 0);
      this.rig.fly(f * dt, r * dt, u * dt);
      this.camDrag.moved = true;
    }
    if (this.frameHooks.size) {
      for (const h of this.frameHooks) h(dt);
      this.dirty = true;
    }
    if (!this.dirty && !this.continuous) return;
    this.dirty = false;
    this.render();
  };

  render(camera: THREE.Camera = this.cameraOverride ?? this.rig.camera) {
    const s = this.rig.s;
    const ed = this.editor;
    this.grid.update(s.target, ed.planeY, s.distance, ed.snapStep, ed.project.grid.size);
    this.grid.mesh.visible = !ed.walking;
    const bg = ed.walking ? '#9db3c9' : '#1d2026';
    (this.scene.background as THREE.Color).set(bg);
    (this.scene.fog as THREE.Fog).color.set(bg);
    (this.scene.fog as THREE.Fog).near = ed.walking ? 60 : 400;
    (this.scene.fog as THREE.Fog).far = ed.walking ? 400 : 1800;
    // sun follows the view so shadows stay crisp
    const span = THREE.MathUtils.clamp(s.distance * 1.2, 20, 260);
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    if (sc.right !== span) {
      sc.left = -span;
      sc.right = span;
      sc.top = span;
      sc.bottom = -span;
      sc.far = 600;
      sc.updateProjectionMatrix();
    }
    this.sun.target.position.copy(s.target);
    this.sun.position.copy(s.target).add(new THREE.Vector3(45, 90, 30));
    const sp = this.currentSectionPlane();
    this.renderer.clippingPlanes = sp ? [sp] : [];
    this.updateSection(sp);
    if (sp && this.sectionCap) {
      // keep the (big) cap quad centered under the view
      const c = sp.projectPoint(s.target, new THREE.Vector3()).addScaledVector(sp.normal, 0.002);
      this.sectionCap.position.copy(c);
    }
    this.renderer.render(this.scene, camera);
    this.labelRenderer.render(this.scene, camera);
  }

  // ------------------------------------------------------------------ sync
  private projectRev = 0;
  rebuildAll() {
    this.projectRev++;
    for (const b of this.built.values()) this.disposeBuilt(b);
    this.built.clear();
    this.sync(this.editor.level);
  }

  sync(level: Level) {
    const seen = new Set<string>();
    const project = this.editor.project;
    let changed = false;
    for (const e of level.elements) {
      seen.add(e.id);
      let b = this.built.get(e.id);
      if (!b || b.el !== e) {
        if (b) this.disposeBuilt(b);
        b = buildElement(e, project, { labels: true });
        b.root.updateMatrixWorld(true);
        for (const s of b.solids) if (!(s.base as any).boundsTree) (s.base as any).computeBoundsTree();
        this.world.add(b.root);
        this.built.set(e.id, b);
        changed = true;
      }
      b.root.visible = !e.hidden;
    }
    for (const [id, b] of this.built) {
      if (!seen.has(id)) {
        this.disposeBuilt(b);
        this.built.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.pickables = [];
      for (const b of this.built.values()) if (b.root.visible && !b.el.locked) this.pickables.push(...b.pickables);
      this.scheduleCsg();
    } else {
      this.pickables = [];
      for (const b of this.built.values()) if (b.root.visible && !b.el.locked) this.pickables.push(...b.pickables);
    }
    this.sectionDirty = true;
    this.syncCompare();
    this.refreshHighlights();
    this.tools?.onLevelChanged();
    this.invalidate();
  }

  private disposeBuilt(b: Built) {
    b.root.removeFromParent();
    for (const l of b.labels) l.element.remove();
    b.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !(m.geometry as any).__shared) {
        (m.geometry as any).disposeBoundsTree?.();
        m.geometry.dispose();
      }
    });
  }

  scheduleCsg(delay = 30) {
    if (this.csgTimer) clearTimeout(this.csgTimer);
    this.csgTimer = setTimeout(() => this.runCsg(), delay);
  }

  runCsg() {
    this.csgTimer = null;
    const cuts: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; box: THREE.Box3 }[] = [];
    for (const b of this.built.values()) if (!b.el.hidden) cuts.push(...b.cuts);
    for (const b of this.built.values()) {
      for (const s of b.solids) {
        s.mesh.updateWorldMatrix(true, false);
        const wb = s.base.boundingBox!.clone().applyMatrix4(s.mesh.matrixWorld);
        const hits = b.el.hidden ? [] : cuts.filter((c) => c.box.intersectsBox(wb));
        const key = hits.map((c) => c.geometry.uuid).join(',');
        if ((s.mesh.userData.csgKey ?? '') === key) continue;
        s.mesh.userData.csgKey = key;
        let g: THREE.BufferGeometry = s.base;
        if (hits.length) {
          try {
            const inv = s.mesh.matrixWorld.clone().invert();
            g = subtract(s.base, hits.map((c) => ({ geometry: c.geometry, matrix: inv.clone().multiply(c.matrix) })));
          } catch (err) {
            console.warn('CSG failed', err);
            g = s.base;
          }
        }
        if (s.mesh.geometry !== s.base && s.mesh.geometry !== g) s.mesh.geometry.dispose();
        s.mesh.geometry = g;
        if (!(g as any).boundsTree) (g as any).computeBoundsTree();
        s.edge.geometry.dispose();
        s.edge.geometry = cleanEdges(g, 28);
        this.sectionDirty = true;
      }
    }
    this.invalidate();
  }

  // ------------------------------------------------------------------ highlights
  refreshHighlights() {
    const sel = new Set(this.editor.selection);
    const hov = this.editor.hovered;
    const cmp = this.compareState;
    for (const [id, b] of this.built) {
      let mat: THREE.Material | null = null;
      if (sel.has(id)) mat = lineMaterial(COLORS.accent, 1, false);
      else if (hov === id) mat = lineMaterial(COLORS.hover, 1, false);
      else if (cmp?.added.has(id)) mat = lineMaterial(COLORS.added, 1, false);
      else if (cmp?.changed.has(id)) mat = lineMaterial(COLORS.changed, 1, false);
      for (const e of b.edges) {
        e.line.material = mat ?? e.base;
        e.line.renderOrder = mat ? 10 : 0;
      }
      for (const l of b.labels) (l.element as HTMLElement).classList.toggle('sel', sel.has(id));
      for (const p of b.pickables) {
        const m = p as THREE.Mesh;
        if (m.userData.selMat) m.material = sel.has(id) ? m.userData.selMat : m.userData.baseMat;
      }
    }
    this.invalidate();
  }

  // ------------------------------------------------------------------ compare ghosts
  private compareState: { added: Set<string>; changed: Set<string> } | null = null;
  private compareKey: unknown = null;
  syncCompare() {
    const c = this.editor.compare;
    const key = c ? [c.base, this.editor.level] : null;
    if (key && this.compareKey && (this.compareKey as any)[0] === key[0] && (this.compareKey as any)[1] === key[1]) return;
    this.compareKey = key;
    for (const ch of [...this.ghosts.children]) {
      ch.removeFromParent();
      ch.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.compareState = null;
    if (!c) return;
    const d = diffLevels(c.base, this.editor.level);
    this.compareState = { added: new Set(d.added.map((e) => e.id)), changed: new Set(d.modified.map((m) => m.id)) };
    const project = this.editor.project;
    for (const e of d.removed) {
      const b = buildElement(e, project, { ghost: COLORS.removed, labels: false });
      this.ghosts.add(b.root);
    }
    for (const m of d.modified) {
      if (m.moved < 0.01 && JSON.stringify((m.before as any).shape) === JSON.stringify((m.after as any).shape)) continue;
      const b = buildElement(m.before, project, { ghost: COLORS.ghost, labels: false });
      this.ghosts.add(b.root);
      if (m.moved > 0.01) {
        const a = new THREE.Vector3(...m.before.transform.position).add(new THREE.Vector3(0, 0.3, 0));
        const z = new THREE.Vector3(...m.after.transform.position).add(new THREE.Vector3(0, 0.3, 0));
        const arrow = new THREE.ArrowHelper(z.clone().sub(a).normalize(), a, a.distanceTo(z), COLORS.changed, 0.5, 0.3);
        this.ghosts.add(arrow);
      }
    }
    this.invalidate();
  }

  // ------------------------------------------------------------------ picking
  ndc(x: number, y: number) {
    return new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
  }
  ray(x: number, y: number) {
    this.raycaster.setFromCamera(this.ndc(x, y), this.rig.camera);
    if (this.rig.mode === 'plan') {
      // orthographic rays start far above; fine
    }
    return this.raycaster.ray.clone();
  }

  private toHit(i: THREE.Intersection): Hit {
    const n = i.face ? i.face.normal.clone().transformDirection(i.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    let id: string | null = null;
    let o: THREE.Object3D | null = i.object;
    while (o && !id) {
      id = o.userData.elementId ?? null;
      o = o.parent;
    }
    return { id, point: i.point.clone(), normal: n, object: i.object, distance: i.distance, solid: !!i.object.userData.solid };
  }

  private clipOk(p: THREE.Vector3) {
    const sp = this.currentSectionPlane();
    return !sp || sp.distanceToPoint(p) >= -0.01;
  }

  // ------------------------------------------------------------------ section view
  /** The cut: a locked work plane if there is one (keeps what's behind the face), else 2.2 m above the plane. */
  currentSectionPlane(): THREE.Plane | null {
    if (this.captureSection) return this.captureSection;
    if (!this.editor.section) return null;
    const locked = (this.tools as any)?.locked as { plane: THREE.Plane } | null;
    if (locked) return locked.plane.clone().negate();
    this.sectionPlane.normal.set(0, -1, 0);
    this.sectionPlane.constant = this.editor.planeY + 2.2;
    return this.sectionPlane;
  }

  markSectionDirty() {
    this.sectionDirty = true;
  }

  /**
   * Non-destructive section caps: every solid is drawn twice into the stencil buffer (back faces +1,
   * front faces −1). Wherever the count is non-zero, the cut plane is inside a solid, so a hatched cap
   * is drawn there. Cut outlines come from slicing each solid with the plane.
   */
  private updateSection(plane: THREE.Plane | null) {
    const key = plane ? plane.normal.toArray().map((n) => n.toFixed(4)).join(',') + ':' + plane.constant.toFixed(4) : '';
    if (key === this.sectionKey && !this.sectionDirty) return;
    this.sectionKey = key;
    this.sectionDirty = false;
    for (const c of [...this.sectionGroup.children]) {
      c.removeFromParent();
      if (c.userData.ownGeometry) (c as THREE.Mesh).geometry.dispose();
    }
    this.sectionCap = null;
    if (!plane) return;
    const segs: number[] = [];
    const tmp = new THREE.Vector3();
    for (const b of this.built.values()) {
      if (b.el.hidden) continue;
      for (const so of b.solids) {
        const mesh = so.mesh;
        mesh.updateWorldMatrix(true, false);
        for (const mat of [STENCIL_BACK, STENCIL_FRONT]) {
          const m = new THREE.Mesh(mesh.geometry, mat);
          m.matrixAutoUpdate = false;
          m.matrix.copy(mesh.matrixWorld);
          m.matrixWorldNeedsUpdate = true;
          m.renderOrder = 50;
          m.raycast = () => {};
          this.sectionGroup.add(m);
        }
        // slice for the outline
        const inv = mesh.matrixWorld.clone().invert();
        const lp = plane.clone().applyMatrix4(inv);
        const pos = mesh.geometry.getAttribute('position');
        const idx = mesh.geometry.index;
        const n = idx ? idx.count : pos.count;
        const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
        for (let i = 0; i < n; i += 3) {
          va.fromBufferAttribute(pos, idx ? idx.getX(i) : i);
          vb.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1);
          vc.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2);
          const da = lp.distanceToPoint(va), db = lp.distanceToPoint(vb), dc = lp.distanceToPoint(vc);
          if ((da > 0 && db > 0 && dc > 0) || (da < 0 && db < 0 && dc < 0)) continue;
          const pts: THREE.Vector3[] = [];
          for (const [p, q, dp, dq] of [[va, vb, da, db], [vb, vc, db, dc], [vc, va, dc, da]] as [THREE.Vector3, THREE.Vector3, number, number][]) {
            if ((dp > 0) !== (dq > 0) && Math.abs(dp - dq) > 1e-9) pts.push(tmp.copy(p).lerp(q, dp / (dp - dq)).clone().applyMatrix4(mesh.matrixWorld));
          }
          if (pts.length >= 2) segs.push(pts[0].x, pts[0].y, pts[0].z, pts[1].x, pts[1].y, pts[1].z);
        }
      }
    }
    const cap = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), CAP_MATERIAL());
    cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.normal.clone().negate());
    cap.renderOrder = 51;
    cap.raycast = () => {};
    cap.userData.ownGeometry = true;
    this.sectionCap = cap;
    this.sectionGroup.add(cap);
    if (segs.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
      g.translate(plane.normal.x * 0.004, plane.normal.y * 0.004, plane.normal.z * 0.004);
      const lines = new THREE.LineSegments(g, lineMaterial('#0d0f12', 1, true));
      lines.renderOrder = 52;
      lines.raycast = () => {};
      lines.userData.ownGeometry = true;
      this.sectionGroup.add(lines);
    }
  }

  pickElement(x: number, y: number): Hit | null {
    this.raycaster.setFromCamera(this.ndc(x, y), this.rig.camera);
    (this.raycaster as any).firstHitOnly = false;
    const hits = this.raycaster.intersectObjects(this.pickables, false).filter((h) => this.clipOk(h.point));
    if (!hits.length) return null;
    // prefer markers/notes/paths when they are close to the first hit (they are small)
    const first = hits[0];
    const small = hits.find((h) => !h.object.userData.solid && h.distance < first.distance + 0.6);
    return this.toHit(small ?? first);
  }

  pickSolid(x: number, y: number, exclude?: Set<string>): Hit | null {
    this.raycaster.setFromCamera(this.ndc(x, y), this.rig.camera);
    const solids = this.pickables.filter((p) => p.userData.solid && !(exclude && exclude.has(p.userData.elementId)));
    const hits = this.raycaster.intersectObjects(solids, false).filter((h) => this.clipOk(h.point));
    return hits.length ? this.toHit(hits[0]) : null;
  }

  pickHandle(x: number, y: number): THREE.Object3D | null {
    if (!this.handlePickables.length) return null;
    this.raycaster.setFromCamera(this.ndc(x, y), this.rig.camera);
    const hits = this.raycaster.intersectObjects(this.handlePickables, false);
    return hits[0]?.object ?? null;
  }

  planeHit(x: number, y: number, plane: THREE.Plane): THREE.Vector3 | null {
    const ray = this.ray(x, y);
    const p = new THREE.Vector3();
    return ray.intersectPlane(plane, p) ? p : null;
  }

  /** closest point on a 3D line (through origin along dir) to the mouse ray */
  lineHit(x: number, y: number, origin: THREE.Vector3, dir: THREE.Vector3): number {
    const ray = this.ray(x, y);
    const w0 = origin.clone().sub(ray.origin);
    const a = dir.dot(dir), b = dir.dot(ray.direction), c = ray.direction.dot(ray.direction);
    const d = dir.dot(w0), e = ray.direction.dot(w0);
    const den = a * c - b * b;
    if (Math.abs(den) < 1e-8) return 0;
    return (b * e - c * d) / den;
  }

  toScreen(p: THREE.Vector3) {
    const v = p.clone().project(this.rig.camera);
    return { x: (v.x * 0.5 + 0.5) * this.width, y: (-v.y * 0.5 + 0.5) * this.height, behind: v.z > 1 };
  }

  /** world units per screen pixel at a point */
  pixelSize(p: THREE.Vector3) {
    if (this.rig.mode === 'plan') return (2 * this.rig.viewHalfHeight()) / this.height;
    const d = this.rig.persp.position.distanceTo(p);
    return (2 * d * Math.tan((this.rig.persp.fov * Math.PI) / 360)) / this.height;
  }

  // ------------------------------------------------------------------ labels for tools
  label(key: string, text: string | null, pos?: THREE.Vector3, cls = 'dim') {
    let l = this.labelMap.get(key);
    if (text == null) {
      if (l) {
        l.removeFromParent();
        this.labelMap.delete(key);
      }
      return;
    }
    if (!l) {
      l = makeLabel(text, cls);
      this.overlay.add(l);
      this.labelMap.set(key, l);
    }
    if (l.element.textContent !== text) l.element.textContent = text;
    if (pos) l.position.copy(pos);
    this.invalidate();
  }
  clearLabels(prefix: string) {
    for (const k of [...this.labelMap.keys()]) if (k.startsWith(prefix)) this.label(k, null);
  }

  // ------------------------------------------------------------------ cursor aids
  private makeCapsule() {
    const g = new THREE.Group();
    const c = this.editor.project.character;
    const mat = new THREE.MeshBasicMaterial({ color: '#4da3ff', transparent: true, opacity: 0.22, depthWrite: false });
    const geo = new THREE.CapsuleGeometry(c.radius, Math.max(0.01, c.height - 2 * c.radius), 4, 12);
    geo.translate(0, c.height / 2, 0);
    const m = new THREE.Mesh(geo, mat);
    m.raycast = () => {};
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 40), lineMaterial('#4da3ff', 0.6));
    e.raycast = () => {};
    g.add(m, e);
    g.visible = false;
    return g;
  }

  updateCursor(p: THREE.Vector3 | null, opts: { capsule?: boolean } = {}) {
    const ed = this.editor;
    if (!p) {
      this.capsule.visible = false;
      this.rings.visible = false;
      ed.cursor = null;
      this.invalidate();
      return;
    }
    ed.cursor = { x: p.x, y: p.y, z: p.z };
    const show = !!opts.capsule && ed.showScale && !ed.walking;
    this.capsule.visible = show;
    if (show) this.capsule.position.copy(p);
    this.rings.visible = ed.jumpRings;
    if (ed.jumpRings) this.updateRings(p);
    this.invalidate();
  }

  refreshCapsule() {
    const vis = this.capsule.visible;
    const pos = this.capsule.position.clone();
    this.capsule.removeFromParent();
    this.capsule = this.makeCapsule();
    this.capsule.visible = vis;
    this.capsule.position.copy(pos);
    this.overlay.add(this.capsule);
  }

  private ringsKey = '';
  private updateRings(p: THREE.Vector3) {
    const c = this.editor.project.character;
    const key = JSON.stringify(c);
    if (key !== this.ringsKey) {
      this.ringsKey = key;
      this.rings.clear();
      const tiers: [string, number, string][] = [
        ['jump', reach(c, 0, c.walkSpeed), '#c0ca33'],
        ['sprint', reach(c, 0, c.sprintSpeed), '#ffa726']
      ];
      if (c.extraJumps > 0) tiers.push(['double', reach(c, 0, c.sprintSpeed, 1 + c.extraJumps), '#ab47bc']);
      if (c.dashDistance > 0) tiers.push(['dash', reach(c, 0, c.sprintSpeed, 1 + c.extraJumps, c.dashDistance), '#29b6f6']);
      for (const [name, r, col] of tiers) {
        const pts = Array.from({ length: 97 }, (_, i) => new THREE.Vector3(Math.cos((i / 96) * Math.PI * 2) * r, 0.06, Math.sin((i / 96) * Math.PI * 2) * r));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMaterial(col, 1, false));
        line.renderOrder = 20;
        this.rings.add(line);
        const l = makeLabel(`${name} ${r.toFixed(1)} m`, 'ring', col);
        l.position.set(r * 0.7071, 0.1, r * 0.7071);
        this.rings.add(l);
      }
      // max jump height column
      const h = c.jumpHeight * (1 + c.extraJumps);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, h, 8).translate(0, h / 2, 0), new THREE.MeshBasicMaterial({ color: '#c0ca33', transparent: true, opacity: 0.8 }));
      col.raycast = () => {};
      this.rings.add(col);
      const top = makeLabel(`max climb ${h.toFixed(2)} m`, 'ring', '#c0ca33');
      top.position.set(0, h + 0.2, 0);
      this.rings.add(top);
    }
    this.rings.position.copy(p);
  }

  // ------------------------------------------------------------------ analysis overlay
  showAnalysis(res: import('$lib/traversal/analysis').AnalysisResult | null) {
    for (const c of [...this.analysisGroup.children]) {
      c.removeFromParent();
      (c as THREE.Mesh).geometry?.dispose();
    }
    if (!res) return this.invalidate();
    const n = res.pos.length / 3;
    const cs = res.cellSize * 0.9;
    const geo = new THREE.PlaneGeometry(cs, cs).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    const inst = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    const tierCols = ['#4caf50', '#c0ca33', '#ffa726', '#ab47bc', '#29b6f6'].map((c) => new THREE.Color(c));
    const red = new THREE.Color('#e53935'), oneWay = new THREE.Color('#8d6e63');
    for (let i = 0; i < n; i++) {
      m.makeTranslation(res.pos[i * 3], res.pos[i * 3 + 1] + 0.04, res.pos[i * 3 + 2]);
      inst.setMatrixAt(i, m);
      const r = res.rank[i];
      if (!res.hasSpawn) col.set('#6fa8dc');
      else if (r === 255) col.copy(red);
      else {
        col.copy(tierCols[r] ?? tierCols[0]);
        if (!res.back[i]) col.lerp(oneWay, 0.65);
      }
      inst.setColorAt(i, col);
    }
    inst.raycast = () => {};
    inst.renderOrder = 6;
    this.analysisGroup.add(inst);
    // jump arcs
    const tc: Record<string, string> = { 'walk-jump': '#c0ca33', 'sprint-jump': '#ffa726', 'extra-jump': '#ab47bc', dash: '#29b6f6' };
    for (const j of res.jumps) {
      const a = new THREE.Vector3(...j.from), b = new THREE.Vector3(...j.to);
      const peak = Math.max(a.y, b.y) + 0.8;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 20; k++) {
        const t = k / 20;
        const p = a.clone().lerp(b, t);
        p.y = a.y + (b.y - a.y) * t + 4 * t * (1 - t) * (peak - (a.y + b.y) / 2) + 0.05;
        pts.push(p);
      }
      const tight = j.margin >= this.editor.project.traversal.tightMargin;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMaterial(tight ? '#ff5252' : tc[j.tier] ?? '#ffffff', tight ? 1 : 0.7, true));
      line.raycast = () => {};
      this.analysisGroup.add(line);
    }
    this.invalidate();
  }

  // ------------------------------------------------------------------ view helpers
  boundsOf(ids?: string[]) {
    const box = new THREE.Box3();
    const project = this.editor.project;
    const els = ids ? this.editor.level.elements.filter((e) => ids.includes(e.id)) : this.editor.level.elements.filter((e) => !e.hidden);
    for (const e of els) box.union(worldBounds(e, project));
    return box;
  }
  frameAll(animate = true) {
    this.rig.frame(this.boundsOf(), animate);
  }
  frameSelection() {
    const ids = this.editor.selection;
    if (!ids.length) return this.frameAll();
    const b = this.boundsOf(ids);
    b.expandByScalar(2);
    this.rig.frame(b);
  }
  setView(mode: '3d' | 'plan') {
    this.rig.setMode(mode);
    this.invalidate();
  }

  // ------------------------------------------------------------------ geometry export
  /** Merged world-space geometry of all visible solids (cuts applied). */
  collisionGeometry(): THREE.BufferGeometry | null {
    if (this.csgTimer) this.runCsg();
    const parts: THREE.BufferGeometry[] = [];
    for (const b of this.built.values()) {
      if (b.el.hidden) continue;
      for (const s of b.solids) {
        s.mesh.updateWorldMatrix(true, false);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', (s.mesh.geometry.index ? s.mesh.geometry.toNonIndexed() : s.mesh.geometry).getAttribute('position').clone());
        g.applyMatrix4(s.mesh.matrixWorld);
        parts.push(g);
      }
    }
    if (!parts.length) return null;
    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    if (!merged) return null;
    (merged as any).boundsTree = new MeshBVH(merged);
    return merged;
  }

  flatElements(): LevelElement[] {
    return flatten(this.editor.level, this.editor.project);
  }

  // ------------------------------------------------------------------ capture
  async capture(kind: 'top' | 'iso', yawDeg = 45, w = 1600, h = 1000, opts: { section?: THREE.Plane; title?: string } = {}): Promise<string> {
    const box = this.boundsOf();
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(20, 2, 20));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    let cam: THREE.Camera;
    if (kind === 'top') {
      const aspect = w / h;
      const halfH = Math.max(size.z / 2, size.x / 2 / aspect) * 1.08 + 1;
      const o = new THREE.OrthographicCamera(-halfH * aspect, halfH * aspect, halfH, -halfH, 0.1, 5000);
      o.position.set(center.x, box.max.y + 200, center.z);
      o.up.set(0, 0, -1);
      o.lookAt(center.x, 0, center.z);
      o.updateProjectionMatrix();
      o.updateMatrixWorld();
      cam = o;
    } else {
      const p = new THREE.PerspectiveCamera(40, w / h, 0.1, 5000);
      const r = Math.max(size.x, size.z, size.y) * 0.5;
      const dist = (r / Math.tan((20 * Math.PI) / 180)) * 1.05;
      const yaw = (yawDeg * Math.PI) / 180, pitch = (38 * Math.PI) / 180;
      p.position.set(center.x + Math.cos(pitch) * Math.sin(yaw) * dist, center.y + Math.sin(pitch) * dist, center.z + Math.cos(pitch) * Math.cos(yaw) * dist);
      p.lookAt(center);
      p.updateMatrixWorld();
      cam = p;
    }
    const prevSize = new THREE.Vector2();
    this.renderer.getSize(prevSize);
    const prevRatio = this.renderer.getPixelRatio();
    const overlayVis = this.overlay.visible, gridVis = this.grid.mesh.visible, ghostVis = this.ghosts.visible;
    this.overlay.visible = false;
    this.ghosts.visible = false;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    // exports never show selection tint
    const tinted: THREE.Mesh[] = [];
    for (const b of this.built.values())
      for (const pk of b.pickables) {
        const m = pk as THREE.Mesh;
        if (m.userData.selMat && m.material === m.userData.selMat) {
          m.material = m.userData.baseMat;
          tinted.push(m);
        }
      }
    this.captureSection = opts.section ?? null;
    this.renderer.clippingPlanes = opts.section ? [opts.section] : [];
    this.updateSection(opts.section ?? null);
    if (opts.section && this.sectionCap) this.sectionCap.position.copy(opts.section.projectPoint(center, new THREE.Vector3()).addScaledVector(opts.section.normal, 0.002));
    this.renderer.render(this.scene, cam);
    this.captureSection = null;
    this.sectionDirty = true;
    for (const m of tinted) m.material = m.userData.selMat;
    const src = this.renderer.domElement;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(src, 0, 0, w, h);
    // restore
    this.renderer.setPixelRatio(prevRatio);
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    this.overlay.visible = overlayVis;
    this.grid.mesh.visible = gridVis;
    this.ghosts.visible = ghostVis;
    this.invalidate();
    // labels: element ids for grounding
    ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const project = this.editor.project;
    for (const e of this.editor.level.elements) {
      if (e.hidden) continue;
      if (e.type === 'shape' && e.role === 'solid' && !e.tags.length) continue;
      const b = worldBounds(e, project);
      const c = b.getCenter(new THREE.Vector3());
      c.y = e.type === 'marker' || e.type === 'note' ? b.max.y + 0.3 : Math.min(b.max.y, c.y + 2);
      const v = c.project(cam);
      if (v.z > 1) continue;
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      const text = e.id;
      const tw = ctx.measureText(text).width;
      const col = e.tags[0] ? this.editor.tagColor(e.tags[0]) : e.role === 'cut' ? COLORS.cut : '#cfd8dc';
      ctx.fillStyle = 'rgba(20,22,27,0.82)';
      roundRect(ctx, x - tw / 2 - 8, y - 10, tw + 16, 20, 6);
      ctx.fill();
      ctx.fillStyle = col;
      ctx.fillRect(x - tw / 2 - 4, y - 3, 6, 6);
      ctx.fillStyle = '#f1f3f5';
      ctx.fillText(text, x - tw / 2 + 5, y + 0.5);
    }
    // legend
    ctx.fillStyle = 'rgba(20,22,27,0.85)';
    roundRect(ctx, 12, 12, 330, kind === 'top' ? 52 : 34, 8);
    ctx.fill();
    ctx.fillStyle = '#e9ecef';
    ctx.font = '600 14px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(opts.title ?? `${this.editor.level.name} — ${kind === 'top' ? 'top view (north = -Z up)' : `3D view from yaw ${yawDeg}°`}`, 24, 29);
    if (kind === 'top') {
      // scale bar 10 m
      const o = cam as THREE.OrthographicCamera;
      const pxPerM = w / (o.right - o.left);
      ctx.fillStyle = '#e9ecef';
      ctx.fillRect(24, 46, pxPerM * 10, 4);
      ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText('10 m · grid 1 m · +X →', 30 + pxPerM * 10, 48);
    }
    return canvas.toDataURL('image/png');
  }

  // ------------------------------------------------------------------ input
  private bindInput() {
    const el = this.renderer.domElement;
    const on = <K extends keyof HTMLElementEventMap>(t: EventTarget, type: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn, opts);
      this.disposers.push(() => t.removeEventListener(type, fn, opts));
    };
    const rel = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    on(el, 'contextmenu', (e: Event) => e.preventDefault());

    on(el, 'pointerdown', (e: PointerEvent) => {
      if (this.editor.walking) return;
      el.focus({ preventScroll: true });
      const { x, y } = rel(e);
      const planMode = this.rig.mode === 'plan';
      if (e.button === 2 || e.button === 1 || (e.button === 0 && this.spaceDown)) {
        const pan = e.button === 1 || (e.button === 0 && this.spaceDown) || (e.button === 2 && (planMode || e.shiftKey));
        this.camDrag = { mode: pan ? 'pan' : 'orbit', x: e.clientX, y: e.clientY, moved: false };
        if (!pan) {
          const h = this.pickElement(x, y) ?? null;
          const p = h?.point ?? this.planeHit(x, y, new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.editor.planeY));
          if (p && p.distanceTo(this.rig.persp.position) < 1500) this.rig.repivot(p);
        }
        el.setPointerCapture(e.pointerId);
        this.container.classList.add(pan ? 'panning' : 'orbiting');
        e.preventDefault();
        return;
      }
      if (e.button === 0) {
        el.setPointerCapture(e.pointerId);
        this.tools.pointer('down', e, x, y);
      }
    });
    on(el, 'pointermove', (e: PointerEvent) => {
      if (this.editor.walking) return;
      const { x, y } = rel(e);
      if (this.camDrag) {
        const dx = e.clientX - this.camDrag.x, dy = e.clientY - this.camDrag.y;
        this.camDrag.x = e.clientX;
        this.camDrag.y = e.clientY;
        if (Math.abs(dx) + Math.abs(dy) > 0) this.camDrag.moved = true;
        if (this.camDrag.mode === 'orbit') this.rig.orbit(dx, dy);
        else this.rig.pan(dx, dy, this.height);
        return;
      }
      this.tools.pointer(e.buttons & 1 ? 'move' : 'hover', e, x, y);
    });
    const up = (e: PointerEvent) => {
      if (this.editor.walking) return;
      const { x, y } = rel(e);
      if (this.camDrag) {
        this.camDrag = null;
        this.flyKeys.clear();
        this.container.classList.remove('panning', 'orbiting');
        return;
      }
      if (e.button === 0) this.tools.pointer('up', e, x, y);
    };
    on(el, 'pointerup', up);
    on(el, 'pointercancel', up);
    on(el, 'pointerleave', () => {
      if (!this.camDrag) this.tools.leave();
    });
    on(el, 'dblclick', (e: MouseEvent) => {
      const { x, y } = rel(e);
      this.tools.dblclick(e, x, y);
    });

    on(
      el,
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();
        if (this.editor.walking) return;
        const { x, y } = rel(e);
        const trackpad = this.isTrackpad(e);
        if (e.ctrlKey || e.metaKey) {
          // pinch zoom (trackpad) or ctrl+wheel
          const f = Math.exp(e.deltaY * (trackpad ? 0.012 : 0.0025));
          this.zoomAt(x, y, f);
          return;
        }
        if (trackpad) {
          if (e.shiftKey || this.rig.mode === 'plan') this.rig.pan(-e.deltaX, -e.deltaY, this.height);
          else this.rig.orbit(-e.deltaX * 0.9, -e.deltaY * 0.9);
          return;
        }
        const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
        this.zoomAt(x, y, Math.exp(dy * 0.0016));
      },
      { passive: false }
    );
    // Safari pinch
    let gScale = 1;
    on(el, 'gesturestart', (e: any) => {
      e.preventDefault();
      gScale = e.scale;
    });
    on(el, 'gesturechange', (e: any) => {
      e.preventDefault();
      const f = gScale / e.scale;
      gScale = e.scale;
      const r = el.getBoundingClientRect();
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, f);
    });

    on(window, 'keydown', (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.code === 'Space' && !this.editor.walking) {
        this.spaceDown = true;
        this.container.classList.add('can-pan');
        e.preventDefault();
      }
      if (this.camDrag && this.camDrag.mode === 'orbit') {
        const k = e.key.toLowerCase();
        if ('wasdqe'.includes(k) && k.length === 1) {
          this.flyKeys.add(k);
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      }
    }, { capture: true });
    on(window, 'keyup', (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        this.spaceDown = false;
        this.container.classList.remove('can-pan');
      }
      this.flyKeys.delete(e.key.toLowerCase());
    });
    on(window, 'blur', () => {
      this.spaceDown = false;
      this.flyKeys.clear();
    });
  }

  get flying() {
    return !!this.camDrag;
  }

  private isTrackpad(e: WheelEvent) {
    const mode = this.editor.inputMode;
    if (mode !== 'auto') return mode === 'trackpad';
    const now = performance.now();
    if (e.deltaMode !== 0) return false;
    if (e.deltaX !== 0 || !Number.isInteger(e.deltaY)) {
      this.lastTrackpad = now;
      return true;
    }
    if (now - this.lastTrackpad < 350) {
      this.lastTrackpad = now;
      return true;
    }
    return Math.abs(e.deltaY) < 30;
  }

  zoomAt(x: number, y: number, factor: number) {
    let p: THREE.Vector3 | null = null;
    if (this.rig.mode === 'plan') {
      p = this.planeHit(x, y, new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.rig.s.target.y));
    } else {
      p = this.pickElement(x, y)?.point ?? this.planeHit(x, y, new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.editor.planeY));
      if (p && p.distanceTo(this.rig.persp.position) > this.rig.s.distance * 6) p = null;
    }
    this.rig.zoom(factor, p ?? undefined);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function isTyping(e: Event) {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

const STENCIL_BACK = new THREE.MeshBasicMaterial({
  side: THREE.BackSide,
  colorWrite: false,
  depthWrite: false,
  depthTest: false,
  stencilWrite: true,
  stencilFunc: THREE.AlwaysStencilFunc,
  stencilFail: THREE.IncrementWrapStencilOp,
  stencilZFail: THREE.IncrementWrapStencilOp,
  stencilZPass: THREE.IncrementWrapStencilOp
});
const STENCIL_FRONT = new THREE.MeshBasicMaterial({
  side: THREE.FrontSide,
  colorWrite: false,
  depthWrite: false,
  depthTest: false,
  stencilWrite: true,
  stencilFunc: THREE.AlwaysStencilFunc,
  stencilFail: THREE.DecrementWrapStencilOp,
  stencilZFail: THREE.DecrementWrapStencilOp,
  stencilZPass: THREE.DecrementWrapStencilOp
});
let capMat: THREE.MeshBasicMaterial | null = null;
/** hatched "cut" material, only drawn where the stencil says we're inside a solid */
function CAP_MATERIAL() {
  if (capMat) return capMat;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#7d8696';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#5d6573';
  g.lineWidth = 6;
  for (let i = -64; i <= 128; i += 21) {
    g.beginPath();
    g.moveTo(i, 64);
    g.lineTo(i + 64, 0);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4000 / 1.5, 4000 / 1.5);
  tex.colorSpace = THREE.SRGBColorSpace;
  capMat = new THREE.MeshBasicMaterial({
    map: tex,
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilRef: 0,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp,
    stencilZFail: THREE.ReplaceStencilOp,
    stencilZPass: THREE.ReplaceStencilOp
  });
  return capMat;
}
