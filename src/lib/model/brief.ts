import * as THREE from 'three';
import type { Level, LevelElement, Project, Vec3 } from './types';
import { compass, flatten, forwardOf, matrixOf, quatOf, worldBounds } from './space';
import { footprint, innerRadius, shapeHeight, slopeInfo, taperOf } from './shapes';
import { BLOCKOUT_CONVENTION, describeConvention, engineYaw, fmtAngle, sameConvention, toEngineDir, toEnginePos, toEngineSize } from './engine';
import { derive, jumpTable, TIER_LABEL, type Tier } from './physics';
import { describeElement, diffLevels, type LevelDiff } from './diff';

export interface JumpFinding {
  from: Vec3;
  to: Vec3;
  gap: number;
  dh: number;
  tier: Tier;
  margin: number;
}
export interface AnalysisReport {
  time: string;
  spawn: string | null;
  walkableArea: number;
  reachableArea: number;
  unreachableArea: number;
  oneWayArea: number;
  areaByTier: Partial<Record<Tier, number>>;
  objectives: { id: string; tag: string; reachable: boolean; tier: Tier | null }[];
  tight: JumpFinding[];
  trivial: number;
  warnings: string[];
}

const f = (n: number, d = 2) => (Math.round(n * 10 ** d) / 10 ** d).toString();
const v3 = (a: ArrayLike<number>) => `(${f(a[0])}, ${f(a[1])}, ${f(a[2])})`;

function rotated(e: LevelElement) {
  return e.transform.rotation.some((r) => Math.abs(r) > 1e-3);
}

/** World-space corners of a shape's base ring and (if tapered) top ring. Smooth round shapes return null. */
function shapeCorners(e: LevelElement): { base: Vec3[]; top: Vec3[] | null } | null {
  if (e.type !== 'shape' || (e.shape.kind === 'prism' && e.shape.smooth)) return null;
  const s = e.shape;
  if (s.kind !== 'prism' && s.kind !== 'extrude' && s.kind !== 'box') return null;
  const ring = footprint(s);
  if (!ring) return null;
  const m = matrixOf(e.transform);
  const w = (x: number, y: number, z: number): Vec3 => {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(m);
    return [p.x, p.y, p.z];
  };
  const base = ring.map(([x, z]) => w(x, 0, z));
  const t = taperOf(s), h = shapeHeight(s);
  if (t >= 1 || s.infinite || h <= 0) return { base, top: null };
  const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cz = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  if (t === 0) return { base, top: [w(cx, h, cz)] };
  return { base, top: ring.map(([x, z]) => w(cx + (x - cx) * t, h, cz + (z - cz) * t)) };
}

