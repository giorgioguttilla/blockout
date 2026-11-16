import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeLevel, normalizeProject } from '../src/lib/model/serialize';
import { buildBrief, changesMarkdown, analysisSection } from '../src/lib/model/brief';
import { diffLevels } from '../src/lib/model/diff';
import { buildCollision } from '../src/lib/traversal/collision';
import { analyze } from '../src/lib/traversal/analysis';
import { flatten } from '../src/lib/model/space';
import type { Level, Project, VersionInfo } from '../src/lib/model/types';
import { SETTINGS_FILE, applySettingsDoc } from '../src/lib/model/settingsDoc';

const warn = console.warn;
console.warn = (...a: unknown[]) => {
  if (typeof a[0] === 'string' && a[0].includes('maxLeafSize')) return;
  warn(...a);
};

const HELP = `blockout — semantic 3D level sketching

Usage:
  blockout [folder]                       open the editor on a project folder (default: current folder)
  blockout levels  <folder>               list levels
  blockout brief   <folder> <level> [--analyze]   print the level brief (markdown)
  blockout diff    <folder> <level> [--since baseline|N] [--to N]   print what changed (markdown)
  blockout analyze <folder> <level> [--json]      traversal check from the spawn marker
  blockout validate <folder>              check project + level files for problems

Options for open: --port 5199  --no-open
`;

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes('--' + n);
const opt = (n: string) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['--analyze', '--json', '--no-open'].includes(argv[i - 1])));

