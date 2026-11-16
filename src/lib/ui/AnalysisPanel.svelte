<script lang="ts">
  import { editor } from '$lib/editor/editor.svelte';
  import { TIER_COLORS, TIER_LABEL, type Tier } from '$lib/model/physics';
  import * as A from '$lib/editor/actions';
  const r = $derived(editor.analysis?.report);
  const tiers: Tier[] = ['walk', 'walk-jump', 'sprint-jump', 'extra-jump', 'dash'];
  const f = (n: number) => Math.round(n);
  function focus(id: string) {
    editor.selection = [id];
    editor.engine?.frameSelection();
  }
</script>
{#if r}
  <div class="ap">
    <div class="row head">
      <b>Traversal</b>
      {#if editor.analysisStale}<button class="btn sm" onclick={() => A.runAnalysis(true)}>Re-run</button>{/if}
      <button class="btn sm ghost" onclick={() => (editor.showAnalysis = false)}>Hide</button>
    </div>
    {#if editor.analysis?.hasSpawn}
      <div class="muted small">Easiest way to reach each surface from <b>{r.spawn}</b>:</div>
      {#each tiers as t}
        {#if (r.areaByTier[t] ?? 0) > 0}
          <div class="lg"><span class="sw" style="background:{TIER_COLORS[t]}"></span><span class="grow">{TIER_LABEL[t]}</span><span class="faint">{f(r.areaByTier[t] ?? 0)} m²</span></div>
        {/if}
      {/each}
      <div class="lg"><span class="sw" style="background:#a47e68"></span><span class="grow">One-way (can't get back)</span><span class="faint">{f(r.oneWayArea)} m²</span></div>
      <div class="lg"><span class="sw" style="background:{TIER_COLORS.impossible}"></span><span class="grow">Unreachable</span><span class="faint">{f(r.unreachableArea)} m²</span></div>
      <div class="lg"><span class="sw line" style="background:#ff5252"></span><span class="grow">Tight jump (≥ {Math.round(editor.project.traversal.tightMargin * 100)}% of max)</span><span class="faint">{r.tight.length}</span></div>
    {:else}
      <div class="lg"><span class="sw" style="background:#6fa8dc"></span><span class="grow">Walkable surface</span><span class="faint">{f(r.walkableArea)} m²</span></div>
    {/if}
    {#if r.objectives.length}
      <div class="sub section-title">Objectives</div>
      {#each r.objectives as o}
        <button class="obj" onclick={() => focus(o.id)}>
          <span class="sw" style="background:{o.reachable ? TIER_COLORS[o.tier ?? 'walk'] : TIER_COLORS.impossible}"></span>
          <span class="grow mono">{o.id}</span><span class="faint">{o.reachable ? TIER_LABEL[o.tier ?? 'walk'] : 'unreachable'}</span>
        </button>
      {/each}
    {/if}
    {#each r.warnings as w}<div class="warn">⚠ {w}</div>{/each}
  </div>
{/if}
<style>
  .ap { position: absolute; right: 12px; top: 12px; width: 280px; background: rgba(31, 35, 42, 0.96); border: 1px solid var(--line2); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 5px; box-shadow: var(--shadow); z-index: 4; font-size: 12px; max-height: calc(100% - 330px); overflow: auto; }
  .head { justify-content: space-between; }
  .head b { flex: 1; }
  .lg, .obj { display: flex; align-items: center; gap: 8px; }
  .obj { padding: 3px 4px; border-radius: 5px; text-align: left; }
  .obj:hover { background: #2a303a; }
  .sw { width: 12px; height: 12px; border-radius: 3px; flex: none; }
  .sw.line { height: 3px; }
  .small { font-size: 11.5px; }
  .sub { margin-top: 6px; }
  .mono { font-family: var(--mono); font-size: 11px; }
  .warn { color: #ffc14d; font-size: 11.5px; }
</style>