function engineLine(e: LevelElement, project: Project): string | null {
  const c = project.engine;
  if (sameConvention(c, BLOCKOUT_CONVENTION)) return null;
  const parts: string[] = [`pos ${v3(toEnginePos(c, e.transform.position))}`];
  if (e.type === 'shape') {
    const s = e.shape;
    if (s.kind === 'extrude') parts.push(`height ${f((s.height ?? 0) * c.unitsPerMeter)}`);
    else if (s.kind === 'prism') parts.push(`radius ${f((s.radius ?? 1) * c.unitsPerMeter)}, height ${f((s.height ?? 0) * c.unitsPerMeter)}`);
    else parts.push(`size ${v3(toEngineSize(c, s.size!))}`);
    const cr = shapeCorners(e);
    if (cr) {
      parts.push(`base corners ${cr.base.map((p) => v3(toEnginePos(c, p))).join(' ')}`);
      if (cr.top) parts.push(`top corners ${cr.top.map((p) => v3(toEnginePos(c, p))).join(' ')}`);
    }
    if (s.kind === 'ramp' || s.kind === 'stairs') {
      const fw = forwardOf(e);
      parts.push(`goes up toward ${v3(toEngineDir(c, [fw.x, fw.y, fw.z]))}`);
    }
  }
  if (e.type === 'marker' || e.type === 'stamp') {
    const fw = forwardOf(e);
    parts.push(`yaw ${fmtAngle(c, engineYaw(c, [fw.x, fw.y, fw.z]))}`);
    if (e.type === 'marker' && e.marker.radius > 0) parts.push(`radius ${f(e.marker.radius * c.unitsPerMeter)}`);
  } else if (e.type !== 'path' && e.type !== 'note') {
    const [rx, ry, rz] = e.transform.rotation;
    if (Math.abs(rx) > 1e-3 || Math.abs(rz) > 1e-3) {
      const q = quatOf(e.transform.rotation);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q), fw = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      parts.push(`local up → ${v3(toEngineDir(c, [up.x, up.y, up.z]))}, local forward → ${v3(toEngineDir(c, [fw.x, fw.y, fw.z]))}`);
    } else if (Math.abs(ry) > 1e-3) {
      const fw = forwardOf(e);
      parts.push(`yaw ${fmtAngle(c, engineYaw(c, [fw.x, fw.y, fw.z]))}`);
    }
  }
  if (e.type === 'path') {
    const o = e.transform.position;
    parts.push(`points ${e.path.points.map((p) => v3(toEnginePos(c, [p[0] + o[0], p[1] + o[1], p[2] + o[2]]))).join(' → ')}, width ${f(e.path.width * c.unitsPerMeter)}`);
  }
  return `  - in ${c.name}: ${parts.join(' · ')}`;
}

function elementLine(e: LevelElement, project: Project) {
  const b = worldBounds(e, project);
  const size = b.getSize(new THREE.Vector3());
  const parts: string[] = [];
  parts.push(`**${e.id}**${e.name ? ` "${e.name}"` : ''} — ${describeElement(e)}`);
  parts.push(`pos ${v3(e.transform.position)}`);
  if (e.type === 'shape') {
    const s = e.shape;
    const hText = s.infinite ? '∞' : f(s.height ?? 0);
    if (s.kind === 'extrude') {
      parts.push(`footprint ${s.points!.length} pts, height ${hText}`);
    } else if (s.kind === 'prism') {
      const R = s.radius ?? 1, n = s.sides ?? 6;
      parts.push(s.smooth ? `radius ${f(R)} (⌀ ${f(2 * R)}), height ${hText}` : `${n} sides, radius ${f(R)} to corners / ${f(innerRadius(R, n))} to flats, height ${hText}, first corner on local +X`);
    } else parts.push(`size ${v3(s.size!)}`);
    const t = taperOf(s);
    if (t < 1 && (s.kind === 'prism' || s.kind === 'box' || s.kind === 'extrude')) parts.push(t === 0 ? 'comes to a point at the top (apex)' : s.kind === 'prism' ? `top radius ${f((s.radius ?? 1) * t)} (top is ${Math.round(t * 100)}% of the base)` : `top is ${Math.round(t * 100)}% of the base`);
    const info = slopeInfo(s, project.character);
    if (info) {
      const fw = forwardOf(e);
      parts.push(`rise ${f(info.rise)} over run ${f(info.run)} (${f(info.angle, 0)}°), goes up toward ${compass(fw)}${info.steps ? `, ${info.steps} steps of ${f(info.stepRise!)} × ${f(info.stepRun!)} m` : ''} — ${info.walkable ? 'walkable' : 'NOT walkable'} for the character: ${info.verdict}`);
    }
    const cr = shapeCorners(e);
    if (cr && !(s.kind === 'box' && !rotated(e) && t === 1)) {
      parts.push(`base corners ${cr.base.map(v3).join(' ')}`);
      if (cr.top) parts.push(`top ${cr.top.length === 1 ? 'apex' : 'corners'} ${cr.top.map(v3).join(' ')}`);
    }
    if (e.shape.hollow) parts.push(`hollow room (walls ${e.shape.hollow.wall} m${e.shape.hollow.floor ? ', floor' : ''}${e.shape.hollow.ceiling ? ', ceiling' : ''})`);
  }
  if (e.type === 'path') parts.push(`width ${f(e.path.width)} m, ${e.path.points.length} pts: ${e.path.points.map((p) => v3([p[0] + e.transform.position[0], p[1] + e.transform.position[1], p[2] + e.transform.position[2]])).join(' → ')}`);
  if (e.type === 'marker') {
    const fw = forwardOf(e);
    parts.push(`facing yaw ${f(e.transform.rotation[1], 0)}° (${compass(fw)})`);
    if (e.marker.radius > 0) parts.push(`radius ${f(e.marker.radius)} m`);
  } else if (e.transform.rotation.some((r) => Math.abs(r) > 1e-3)) parts.push(`rot ${v3(e.transform.rotation)}°`);
  parts.push(`bounds ${v3(b.min.toArray())} → ${v3(b.max.toArray())} (${f(size.x)}×${f(size.y)}×${f(size.z)})`);
  if (Object.keys(e.props).length) parts.push(`props ${JSON.stringify(e.props)}`);
  parts.push(e.precision === 'loose' ? '_loose_' : '_exact_');
  let s = '- ' + parts.join(' · ');
  const eng = engineLine(e, project);
  if (eng) s += '\n' + eng;
  if (e.notes) s += `\n  - note: ${e.notes}`;
  return s;
}

