import type { Project } from './types';
import { ENGINE_PRESETS, conventionProblem, parseAxis, presetKey, sameConvention, type EngineConvention } from './engine';

/**
 * game-settings.md — the human/agent-editable source of truth for gameplay numbers and the target
 * engine's coordinate convention. Format: markdown with `- key: value` lines. Anything else (headings,
 * prose, comments after #) is ignored and preserved when Blockout writes values back.
 */
export const SETTINGS_FILE = 'game-settings.md';

type Field = {
  key: string;
  label: string;
  aliases?: string[];
  get: (p: Project) => string;
  /** engine fields are applied as a group, see applySettingsDoc */
  set?: (p: Project, v: string) => void;
  note: string;
  section: string;
};

const num = (v: string) => {
  const n = parseFloat(v.replace(/,/g, '.'));
  return Number.isFinite(n) ? n : null;
};
const pct = (v: string) => {
  const n = num(v);
  if (n == null) return null;
  return /%/.test(v) || n > 1.5 ? n / 100 : n;
};
const fmt = (n: number) => String(Math.round(n * 10000) / 10000);

function charField(key: keyof Project['character'], label: string, unit: string, note: string): Field {
  return {
    key: norm(label),
    label,
    section: 'Character',
    note: [unit, note].filter(Boolean).join(' — '),
    get: (p) => fmt(p.character[key] as number),
    set: (p, v) => {
      const n = num(v);
      if (n != null) (p.character as any)[key] = key === 'extraJumps' ? Math.round(n) : n;
    }
  };
}

const PRESET_NAMES = Object.keys(ENGINE_PRESETS).join(' | ');
const ENGINE = 'Target engine';

export const FIELDS: Field[] = [
  charField('height', 'height', 'm', 'standing capsule height'),
  charField('radius', 'radius', 'm', 'capsule radius'),
  charField('stepHeight', 'step height', 'm', 'max ledge you walk up without jumping'),
  charField('maxSlope', 'max slope', 'degrees', 'steepest walkable slope'),
  charField('walkSpeed', 'walk speed', 'm/s', ''),
  charField('sprintSpeed', 'sprint speed', 'm/s', ''),
  charField('jumpHeight', 'jump height', 'm', 'apex height of a full jump'),
  charField('timeToApex', 'time to apex', 's', 'seconds from takeoff to the top of the jump (sets gravity)'),
  charField('coyoteTime', 'coyote time', 's', 'grace period to jump after leaving a ledge'),
  charField('airControl', 'air control', '0-1', 'how much you can steer mid-air'),
  charField('extraJumps', 'extra jumps', 'count', '1 = double jump'),
  charField('dashDistance', 'air dash', 'm', '0 = no dash'),
  charField('crouchHeight', 'crouch height', 'm', ''),
  { key: 'engine', label: 'engine', aliases: ['targetengine'], section: ENGINE, note: `${PRESET_NAMES}, or any name (then set the lines below)`, get: (p) => p.engine.name },
  { key: 'unitspermeter', label: 'units per meter', section: ENGINE, note: '1 = meters, 100 = centimeters', get: (p) => fmt(p.engine.unitsPerMeter) },
  { key: 'upaxis', label: 'up axis', section: ENGINE, note: '+x -x +y -y +z -z', get: (p) => p.engine.up },
  { key: 'forwardaxis', label: 'forward axis', section: ENGINE, note: 'the way a character or prop faces at rotation 0', get: (p) => p.engine.forward },
  { key: 'rightaxis', label: 'right axis', section: ENGINE, note: "the character's right hand when facing forward", get: (p) => p.engine.right },
  { key: 'angleunits', label: 'angle units', section: ENGINE, note: 'degrees | radians', get: (p) => p.engine.angles },
  { key: 'gridsize', label: 'grid size', section: 'Editor', note: 'm', get: (p) => fmt(p.grid.size), set: (p, v) => { const n = num(v); if (n && n > 0) p.grid.size = n; } },
  { key: 'snapdivisions', label: 'snap divisions', section: 'Editor', note: 'snapping step = grid size / divisions', get: (p) => fmt(p.grid.subdivisions), set: (p, v) => { const n = num(v); if (n && n >= 1) p.grid.subdivisions = Math.round(n); } },
  { key: 'defaultheight', label: 'default height', section: 'Editor', note: 'm — height of new solids', get: (p) => fmt(p.defaults.height), set: (p, v) => { const n = num(v); if (n && n > 0) p.defaults.height = n; } },
  { key: 'wallthickness', label: 'wall thickness', section: 'Editor', note: 'm — for hollow rooms', get: (p) => fmt(p.defaults.wall), set: (p, v) => { const n = num(v); if (n && n > 0) p.defaults.wall = n; } },
  { key: 'tightjump', label: 'tight jump', section: 'Traversal checks', note: 'flag jumps that need at least this much of the max distance', get: (p) => Math.round(p.traversal.tightMargin * 100) + '%', set: (p, v) => { const n = pct(v); if (n != null) p.traversal.tightMargin = n; } },
  { key: 'easyjump', label: 'easy jump', section: 'Traversal checks', note: 'flag jumps below this share of the max distance as easy', get: (p) => Math.round(p.traversal.trivialMargin * 100) + '%', set: (p, v) => { const n = pct(v); if (n != null) p.traversal.trivialMargin = n; } }
];

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function fieldFor(rawKey: string) {
  const k = norm(rawKey);
  return FIELDS.find((f) => f.key === k || f.aliases?.includes(k));
}

