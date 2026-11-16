<script lang="ts">
  import { editor } from '$lib/editor/editor.svelte';
  import { derive, jumpTable } from '$lib/model/physics';
  import { DEFAULT_CHARACTER } from '$lib/model/defaults';
  import type { Character } from '$lib/model/types';
  import { AXES, ENGINE_PRESETS, conventionProblem, engineYaw, fmtAngle, handedness, presetKey, sameConvention, toEnginePos, type Axis, type EngineConvention } from '$lib/model/engine';
  import Modal from './Modal.svelte';
  import NumField from './NumField.svelte';
  import { WEB } from '$lib/editor/api';

  const p = $derived(editor.project);
  const c = $derived(p.character);
  const d = $derived(derive(c));
  const table = $derived(jumpTable(c));
  function setC<K extends keyof Character>(k: K, v: number) {
    editor.updateProject((x) => {
      x.character[k] = v as any;
      return x;
    });
  }
  const fields: [keyof Character, string, number, string][] = [
    ['height', 'Height', 0.1, 'm'], ['radius', 'Radius', 0.05, 'm'], ['stepHeight', 'Step height', 0.05, 'm'], ['maxSlope', 'Max slope', 5, '°'],
    ['walkSpeed', 'Walk speed', 0.25, 'm/s'], ['sprintSpeed', 'Sprint speed', 0.25, 'm/s'], ['jumpHeight', 'Jump height', 0.05, 'm'], ['timeToApex', 'Time to apex', 0.02, 's'],
    ['coyoteTime', 'Coyote time', 0.02, 's'], ['airControl', 'Air control', 0.1, '0–1'], ['extraJumps', 'Extra jumps', 1, '×'], ['dashDistance', 'Air dash', 0.5, 'm']
  ];
  const f = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
  let draft = $state<EngineConvention | null>(null);
  const eng = $derived(draft ?? p.engine);
  const problem = $derived(conventionProblem(eng));
  const matched = $derived(Object.values(ENGINE_PRESETS).some((pr) => sameConvention(eng, pr)));
  const ex = $derived.by(() => {
    const pos = toEnginePos(eng, [1, 2, 3]).map((n) => Math.round(n * 100) / 100).join(', ');
    return { pos, yaw: fmtAngle(eng, engineYaw(eng, [1, 0, 0])) };
  });
  function setEngine(c: EngineConvention) {
    if (conventionProblem(c)) {
      draft = c; // show the problem, don't save it
      return;
    }
    draft = null;
    editor.updateProject((x) => ((x.engine = c), x));
  }
</script>