export function analysisSection(a: AnalysisReport | null | undefined, project: Project) {
  if (!a) return '_Traversal analysis not run. Run ⚡ Analyze in the editor or `blockout analyze`._\n';
  const lines: string[] = [];
  lines.push(`From spawn \`${a.spawn ?? '(none — analysed from all walkable surfaces)'}\`:`);
  lines.push(`- walkable ${f(a.walkableArea, 0)} m², reachable ${f(a.reachableArea, 0)} m², unreachable ${f(a.unreachableArea, 0)} m², one-way (can't get back) ${f(a.oneWayArea, 0)} m²`);
  const tiers = Object.entries(a.areaByTier).filter(([, v]) => (v ?? 0) > 0).map(([t, v]) => `${TIER_LABEL[t as Tier]} ${f(v!, 0)} m²`);
  if (tiers.length) lines.push(`- area by easiest movement needed: ${tiers.join(', ')}`);
  if (a.objectives.length) {
    lines.push('- objectives:');
    for (const o of a.objectives) lines.push(`  - ${o.id} (#${o.tag}): ${o.reachable ? `reachable — needs ${TIER_LABEL[o.tier!]}` : '**NOT reachable**'}`);
  }
  if (a.tight.length) {
    lines.push(`- tight jumps (≥ ${Math.round(project.traversal.tightMargin * 100)}% of max):`);
    for (const j of a.tight.slice(0, 20)) lines.push(`  - ${v3(j.from)} → ${v3(j.to)}: gap ${f(j.gap)} m, Δh ${f(j.dh)} m — ${TIER_LABEL[j.tier]} at ${Math.round(j.margin * 100)}%`);
  }
  for (const w of a.warnings) lines.push(`- ⚠ ${w}`);
  return lines.join('\n') + '\n';
}

export function characterSection(project: Project) {
  const c = project.character;
  const d = derive(c);
  const rows = jumpTable(c)
    .map((r) => `| ${f(r.dh)} | ${f(r.walk)} | ${f(r.sprint)} |${c.extraJumps ? ` ${f(r.extra ?? 0)} |` : ''}`)
    .join('\n');
  return `Height ${c.height} m, radius ${c.radius} m, step ${c.stepHeight} m, max slope ${c.maxSlope}°.
Walk ${c.walkSpeed} m/s, sprint ${c.sprintSpeed} m/s. Jump height ${c.jumpHeight} m (apex after ${c.timeToApex} s → gravity ${f(d.g)} m/s², launch ${f(d.v0)} m/s), coyote ${c.coyoteTime} s${c.extraJumps ? `, ${c.extraJumps} extra jump(s)` : ''}${c.dashDistance ? `, dash ${c.dashDistance} m` : ''}.

Max edge-to-edge gap by height difference (m):

| Δh | walk-jump | sprint-jump |${c.extraJumps ? ' double |' : ''}
|---|---|---|${c.extraJumps ? '---|' : ''}
${rows}
`;
}