function readProject(dir: string): Project {
  const f = path.join(dir, 'blockout.project.json');
  if (!fs.existsSync(f)) die(`No blockout.project.json in ${dir}`);
  const p = normalizeProject(JSON.parse(fs.readFileSync(f, 'utf8')));
  const sf = path.join(dir, SETTINGS_FILE);
  if (fs.existsSync(sf)) applySettingsDoc(p, fs.readFileSync(sf, 'utf8'));
  return p;
}
function readLevel(dir: string, id: string): Level {
  const f = path.join(dir, 'levels', id, 'level.json');
  if (!fs.existsSync(f)) die(`No level "${id}" (looked for ${f})`);
  return normalizeLevel(JSON.parse(fs.readFileSync(f, 'utf8')), id);
}
function readIndex(dir: string, id: string): VersionInfo[] {
  const f = path.join(dir, 'levels', id, 'versions', 'index.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
}
function readVersion(dir: string, id: string, n: number): Level {
  const f = path.join(dir, 'levels', id, 'versions', String(n).padStart(4, '0') + '.json');
  if (!fs.existsSync(f)) die(`No version ${n} for ${id}`);
  return normalizeLevel(JSON.parse(fs.readFileSync(f, 'utf8')), id);
}
function die(msg: string): never {
  console.error('blockout: ' + msg);
  process.exit(1);
}

async function main() {
  const cmd = pos[0];
  if (flag('help') || cmd === 'help') return console.log(HELP);
  if (cmd === 'levels') {
    const dir = path.resolve(pos[1] ?? '.');
    const ld = path.join(dir, 'levels');
    for (const id of fs.existsSync(ld) ? fs.readdirSync(ld) : []) {
      if (!fs.existsSync(path.join(ld, id, 'level.json'))) continue;
      const l = readLevel(dir, id);
      const v = readIndex(dir, id);
      console.log(`${id}\t${l.name}\t${l.elements.length} elements\t${v.length} versions${v.find((x) => x.baseline) ? `\tbuilt v${v.find((x) => x.baseline)!.n}` : ''}`);
    }
    return;
  }
  if (cmd === 'brief') {
    const dir = path.resolve(pos[1] ?? '.');
    const id = pos[2] ?? die('which level?');
    const project = readProject(dir);
    const level = readLevel(dir, id);
    let analysis = null;
    if (flag('analyze')) analysis = await runAnalysis(project, level);
    return console.log(buildBrief(project, level, { analysis }));
  }
  if (cmd === 'diff') {
    const dir = path.resolve(pos[1] ?? '.');
    const id = pos[2] ?? die('which level?');
    const project = readProject(dir);
    const idx = readIndex(dir, id);
    const since = opt('since') ?? 'baseline';
    const baseN = since === 'baseline' ? idx.find((v) => v.baseline)?.n ?? idx.at(-1)?.n : Number(since);
    if (!baseN) die('no versions to diff against yet');
    const base = readVersion(dir, id, baseN);
    const to = opt('to');
    const cur = to ? readVersion(dir, id, Number(to)) : readLevel(dir, id);
    return console.log(changesMarkdown(project, diffLevels(base, cur), `v${baseN}`, to ? `v${to}` : 'the working copy'));
  }
  if (cmd === 'analyze') {
    const dir = path.resolve(pos[1] ?? '.');
    const id = pos[2] ?? die('which level?');
    const project = readProject(dir);
    const level = readLevel(dir, id);
    const r = await runAnalysis(project, level);
    if (!r) die('no solid geometry');
    if (flag('json')) console.log(JSON.stringify(r, null, 2));
    else console.log(analysisSection(r, project));
    return;
  }
  if (cmd === 'validate') {
    const dir = path.resolve(pos[1] ?? '.');
    const project = readProject(dir);
    let problems = 0;
    const ld = path.join(dir, 'levels');
    for (const id of fs.existsSync(ld) ? fs.readdirSync(ld) : []) {
      const f = path.join(ld, id, 'level.json');
      if (!fs.existsSync(f)) continue;
      let raw: any;
      try {
        raw = JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch (e) {
        console.log(`✗ ${id}: invalid JSON — ${(e as Error).message}`);
        problems++;
        continue;
      }
      const issues: string[] = [];
      const ids = new Set<string>();
      for (const e of raw.elements ?? []) {
        if (!e.id) issues.push('element without id');
        else if (ids.has(e.id)) issues.push(`duplicate id ${e.id}`);
        ids.add(e.id);
        for (const t of e.tags ?? []) if (!project.tags[t]) issues.push(`${e.id}: tag #${t} is not in the project's tag library`);
        if (e.type === 'stamp' && !project.stamps[e.stamp]) issues.push(`${e.id}: unknown stamp "${e.stamp}"`);
        if (e.type === 'shape' && e.shape?.kind === 'extrude' && (e.shape.points?.length ?? 0) < 3) issues.push(`${e.id}: polygon needs ≥ 3 points`);
        if (e.type === 'shape' && e.shape?.size && e.shape.size.some((s: number) => s <= 0) && e.role !== 'zone') issues.push(`${e.id}: zero or negative size`);
        if (!['solid', 'cut', 'zone', 'guide'].includes(e.role)) issues.push(`${e.id}: unknown role "${e.role}"`);
      }
      const idx = readIndex(dir, id);
      const base = idx.find((v) => v.baseline);
      if (base) {
        const b = readVersion(dir, id, base.n);
        const now = new Set((raw.elements ?? []).map((e: any) => e.id));
        const lost = b.elements.filter((e) => !now.has(e.id)).length;
        if (lost > b.elements.length * 0.5 && b.elements.length > 4) issues.push(`more than half the ids from the built version v${base.n} are gone — were ids rewritten?`);
      }
      problems += issues.length;
      console.log(issues.length ? `✗ ${id}\n  - ${issues.join('\n  - ')}` : `✓ ${id} (${raw.elements?.length ?? 0} elements)`);
    }
    process.exit(problems ? 1 : 0);
  }
  // default: open the editor
  const dir = path.resolve(cmd && cmd !== 'open' ? cmd : pos[1] ?? '.');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const server = path.resolve(here, '..', 'build', 'index.js');
  if (!fs.existsSync(server)) die(`The editor is not built yet. Run "npm run build" in ${path.resolve(here, '..')}`);
  const port = opt('port') ?? process.env.PORT ?? '5199';
  const child = spawn(process.execPath, [server], {
    stdio: 'inherit',
    env: { ...process.env, BLOCKOUT_ROOT: dir, PORT: port, HOST: '127.0.0.1', BODY_SIZE_LIMIT: 'Infinity' }
  });
  const url = `http://127.0.0.1:${port}`;
  console.log(`\n  Blockout → ${url}\n  Project  → ${dir}\n`);
  if (!flag('no-open')) {
    setTimeout(() => {
      const o = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      spawn(o, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
    }, 700);
  }
  child.on('exit', (c) => process.exit(c ?? 0));
}

async function runAnalysis(project: Project, level: Level) {
  const geom = buildCollision(level, project);
  if (!geom) return null;
  const res = await analyze(geom, flatten(level, project), project);
  return res.report;
}

main();
