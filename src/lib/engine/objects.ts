import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { LevelElement, Project } from '$lib/model/types';
import { expandStamp, matrixOf, proxySize } from '$lib/model/space';
import { arrowGeometry, cleanEdges, pathCurvePoints, ribbonGeometry, shapeGeometry } from './geometry';
import { COLORS, dashedMaterial, flatMaterial, lineMaterial, mix, solidMaterial, translucentMaterial } from './materials';

export interface EdgeRef {
  line: THREE.LineSegments | THREE.Line;
  base: THREE.Material;
}

export interface Built {
  id: string;
  el: LevelElement;
  root: THREE.Group;
  pickables: THREE.Object3D[];
  edges: EdgeRef[];
  /** solids: meshes whose geometry may be replaced by CSG */
  solids: { mesh: THREE.Mesh; base: THREE.BufferGeometry; edge: THREE.LineSegments; el: LevelElement }[];
  /** cutters provided by this element (world matrices) */
  cuts: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; box: THREE.Box3 }[];
  labels: CSS2DObject[];
}

const markerMats = new Map<string, THREE.Material>();
function markerMaterial(color: string, opacity = 0.92) {
  const k = color + opacity;
  if (!markerMats.has(k)) {
    markerMats.set(
      k,
      new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.6, emissive: new THREE.Color(color).multiplyScalar(0.18), transparent: opacity < 1, opacity })
    );
  }
  return markerMats.get(k)!;
}
const pickMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false, side: THREE.DoubleSide });

function edgesOf(geom: THREE.BufferGeometry, mat: THREE.Material, angle = 28) {
  const e = new THREE.LineSegments(cleanEdges(geom, angle), mat);
  e.raycast = () => {};
  return e;
}

function tagInfo(e: LevelElement, project: Project) {
  const tag = e.tags.find((t) => project.tags[t]) ?? e.tags[0];
  const def = tag ? project.tags[tag] : undefined;
  return { tag, def, color: def?.color ?? (tag ? '#9e9e9e' : COLORS.solid) };
}

export function makeLabel(text: string, cls: string, color?: string) {
  const div = document.createElement('div');
  div.className = 'lbl ' + cls;
  if (color) div.style.setProperty('--c', color);
  div.textContent = text;
  const o = new CSS2DObject(div);
  return o;
}