export function buildBrief(project: Project, level: Level, opts: { version?: number; analysis?: AnalysisReport | null; images?: string[] } = {}) {
  const els = flatten(level, project).filter((e) => !e.hidden);
  const usedTags = new Set<string>();
  for (const e of els) e.tags.forEach((t) => usedTags.add(t));

  const groups = new Map<string, LevelElement[]>();
  for (const e of level.elements.filter((e) => !e.hidden)) {
    const key = e.type === 'stamp' ? `stamp: ${e.stamp}` : e.tags[0] ? `#${e.tags[0]}` : `untagged ${e.role}${e.type === 'shape' ? ' geometry' : ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  const order = (k: string) => (k.startsWith('untagged solid') ? 0 : k.startsWith('untagged cut') ? 1 : k.startsWith('stamp') ? 3 : 2);
  const groupKeys = [...groups.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b));

  const b = new THREE.Box3();
  for (const e of els) b.union(worldBounds(e, project));

  const out: string[] = [];
  out.push(`# Level brief: ${level.name} (\`${level.id}\`)${opts.version ? ` — version ${opts.version}` : ''}`);
  out.push('');
  out.push(`> Generated by Blockout. This is a **semantic blockout**: it records intent, layout and scale — not final art. Build the real level from it in your engine and asset style.`);
  out.push('');
  out.push('## Intent');
  out.push(level.intent || '_No intent written._');
  out.push('');
  out.push('## How to read this');
  out.push(`- Units: meters. Axes: Y-up, right-handed. Marker/stamp forward = local +Z; "yaw" is rotation around Y in degrees. \`rot [x, y, z]\` is applied yaw (y) → pitch (x) → roll (z); tilted shapes also list their local up / forward directions.`);
  for (const line of describeConvention(project.engine)) out.push(`- ${line}`);
  out.push(`- Shapes: \`box\`/\`ramp\`/\`stairs\`/\`cylinder\`/\`blob\` positions are the **bottom center**; ramps and stairs rise toward local +Z. \`extrude\` = footprint polygon (local XZ) extruded up by its height.`);
  out.push(`- Roles: **solid** = blockout geometry to replace with real art at the same scale & collision; **cut** = remove this volume from solids it overlaps (doorways, holes); **zone** = non-physical area that tells you what goes there (scatter trees, water…); **guide** = points/lines with meaning (spawns, objects, actors, routes).`);
  out.push(`- Precision: _exact_ = keep position/size within ~0.1 m (gameplay depends on it). _loose_ = creative freedom; match the spirit.`);
  out.push(`- **Keep element ids** (e.g. \`chest-01\`) as object names or metadata in the engine scene. Future change lists refer to them.`);
  out.push(`- Level bounds: ${b.isEmpty() ? 'empty' : `${v3(b.min.toArray())} → ${v3(b.max.toArray())}`}.`);
  if (level.storeys.length > 1) out.push(`- Storeys: ${level.storeys.map((s) => `${s.name} @ ${s.y} m`).join(', ')}.`);
  out.push('');
  if (opts.images?.length) {
    out.push('## Views');
    for (const img of opts.images) out.push(`![${img}](${img})`);
    out.push('');
  }
  out.push('## Player character (from game-settings.md)');
  out.push(characterSection(project));
  out.push('## Traversal check');
  out.push(analysisSection(opts.analysis, project));
  out.push('## Elements');
  for (const k of groupKeys) {
    const list = groups.get(k)!;
    out.push(`### ${k} (${list.length})`);
    for (const e of list) {
      out.push(elementLine(e, project));
      if (e.type === 'stamp') {
        for (const part of flatten({ ...level, elements: [e] }, project)) out.push('  ' + elementLine(part, project).replace(/\n/g, '\n  '));
      }
    }
    out.push('');
  }
  const glossary = [...usedTags].sort();
  if (glossary.length) {
    out.push('## Tag glossary');
    for (const t of glossary) {
      const d = project.tags[t];
      const props = d?.props ? ` Props: ${Object.entries(d.props).map(([k, p]) => `\`${k}\` (${p.type}${p.values ? ': ' + p.values.join('/') : ''})`).join(', ')}.` : '';
      out.push(`- **#${t}** (${d?.category ?? 'custom'}) — ${d?.description || '_no description_'}${props}`);
    }
    out.push('');
  }
  const stamps = [...new Set(level.elements.filter((e) => e.type === 'stamp').map((e) => (e as any).stamp as string))];
  if (stamps.length) {
    out.push('## Stamps used');
    for (const s of stamps) out.push(`- **${s}** — ${project.stamps[s]?.description ?? ''}`);
    out.push('');
  }
  return out.join('\n');
}