const LINE = /^(\s*[-*]?\s*)([A-Za-z][A-Za-z0-9 _\-]*?)(\s*:\s*)([^#\n]*?)(\s*(#.*)?)$/;

/**
 * Apply values from the doc onto a project (doc wins). Returns problems it found; invalid values are
 * ignored so a typo never breaks the editor.
 */
export function applySettingsDoc(p: Project, md: string): string[] {
  const vals = new Map<string, string>();
  for (const line of md.split('\n')) {
    const m = LINE.exec(line);
    if (!m || !m[4].trim()) continue;
    const f = fieldFor(m[2]);
    if (f) vals.set(f.key, m[4].trim());
  }
  for (const f of FIELDS) if (f.set && vals.has(f.key)) f.set(p, vals.get(f.key)!);
  const warnings: string[] = [];
  p.engine = resolveEngine(p.engine, vals, warnings);
  return warnings;
}

function resolveEngine(prev: EngineConvention, vals: Map<string, string>, warnings: string[]): EngineConvention {
  let base: EngineConvention = { ...prev };
  let preset: EngineConvention | null = null;
  if (vals.has('engine')) {
    const name = vals.get('engine')!;
    const k = presetKey(name);
    if (k) {
      preset = ENGINE_PRESETS[k];
      base = { ...preset };
    } else base.name = name;
  }
  const explicit: Partial<EngineConvention> = {};
  if (vals.has('unitspermeter')) {
    const n = num(vals.get('unitspermeter')!);
    if (n && n > 0) explicit.unitsPerMeter = n;
    else warnings.push(`units per meter "${vals.get('unitspermeter')}" is not a positive number`);
  }
  for (const [key, prop] of [['upaxis', 'up'], ['forwardaxis', 'forward'], ['rightaxis', 'right']] as const) {
    if (!vals.has(key)) continue;
    const a = parseAxis(vals.get(key)!);
    if (a) explicit[prop] = a;
    else warnings.push(`${key.replace('axis', ' axis')} "${vals.get(key)}" should look like +x, -y, +z…`);
  }
  if (vals.has('angleunits')) explicit.angles = /^rad/i.test(vals.get('angleunits')!) ? 'radians' : 'degrees';
  let next: EngineConvention = { ...base, ...explicit };
  // the name was switched to a preset but the axis lines still describe a *different* preset: they're stale
  if (preset && !sameConvention(next, preset) && Object.values(ENGINE_PRESETS).some((o) => o !== preset && sameConvention(o, next))) next = { ...preset };
  const problem = conventionProblem(next);
  if (problem) {
    warnings.push(problem + ' Keeping the previous engine settings.');
    return prev;
  }
  return next;
}

/** Write project values into an existing doc in place, keeping all other text. Inserts missing keys in their section. */
export function updateSettingsDoc(md: string | null, p: Project): string {
  if (!md) return renderSettingsDoc(p);
  const seen = new Set<string>();
  const lastLineOf = new Map<string, number>();
  const lines = md.split('\n').map((line, i) => {
    const m = LINE.exec(line);
    if (!m) return line;
    const f = fieldFor(m[2]);
    if (!f) return line;
    seen.add(f.key);
    lastLineOf.set(f.section, i);
    const v = f.get(p);
    // a line written under an old name gets the current label and comment
    if (norm(m[2]) !== f.key) return `${m[1]}${f.label}: ${v}${f.note ? `   # ${f.note}` : ''}`;
    if (m[4].trim() === v) return line;
    return `${m[1]}${m[2]}${m[3]}${v}${m[5] ?? ''}`;
  });
  const missing = FIELDS.filter((f) => !seen.has(f.key));
  const inserts: { at: number; text: string }[] = [];
  const orphans: Field[] = [];
  for (const f of missing) {
    const at = lastLineOf.get(f.section);
    const text = `- ${f.label}: ${f.get(p)}${f.note ? `   # ${f.note}` : ''}`;
    if (at == null) orphans.push(f);
    else inserts.push({ at, text });
  }
  // keep field order within each insertion point; splice the highest positions first
  const grouped = new Map<number, string[]>();
  for (const ins of inserts) grouped.set(ins.at, [...(grouped.get(ins.at) ?? []), ins.text]);
  for (const at of [...grouped.keys()].sort((a, b) => b - a)) lines.splice(at + 1, 0, ...grouped.get(at)!);
  let section = '';
  for (const f of orphans) {
    if (f.section !== section) {
      section = f.section;
      lines.push('', `## ${section}`);
    }
    lines.push(`- ${f.label}: ${f.get(p)}${f.note ? `   # ${f.note}` : ''}`);
  }
  return lines.join('\n');
}

export function renderSettingsDoc(p: Project): string {
  const out = [
    `# Game settings — ${p.name}`,
    '',
    'Numbers Blockout uses for scale, jump checks, walk mode and level briefs.',
    '**Agents building the game: keep these in sync with the real game** (character controller, engine axes).',
    'Edit the value after the colon; anything after `#` is a comment. Blockout reloads this file live and only',
    'rewrites values in place. Units: meters, seconds, degrees.',
    '',
    'Target engine: setting `engine` to a known name fills in its axes and units. For any other engine, give it',
    'a name and describe its axes: which axis points up, which way things face at rotation 0 (forward), and which',
    "way a character's right hand points. Briefs then list every position, size and facing in that engine's terms.",
    ''
  ];
  let section = '';
  for (const f of FIELDS) {
    if (f.section !== section) {
      section = f.section;
      out.push('', `## ${section}`);
    }
    out.push(`- ${f.label}: ${f.get(p)}${f.note ? `   # ${f.note}` : ''}`);
  }
  out.push('');
  return out.join('\n');
}