export function buildElement(e: LevelElement, project: Project, opts: { ghost?: string; labels?: boolean } = {}): Built {
  const b: Built = { id: e.id, el: e, root: new THREE.Group(), pickables: [], edges: [], solids: [], cuts: [], labels: [] };
  b.root.userData.elementId = e.id;
  if (e.type === 'stamp') {
    for (const part of expandStamp(e, project)) {
      const sub = buildElement(part, project, { ...opts, labels: false });
      sub.root.traverse((o) => {
        if (o.userData.elementId) o.userData.elementId = e.id;
      });
      b.root.add(sub.root);
      b.pickables.push(...sub.pickables);
      b.edges.push(...sub.edges);
      b.solids.push(...sub.solids);
      b.cuts.push(...sub.cuts);
      b.labels.push(...sub.labels);
    }
    if (opts.labels !== false && !opts.ghost) {
      const l = makeLabel(project.stamps[e.stamp]?.name ?? e.stamp, 'stamp');
      l.position.set(...e.transform.position);
      l.position.y += 2.6;
      b.root.add(l);
      b.labels.push(l);
    }
    tagPick(b, e.id);
    return b;
  }

  const m = matrixOf(e.transform);
  b.root.matrixAutoUpdate = false;
  b.root.matrix.copy(m);
  b.root.matrixWorldNeedsUpdate = true;
  const ghost = opts.ghost;
  const { tag, def, color } = tagInfo(e, project);

  if (e.type === 'shape') {
    const geom = shapeGeometry(e.shape, { stepHeight: project.character.stepHeight });
    geom.computeBoundingBox();
    if (ghost) {
      const mesh = new THREE.Mesh(geom, translucentMaterial(ghost, 0.16));
      const edge = edgesOf(geom, dashedMaterial(ghost, 0.3, 0.2));
      edge.computeLineDistances();
      b.root.add(mesh, edge);
      return b;
    }
    if (e.role === 'solid') {
      const c = tag ? mix(color, COLORS.solid, 0.35) : COLORS.solid;
      const mesh = new THREE.Mesh(geom, solidMaterial(c));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const edgeMat = lineMaterial(COLORS.edge, 0.9);
      const edge = edgesOf(geom, edgeMat);
      b.root.add(mesh, edge);
      b.pickables.push(mesh);
      b.edges.push({ line: edge, base: edgeMat });
      b.solids.push({ mesh, base: geom, edge, el: e });
      mesh.userData.solid = true;
      mesh.userData.baseMat = mesh.material;
      mesh.userData.selMat = solidMaterial(mix(c, COLORS.accent, 0.38));
    } else if (e.role === 'cut') {
      const mesh = new THREE.Mesh(geom, translucentMaterial(COLORS.cut, 0.14));
      const edgeMat = dashedMaterial(COLORS.cut, 0.25, 0.15);
      const edge = edgesOf(geom, edgeMat);
      edge.computeLineDistances();
      mesh.renderOrder = 2;
      b.root.add(mesh, edge);
      b.pickables.push(mesh);
      b.edges.push({ line: edge, base: edgeMat });
      b.root.updateMatrixWorld(true);
      const box = geom.boundingBox!.clone().applyMatrix4(m);
      b.cuts.push({ geometry: geom, matrix: m.clone(), box });
    } else {
      const flat = (e.shape.kind === 'extrude' ? e.shape.height ?? 0 : e.shape.size?.[1] ?? 0) <= 0.001 && !e.shape.infinite;
      const op = e.role === 'guide' ? 0.06 : flat ? 0.4 : e.shape.infinite ? 0.1 : 0.2;
      const mesh = new THREE.Mesh(geom, flat ? flatMaterial(color, op) : translucentMaterial(color, op));
      mesh.renderOrder = 3;
      if (flat) mesh.position.y = 0.03;
      const edgeMat = e.role === 'guide' ? dashedMaterial(color) : lineMaterial(color, 0.95);
      const edge = edgesOf(geom, edgeMat, 10);
      if (flat) edge.position.y = 0.03;
      if (e.role === 'guide') edge.computeLineDistances();
      b.root.add(mesh, edge);
      b.pickables.push(mesh);
      b.edges.push({ line: edge, base: edgeMat });
      if (opts.labels !== false && tag) {
        const bb = geom.boundingBox!;
        const l = makeLabel('#' + tag, 'zone', color);
        l.position.set((bb.min.x + bb.max.x) / 2, Math.min(bb.max.y, 8) + 0.2, (bb.min.z + bb.max.z) / 2);
        b.root.add(l);
        b.labels.push(l);
      }
    }
  } else if (e.type === 'path') {
    const pcolor = tag ? color : '#e0e0e0';
    if (e.path.points.length >= 2) {
      const { geometry, left, right, center } = ribbonGeometry(e.path, 0.05);
      if (e.role === 'guide') {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(center.map((p) => p.clone().setY(p.y + 0.08))), dashedMaterial(ghost ?? pcolor, 0.5, 0.3));
        line.computeLineDistances();
        line.raycast = () => {};
        b.root.add(line);
        b.edges.push({ line, base: line.material as THREE.Material });
        // direction arrows
        const total = center.length;
        for (let i = 4; i < total - 1; i += 8) {
          const a = center[i], n = center[i + 1];
          const arrow = new THREE.Mesh(arrowGeometry(0.6, 0.45), flatMaterial(pcolor, 0.9));
          arrow.position.copy(a).setY(a.y + 0.08);
          arrow.rotation.y = Math.atan2(n.x - a.x, n.z - a.z);
          arrow.raycast = () => {};
          b.root.add(arrow);
        }
        const pick = new THREE.Mesh(ribbonGeometry({ ...e.path, width: Math.max(0.8, e.path.width * 0.3) }, 0.06).geometry, pickMat);
        b.root.add(pick);
        b.pickables.push(pick);
      } else {
        const mesh = new THREE.Mesh(geometry, ghost ? translucentMaterial(ghost, 0.2) : flatMaterial(pcolor, 0.72));
        mesh.renderOrder = 4;
        b.root.add(mesh);
        if (!ghost) b.pickables.push(mesh);
        const edgeMat = lineMaterial(ghost ?? mix(pcolor, '#000000', 0.25), 1);
        for (const side of [left, right]) {
          const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(side), edgeMat);
          l.raycast = () => {};
          b.root.add(l);
          b.edges.push({ line: l, base: edgeMat });
        }
      }
    } else if (e.path.points.length === 1) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.2), flatMaterial(pcolor));
      dot.position.set(...e.path.points[0]);
      b.root.add(dot);
      b.pickables.push(dot);
    }
    if (opts.labels !== false && tag && !ghost && e.path.points.length >= 2) {
      const pts = pathCurvePoints(e.path);
      const mid = pts[Math.floor(pts.length / 2)];
      const l = makeLabel('#' + tag, 'zone', pcolor);
      l.position.copy(mid).setY(mid.y + 0.4);
      b.root.add(l);
      b.labels.push(l);
    }
  } else if (e.type === 'marker') {
    const [sx, sy, sz] = proxySize(e, project);
    const tall = sy > 1.2 && (def?.category === 'actor' || def?.category === 'point');
    let geom: THREE.BufferGeometry;
    if (!tag) {
      geom = new THREE.OctahedronGeometry(0.35);
      geom.translate(0, 0.35, 0);
    } else if (tall) {
      const r = Math.min(sx, sz) / 2;
      geom = new THREE.CapsuleGeometry(r, Math.max(0.01, sy - 2 * r), 6, 14);
      geom.translate(0, sy / 2, 0);
    } else {
      geom = new THREE.BoxGeometry(sx, sy, sz);
      geom.translate(0, sy / 2, 0);
    }
    const mcol = ghost ?? (tag ? color : '#bdbdbd');
    const mesh = new THREE.Mesh(geom, ghost ? translucentMaterial(ghost, 0.2) : markerMaterial(mcol));
    mesh.castShadow = !ghost;
    if (!ghost) {
      mesh.userData.baseMat = mesh.material;
      mesh.userData.selMat = markerMaterial(mix(mcol, COLORS.accent, 0.45));
    }
    const edgeMat = ghost ? dashedMaterial(ghost) : lineMaterial(mix(mcol, '#000000', 0.45), 1);
    const edge = edgesOf(geom, edgeMat, 40);
    if (ghost) edge.computeLineDistances();
    b.root.add(mesh, edge);
    if (!ghost) b.pickables.push(mesh);
    b.edges.push({ line: edge, base: edgeMat });
    // facing arrow on the ground
    const arrow = new THREE.Mesh(arrowGeometry(0.55, 0.5), flatMaterial(mcol, 0.95));
    arrow.position.set(0, 0.035, sz / 2 + 0.08);
    arrow.raycast = () => {};
    b.root.add(arrow);
    if (tall || def?.needsFacing) {
      // nose: little bar on the front face to read facing in 3D
      const nose = new THREE.Mesh(new THREE.BoxGeometry(Math.min(sx, 0.3), 0.08, 0.14), flatMaterial(mix(mcol, '#ffffff', 0.5)));
      nose.position.set(0, sy * 0.82, sz / 2 + 0.03);
      nose.raycast = () => {};
      b.root.add(nose);
    }
    if (e.marker.radius > 0) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(e.marker.radius, 48).rotateX(-Math.PI / 2), flatMaterial(mcol, 0.12));
      disc.position.y = 0.025;
      const ring = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(
          Array.from({ length: 64 }, (_, i) => new THREE.Vector3(Math.cos((i / 64) * Math.PI * 2) * e.marker.radius, 0.04, Math.sin((i / 64) * Math.PI * 2) * e.marker.radius))
        ),
        lineMaterial(mcol, 0.9)
      );
      ring.raycast = () => {};
      b.root.add(disc, ring);
      b.pickables.push(disc);
    }
    if (opts.labels !== false && !ghost) {
      const l = makeLabel(e.name || e.id, 'marker', mcol);
      l.position.set(0, sy + 0.35, 0);
      b.root.add(l);
      b.labels.push(l);
    }
  } else if (e.type === 'note') {
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), markerMaterial('#ffd54f'));
    pin.position.y = 0.18;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6), flatMaterial('#ffd54f'));
    stick.position.y = -0.12;
    stick.raycast = () => {};
    b.root.add(pin, stick);
    if (!ghost) b.pickables.push(pin);
    if (opts.labels !== false && !ghost) {
      const l = makeLabel(e.notes || 'Note', 'note');
      l.position.set(0, 0.5, 0);
      (l.element as HTMLElement).dataset.id = e.id;
      b.root.add(l);
      b.labels.push(l);
    }
  }
  tagPick(b, e.id);
  return b;
}

function tagPick(b: Built, id: string) {
  for (const p of b.pickables) p.userData.elementId = id;
}