export function changesMarkdown(project: Project, d: LevelDiff, fromLabel: string, toLabel: string) {
  const out: string[] = [];
  if (d.empty) return 'No changes.\n';
  if (d.level.length) {
    out.push('### Level');
    d.level.forEach((l) => out.push(`- ${l}`));
  }
  if (d.added.length) {
    out.push(`### Added (${d.added.length})`);
    d.added.forEach((e) => out.push(elementLine(e, project)));
  }
  if (d.removed.length) {
    out.push(`### Removed (${d.removed.length})`);
    d.removed.forEach((e) => out.push(`- **${e.id}** — ${describeElement(e)} at ${v3(e.transform.position)}. Remove it from the scene.`));
  }
  if (d.modified.length) {
    out.push(`### Changed (${d.modified.length})`);
    d.modified.forEach((c) => out.push(`- **${c.id}** (${describeElement(c.after)}): ${c.changes.join('; ')}`));
  }
  return `Changes from ${fromLabel} to ${toLabel}:\n\n` + out.join('\n') + '\n';
}

export function buildChanges(project: Project, base: Level, current: Level, opts: { baseVersion: number; version: number; analysis?: AnalysisReport | null; images?: string[] }) {
  const d = diffLevels(base, current);
  const out: string[] = [];
  out.push(`# Level changes: ${current.name} (\`${current.id}\`) — v${opts.baseVersion} → v${opts.version}`);
  out.push('');
  out.push(`> The level was already built from version ${opts.baseVersion}. Apply **only these changes** to the existing scene, finding objects by element id. Keep everything else as built. The full current brief is in BRIEF.md.`);
  out.push('');
  out.push(changesMarkdown(project, d, `v${opts.baseVersion}`, `v${opts.version}`));
  if (opts.images?.length) {
    out.push('## Views (current)');
    for (const img of opts.images) out.push(`![${img}](${img})`);
    out.push('');
  }
  out.push('## Traversal check (current)');
  out.push(analysisSection(opts.analysis, project));
  return { markdown: out.join('\n'), diff: d };
}

export function handoffPrompt(levelDir: string, kind: 'brief' | 'changes') {
  if (kind === 'brief')
    return `Build the level described in ${levelDir}/handoff/BRIEF.md (look at the screenshots next to it; exact data is in ${levelDir}/level.json). Use our engine, conventions and asset library. Replace solids with real geometry at the same scale and collision, scatter/fill zones according to their tags, place every marker as the object/actor its tag describes, cut openings where cuts are, and keep each element id as the object's name or metadata so later changes can target it. Then check the traversal notes in the brief.`;
  return `The level was already built from an earlier Blockout version. Apply the changes in ${levelDir}/handoff/CHANGES.md to the existing scene: find objects by element id and update, add or remove only what's listed. The full current brief is ${levelDir}/handoff/BRIEF.md and data is ${levelDir}/level.json.`;
}
