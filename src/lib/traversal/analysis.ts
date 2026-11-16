import * as THREE from 'three';
import type { MeshBVH } from 'three-mesh-bvh';
import type { LevelElement, Project, Vec3 } from '$lib/model/types';
import { classify, reach, tierRank, TIER_ORDER, type Tier } from '$lib/model/physics';
import { localBounds, matrixOf } from '$lib/model/space';
import { footprint } from '$lib/model/shapes';
import type { AnalysisReport, JumpFinding } from '$lib/model/brief';

export interface AnalysisResult {
  cellSize: number;
  /** x, y, z per cell */
  pos: Float32Array;
  /** min tier rank needed from spawn; 255 = unreachable */
  rank: Uint8Array;
  /** 1 = you can get back to spawn from here */
  back: Uint8Array;
  jumps: JumpFinding[];
  report: AnalysisReport;
  hasSpawn: boolean;
}

const BLOCKING_ZONES = new Set(['hazard', 'no-go', 'kill-volume', 'lava']);
const OBJECTIVES = new Set(['goal', 'chest', 'pickup', 'key', 'checkpoint', 'lever', 'door', 'npc', 'boss']);

export function pointInElement(e: LevelElement, p: THREE.Vector3, project: Project, pad = 0.5) {
  const l = p.clone().applyMatrix4(matrixOf(e.transform).invert());
  if (e.type === 'marker') return e.marker.radius > 0 && Math.hypot(l.x, l.z) <= e.marker.radius && Math.abs(l.y) < 3;
  if (e.type !== 'shape') return false;
  const s = e.shape;
  const b = localBounds(e, project);
  const flat = b.max.y <= 0.03;
  const y0 = flat ? -pad : b.min.y, y1 = s.infinite ? 1e6 : flat ? pad + 1 : b.max.y;
  if (l.y < y0 || l.y > y1) return false;
  if (s.kind === 'extrude' || s.kind === 'prism') return pointInPoly(l.x, l.z, footprint(s) ?? []);
  if (s.kind === 'cylinder' || s.kind === 'blob') {
    const [sx, , sz] = s.size!;
    return (l.x / (sx / 2)) ** 2 + (l.z / (sz / 2)) ** 2 <= 1;
  }
  return l.x >= b.min.x && l.x <= b.max.x && l.z >= b.min.z && l.z <= b.max.z;
}

