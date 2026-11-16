import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import type { Level, Project } from '$lib/model/types';
import { flatten, matrixOf } from '$lib/model/space';
import { shapeGeometry, subtract } from '$lib/engine/geometry';

/** Headless (no DOM) world-space collision mesh for a level: solids minus cuts. */
export function buildCollision(level: Level, project: Project) {
  const els = flatten(level, project).filter((e) => !e.hidden);
  const cuts = els
    .filter((e) => e.type === 'shape' && e.role === 'cut')
    .map((e) => {
      const g = shapeGeometry((e as any).shape, { stepHeight: project.character.stepHeight });
      g.computeBoundingBox();
      const m = matrixOf(e.transform);
      return { geometry: g, matrix: m, box: g.boundingBox!.clone().applyMatrix4(m) };
    });
  const parts: THREE.BufferGeometry[] = [];
  for (const e of els) {
    if (e.type !== 'shape' || e.role !== 'solid') continue;
    let g = shapeGeometry(e.shape, { stepHeight: project.character.stepHeight });
    g.computeBoundingBox();
    const m = matrixOf(e.transform);
    const wb = g.boundingBox!.clone().applyMatrix4(m);
    const hits = cuts.filter((c) => c.box.intersectsBox(wb));
    if (hits.length) {
      const inv = m.clone().invert();
      try {
        g = subtract(g, hits.map((c) => ({ geometry: c.geometry, matrix: inv.clone().multiply(c.matrix) })));
      } catch {}
    }
    const p = new THREE.BufferGeometry();
    p.setAttribute('position', (g.index ? g.toNonIndexed() : g).getAttribute('position').clone());
    p.applyMatrix4(m);
    parts.push(p);
  }
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false)!;
  (merged as any).boundsTree = new MeshBVH(merged);
  return merged;
}