<Modal title="Project settings" width={720}>
  <div class="g2">
    <label class="field"><span>Project name</span><input class="input" value={p.name} onchange={(e) => editor.updateProject((x) => ((x.name = (e.target as HTMLInputElement).value), x))} /></label>
  </div>

  <div class="section-title">Target engine</div>
  <div class="eng">
    <div class="presets">
      {#each Object.entries(ENGINE_PRESETS) as [k, pr]}
        <button class="chip" class:on={sameConvention(eng, pr)} onclick={() => setEngine({ ...pr })}>{pr.name}</button>
      {/each}
      <span class="chip faint" class:on={!matched}>Custom</span>
    </div>
    <div class="g6">
      <label class="field"><span>Name</span><input class="input" value={eng.name} onchange={(e) => { const name = (e.target as HTMLInputElement).value; const k = presetKey(name); setEngine(k ? { ...ENGINE_PRESETS[k] } : { ...eng, name }); }} /></label>
      <label class="field"><span>Units / meter</span><input class="input" type="number" step="any" min="0" value={eng.unitsPerMeter} onchange={(e) => setEngine({ ...eng, unitsPerMeter: Number((e.target as HTMLInputElement).value) })} /></label>
      {#each [['up', 'Up'], ['forward', 'Forward'], ['right', 'Right hand']] as [k, label]}
        <label class="field"><span>{label}</span>
          <select class="input" value={eng[k as 'up']} onchange={(e) => setEngine({ ...eng, [k]: (e.target as HTMLSelectElement).value as Axis })}>
            {#each AXES as a}<option value={a}>{a}</option>{/each}
          </select>
        </label>
      {/each}
      <label class="field"><span>Angles</span>
        <select class="input" value={eng.angles} onchange={(e) => setEngine({ ...eng, angles: (e.target as HTMLSelectElement).value as EngineConvention['angles'] })}>
          <option value="degrees">degrees</option><option value="radians">radians</option>
        </select>
      </label>
    </div>
    {#if problem}
      <div class="err">{problem}</div>
    {:else}
      <div class="faint small">{handedness(eng)}-handed. Example: a chest at Blockout (1, 2, 3) facing +x → {eng.name} position ({ex.pos}), yaw {ex.yaw}. Every position, size and facing in the brief is also listed in these terms.</div>
    {/if}
    {#each p.settingsWarnings ?? [] as w}<div class="err">game-settings.md: {w}</div>{/each}
  </div>
  <div class="g4">
    <NumField label="Grid" value={p.grid.size} step={0.25} min={0.1} unit="m" onchange={(v) => editor.updateProject((x) => ((x.grid.size = v), x))} />
    <NumField label="Snap ÷" value={p.grid.subdivisions} step={1} min={1} max={16} onchange={(v) => editor.updateProject((x) => ((x.grid.subdivisions = Math.round(v)), x))} />
    <NumField label="Default H" value={p.defaults.height} step={0.5} min={0.1} unit="m" onchange={(v) => editor.updateProject((x) => ((x.defaults.height = v), x))} />
    <NumField label="Wall" value={p.defaults.wall} step={0.05} min={0.05} unit="m" onchange={(v) => editor.updateProject((x) => ((x.defaults.wall = v), x))} />
  </div>
  <div class="faint">Snapping step: {editor.snapStep} m</div>

  <div class="section-title">Player character</div>
  <div class="cols">
    <div class="g2 tight">
      {#each fields as [k, label, step, unit]}
        <div class="cf"><span class="muted">{label}</span><NumField label="" value={c[k] as number} {step} min={0} {unit} onchange={(v) => setC(k, k === 'extraJumps' ? Math.round(v) : v)} /></div>
      {/each}
      <button class="btn sm" onclick={() => editor.updateProject((x) => ((x.character = { ...DEFAULT_CHARACTER }), x))}>Reset to defaults</button>
    </div>
    <div class="jt">
      <div class="muted small">Gravity {f(d.g)} m/s² · launch {f(d.v0)} m/s · max climb {f(d.maxJump)} m</div>
      <table>
        <thead><tr><th>Δ height</th><th>Jump</th><th>Sprint jump</th>{#if c.extraJumps}<th>Double</th>{/if}</tr></thead>
        <tbody>
          {#each table as r}
            <tr><td>{r.dh > 0 ? '+' : ''}{f(r.dh)} m</td><td>{f(r.walk)} m</td><td>{f(r.sprint)} m</td>{#if c.extraJumps}<td>{f(r.extra ?? 0)} m</td>{/if}</tr>
          {/each}
        </tbody>
      </table>
      <div class="faint small">Max edge-to-edge gap the character can clear. Used by the tape tool, jump rings, analysis, walk mode and the brief.</div>
      <div class="g2">
        <NumField label="Tight ≥" value={p.traversal.tightMargin * 100} step={5} min={50} max={100} unit="%" onchange={(v) => editor.updateProject((x) => ((x.traversal.tightMargin = v / 100), x))} />
        <NumField label="Easy <" value={p.traversal.trivialMargin * 100} step={5} min={0} max={90} unit="%" onchange={(v) => editor.updateProject((x) => ((x.traversal.trivialMargin = v / 100), x))} />
      </div>
    </div>
  </div>
  <div class="faint small">These numbers live in <code>{WEB ? editor.rootLabel : editor.root}/game-settings.md</code> — plain <code>- key: value</code> lines your game-building agent can edit directly. Changes there show up here live.</div>
</Modal>

<style>
  .g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .g4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .g6 { display: grid; grid-template-columns: 1.6fr 1fr 1fr 1fr 1fr 1fr; gap: 6px; }
  .eng { display: flex; flex-direction: column; gap: 8px; }
  .presets { display: flex; flex-wrap: wrap; gap: 5px; }
  .presets .chip { cursor: pointer; }
  .presets .chip.on { border-color: var(--accent); background: rgba(77, 163, 255, 0.15); color: #d8eaff; }
  .err { color: var(--err); font-size: 12px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  .tight { gap: 6px; }
  .cf { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; }
  .jt { display: flex; flex-direction: column; gap: 8px; }
  table { border-collapse: collapse; font-family: var(--mono); font-size: 12px; }
  th { text-align: left; color: var(--dim); font-weight: 600; font-family: var(--font); font-size: 11px; padding: 4px 6px; border-bottom: 1px solid var(--line2); }
  td { padding: 4px 6px; border-bottom: 1px solid var(--line); }
  .small { font-size: 11.5px; }
  code { font-family: var(--mono); font-size: 11px; }
</style>