function pointInPoly(x: number, z: number, pts: [number, number][]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

export async function analyze(geom: THREE.BufferGeometry, elements: LevelElement[], project: Project, onProgress?: (f: number) => void): Promise<AnalysisResult> {
  const c = project.character;
  const bvh = (geom as any).boundsTree as MeshBVH;
  geom.computeBoundingBox();
  const bb = geom.boundingBox!;
  const sizeX = bb.max.x - bb.min.x, sizeZ = bb.max.z - bb.min.z;
  const cs = Math.max(0.5, Math.sqrt((sizeX * sizeZ) / 60000));
  const cosSlope = Math.cos((c.maxSlope * Math.PI) / 180);
  const nx = Math.ceil(sizeX / cs), nz = Math.ceil(sizeZ / cs);
  const top = bb.max.y + 5;

  // ---------------------------------------------------------------- 1. sample walkable surfaces
  const xs: number[] = [], ys: number[] = [], zs: number[] = [];
  const columns = new Map<number, number[]>(); // column index → cell ids
  const colOf: number[] = [];
  const ray = new THREE.Ray();
  const down = new THREE.Vector3(0, -1, 0);
  const hazards = elements.filter((e) => e.type === 'shape' || e.type === 'marker').filter((e) => e.tags.some((t) => BLOCKING_ZONES.has(t)) && (e.role === 'zone' || e.type === 'marker'));
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const x = bb.min.x + (ix + 0.5) * cs, z = bb.min.z + (iz + 0.5) * cs;
      ray.origin.set(x, top, z);
      ray.direction.copy(down);
      // sort top-down; at coincident heights put down-facing faces (solid bottoms) first so a floor
      // that sits under another solid sees zero headroom
      const hits = bvh
        .raycast(ray, THREE.DoubleSide)
        .sort((a, b) => (Math.abs(a.distance - b.distance) < 0.01 ? a.face!.normal.y - b.face!.normal.y : a.distance - b.distance));
      let ceiling = Infinity;
      for (const h of hits) {
        const y = h.point.y;
        const n = h.face!.normal;
        if (n.y >= cosSlope && ceiling - y >= c.height - 0.05) {
          const p = new THREE.Vector3(x, y, z);
          if (!hazards.some((hz) => pointInElement(hz, p, project))) {
            const id = xs.length;
            xs.push(x);
            ys.push(y);
            zs.push(z);
            const col = ix * nz + iz;
            colOf.push(col);
            if (!columns.has(col)) columns.set(col, []);
            columns.get(col)!.push(id);
          }
        }
        ceiling = y;
      }
    }
    if (ix % 40 === 0) {
      onProgress?.((ix / nx) * 0.4);
      await tick();
    }
  }
  const N = xs.length;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = xs[i];
    pos[i * 3 + 1] = ys[i];
    pos[i * 3 + 2] = zs[i];
  }

  // ---------------------------------------------------------------- 2. walk / drop links
  const slopeAllow = cs * Math.tan((c.maxSlope * Math.PI) / 180) + 0.02;
  const stepMax = Math.max(c.stepHeight, slopeAllow);
  const walk: number[][] = Array.from({ length: N }, () => []);
  const drops: number[][] = Array.from({ length: N }, () => []);
  const dropsRev: number[][] = Array.from({ length: N }, () => []);
  const edge = new Uint8Array(N);
  const blocked = (ax: number, ay: number, az: number, bx: number, bz: number, y: number) => {
    ray.origin.set(ax, y, az);
    const dir = new THREE.Vector3(bx - ax, 0, bz - az);
    const len = dir.length();
    ray.direction.copy(dir.normalize());
    const h = bvh.raycastFirst(ray, THREE.DoubleSide);
    return !!h && h.distance < len;
  };
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let i = 0; i < N; i++) {
    const col = colOf[i];
    const ix = Math.floor(col / nz), iz = col % nz;
    let open = 0;
    for (const [dx, dz] of dirs) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
      const list = columns.get(jx * nz + jz);
      if (!list) continue;
      let best = -1, bestDy = Infinity, dropTo = -1, dropY = -Infinity;
      for (const j of list) {
        const dy = ys[j] - ys[i];
        if (Math.abs(dy) <= stepMax * (dx && dz ? 1.42 : 1) && Math.abs(dy) < Math.abs(bestDy)) {
          best = j;
          bestDy = dy;
        } else if (dy < -stepMax && ys[j] > dropY) {
          dropTo = j;
          dropY = ys[j];
        }
      }
      const knee = Math.max(ys[i], best >= 0 ? ys[best] : ys[i]) + c.stepHeight + 0.08;
      if (best >= 0 && !blocked(xs[i], ys[i], zs[i], xs[best], zs[best], knee)) {
        walk[i].push(best);
        open++;
      } else if (best < 0 && dropTo >= 0 && !blocked(xs[i], ys[i], zs[i], xs[dropTo], zs[dropTo], ys[i] + c.stepHeight + 0.08)) {
        drops[i].push(dropTo);
        dropsRev[dropTo].push(i);
      }
    }
    if (open < 8) edge[i] = 1;
    if (i % 5000 === 0) {
      onProgress?.(0.4 + (i / N) * 0.2);
      await tick();
    }
  }

  // ---------------------------------------------------------------- 3. spatial hash of edge cells
  const maxReach = reach(c, -c.height, c.sprintSpeed, 1 + c.extraJumps, c.dashDistance) + cs;
  const B = Math.max(2, maxReach / 3);
  const hash = new Map<string, number[]>();
  for (let i = 0; i < N; i++) {
    if (!edge[i]) continue;
    const k = Math.floor(xs[i] / B) + ',' + Math.floor(zs[i] / B);
    if (!hash.has(k)) hash.set(k, []);
    hash.get(k)!.push(i);
  }
  const candidates = (i: number) => {
    const out: number[] = [];
    const bx = Math.floor(xs[i] / B), bz = Math.floor(zs[i] / B);
    const r = Math.ceil(maxReach / B);
    for (let a = -r; a <= r; a++)
      for (let b = -r; b <= r; b++) {
        const l = hash.get(bx + a + ',' + (bz + b));
        if (l) for (const j of l) out.push(j);
      }
    return out;
  };
  const arcClear = (a: number, b: number) => {
    const ax = xs[a], ay = ys[a] + c.height * 0.55, az = zs[a];
    const bx = xs[b], by = ys[b] + c.height * 0.55, bz = zs[b];
    const peak = Math.max(ay, by) + Math.min(c.jumpHeight, 0.6);
    let px = ax, py = ay, pz = az;
    const S = 6;
    for (let k = 1; k <= S; k++) {
      const t = k / S;
      const qx = ax + (bx - ax) * t, qz = az + (bz - az) * t;
      const qy = ay + (by - ay) * t + 4 * t * (1 - t) * (peak - (ay + by) / 2);
      const dir = new THREE.Vector3(qx - px, qy - py, qz - pz);
      const len = dir.length();
      ray.origin.set(px, py, pz);
      ray.direction.copy(dir.normalize());
      const h = bvh.raycastFirst(ray, THREE.DoubleSide);
      if (h && h.distance < len) return false;
      px = qx;
      py = qy;
      pz = qz;
    }
    return true;
  };
  const jumpTier = (a: number, b: number): { tier: Tier; gap: number; dh: number; margin: number } | null => {
    const dist = Math.hypot(xs[b] - xs[a], zs[b] - zs[a]);
    if (dist < cs * 1.6) return null;
    const gap = Math.max(0, dist - cs);
    const dh = ys[b] - ys[a];
    const cl = classify(c, gap, dh);
    if (cl.tier === 'impossible' || cl.tier === 'walk') return null;
    return { tier: cl.tier, gap, dh, margin: cl.margin };
  };

  // ---------------------------------------------------------------- 4. forward search (minimax tier) from spawns
  const spawns = elements.filter((e) => e.type === 'marker' && e.tags.includes('spawn'));
  const nearestCell = (p: Vec3, up = 0.6, downTol = 2) => {
    let best = -1, bd = Infinity;
    for (let i = 0; i < N; i++) {
      const dx = xs[i] - p[0], dz = zs[i] - p[2];
      const dy = ys[i] - p[1];
      if (dy > up || dy < -downTol) continue;
      const d = dx * dx + dz * dz + dy * dy * 0.25;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return bd < 2.5 * 2.5 ? best : -1;
  };
  const rank = new Uint8Array(N).fill(255);
  const parent = new Int32Array(N).fill(-1);
  const viaJump: (Tier | null)[] = new Array(N).fill(null);
  const starts = spawns.map((s) => nearestCell(s.transform.position)).filter((i) => i >= 0);
  const hasSpawn = starts.length > 0;
  if (!hasSpawn) rank.fill(0);
  const buckets: number[][] = TIER_ORDER.map(() => []);
  for (const s of starts) {
    rank[s] = 0;
    buckets[0].push(s);
  }
  const found: JumpFinding[] = [];
  let processed = 0;
  for (let r = 0; r < buckets.length && hasSpawn; r++) {
    const q = buckets[r];
    while (q.length) {
      const i = q.pop()!;
      if (rank[i] !== r) continue;
      for (const j of walk[i]) if (rank[j] > r) ((rank[j] = r), (parent[j] = i), q.push(j));
      for (const j of drops[i]) if (rank[j] > r) ((rank[j] = r), (parent[j] = i), q.push(j));
      if (edge[i]) {
        for (const j of candidates(i)) {
          if (rank[j] <= r) continue;
          const jt = jumpTier(i, j);
          if (!jt) continue;
          const nr = jt.tier === 'drop' ? r : Math.max(r, tierRank(jt.tier));
          if (nr >= rank[j]) continue;
          if (!arcClear(i, j)) continue;
          rank[j] = nr;
          parent[j] = i;
          viaJump[j] = jt.tier;
          buckets[nr].push(j);
        }
      }
      if (++processed % 3000 === 0) {
        onProgress?.(0.6 + Math.min(0.25, processed / N / 4));
        await tick();
      }
    }
  }

  // ---------------------------------------------------------------- 5. reverse search: can you get back to spawn?
  const back = new Uint8Array(N);
  if (hasSpawn) {
    const q = [...starts];
    for (const s of starts) back[s] = 1;
    while (q.length) {
      const b = q.pop()!;
      for (const a of walk[b]) if (!back[a]) ((back[a] = 1), q.push(a));
      for (const a of dropsRev[b]) if (!back[a]) ((back[a] = 1), q.push(a));
      if (edge[b]) {
        for (const a of candidates(b)) {
          if (back[a]) continue;
          const jt = jumpTier(a, b);
          if (!jt) continue;
          if (!arcClear(a, b)) continue;
          back[a] = 1;
          q.push(a);
        }
      }
      if (++processed % 3000 === 0) await tick();
    }
  } else back.fill(1);

  // ---------------------------------------------------------------- 6. report
  const area = cs * cs;
  const areaByTier: Partial<Record<Tier, number>> = {};
  let reachable = 0, oneWay = 0;
  for (let i = 0; i < N; i++) {
    if (rank[i] === 255) continue;
    reachable++;
    const t = TIER_ORDER[rank[i]];
    areaByTier[t] = (areaByTier[t] ?? 0) + area;
    if (!back[i]) oneWay++;
  }
  // jumps that were needed to first reach something, clustered
  const clusters = new Map<string, JumpFinding>();
  for (let j = 0; j < N; j++) {
    const t = viaJump[j];
    if (!t || t === 'drop') continue;
    const i = parent[j];
    if (i < 0) continue;
    const jt = jumpTier(i, j);
    if (!jt) continue;
    const key = [xs[i], zs[i], xs[j], zs[j]].map((v) => Math.round(v / 2.5)).join(',') + ',' + Math.round(ys[j] - ys[i]);
    const f: JumpFinding = { from: [xs[i], ys[i], zs[i]], to: [xs[j], ys[j], zs[j]], gap: jt.gap, dh: jt.dh, tier: jt.tier, margin: jt.margin };
    const prev = clusters.get(key);
    if (!prev || f.margin < prev.margin) clusters.set(key, f);
  }
  for (const f of clusters.values()) found.push(f);
  found.sort((a, b) => b.margin - a.margin);
  const tight = found.filter((f) => f.margin >= project.traversal.tightMargin);
  const trivial = found.filter((f) => f.margin < project.traversal.trivialMargin).length;

  const objectives: AnalysisReport['objectives'] = [];
  for (const e of elements) {
    if (e.type !== 'marker') continue;
    const tag = e.tags.find((t) => OBJECTIVE_TAGS(t));
    if (!tag) continue;
    const i = nearestCell(e.transform.position, 1.0, 2.5);
    const ok = i >= 0 && rank[i] !== 255;
    objectives.push({ id: e.id, tag, reachable: ok, tier: ok ? TIER_ORDER[rank[i]] : null });
  }
  const warnings: string[] = [];
  if (!hasSpawn) warnings.push(spawns.length ? 'The #spawn marker is not standing on a walkable surface.' : 'No #spawn marker — place one to check reachability. Showing walkable surfaces only.');
  for (const o of objectives) if (!o.reachable) warnings.push(`${o.id} (#${o.tag}) cannot be reached from spawn.`);
  if (hasSpawn && oneWay * area > 4) warnings.push(`${Math.round(oneWay * area)} m² can be reached but not left back to spawn (one-way drops). Make sure that's intended.`);

  onProgress?.(1);
  const report: AnalysisReport = {
    time: new Date().toISOString(),
    spawn: hasSpawn ? spawns[0].id : null,
    walkableArea: N * area,
    reachableArea: hasSpawn ? reachable * area : N * area,
    unreachableArea: hasSpawn ? (N - reachable) * area : 0,
    oneWayArea: hasSpawn ? oneWay * area : 0,
    areaByTier: hasSpawn ? areaByTier : {},
    objectives,
    tight,
    trivial,
    warnings
  };
  return { cellSize: cs, pos, rank, back, jumps: found.slice(0, 300), report, hasSpawn };
}

function OBJECTIVE_TAGS(t: string) {
  return OBJECTIVES.has(t);
}
