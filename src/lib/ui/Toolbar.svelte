<script lang="ts">
  import { editor, TOOL_INFO, DRAW_SHAPES, type ToolName } from '$lib/editor/editor.svelte';
  import { polygonName } from '$lib/model/shapes';
  import * as A from '$lib/editor/actions';
  import Icon from './Icon.svelte';

  const tools: ToolName[] = ['select', 'draw', 'line', 'marker', 'stamp', 'note', 'tape'];
  const shapes = $derived(editor.selected.filter((e) => e.type === 'shape'));
  const one = $derived(editor.selected.length === 1 ? editor.selected[0] : null);
  const kind = $derived(shapes.length === 1 && shapes[0].type === 'shape' ? shapes[0].shape.kind : null);
  const hollow = $derived(shapes.length === 1 && shapes[0].type === 'shape' && !!shapes[0].shape.hollow);
  function conv(k: 'box' | 'ramp' | 'stairs' | 'prism' | 'blob') {
    (editor.engine?.tools.tools.select as any).convert(k);
  }
  const SHAPE_ICONS: Record<string, string> = {
    box: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
    ngon: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/>',
    circle: '<circle cx="12" cy="12" r="8"/>',
    cone: '<path d="M12 3L5 18a7 3 0 0014 0z"/>',
    ramp: '<path d="M3 19h18V7z"/>',
    stairs: '<path d="M3 19h18V5h-4v4h-4v4H9v4H3z"/>'
  };
  function setShape(k: typeof editor.drawShape) {
    editor.drawShape = k;
    editor.engine?.tools.rehover();
  }
  function sides(d: number) {
    editor.drawShape = 'ngon';
    editor.ngonSides = Math.max(3, Math.min(16, editor.ngonSides + d));
  }
  function key(k: string, shift = false) {
    editor.engine?.tools.tools.select.key?.(new KeyboardEvent('keydown', { key: k, shiftKey: shift }));
  }
</script>

<div class="toolbar">
  {#each tools as t}
    <button class="tool" class:on={editor.tool === t} onclick={() => A.setTool(t)} title="{TOOL_INFO[t].label} ({TOOL_INFO[t].key})">
      <Icon name={t} size={18} />
      <span class="k">{TOOL_INFO[t].key}</span>
    </button>
  {/each}
</div>

{#if editor.tool === 'draw'}
  <div class="flyout shapes">
    <div class="section-title">Drag draws <span class="faint">· D cycles</span></div>
    {#each DRAW_SHAPES as d}
      <div class="st" class:on={editor.drawShape === d.key} role="button" tabindex="0" onclick={() => setShape(d.key)} onkeydown={(e) => e.key === 'Enter' && setShape(d.key)} title={d.hint}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">{@html SHAPE_ICONS[d.key]}</svg>
        <span class="grow">{d.key === 'ngon' ? polygonName(editor.ngonSides) : d.label}</span>
        {#if d.key === 'ngon'}
          <span class="stepper" role="group" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
            <button onclick={() => sides(-1)} title="Fewer sides ([)">−</button><b>{editor.ngonSides}</b><button onclick={() => sides(1)} title="More sides (])">+</button>
          </span>
        {/if}
      </div>
    {/each}
    <div class="faint small">Click-click-click always draws any polygon. Alt-drag fits round shapes in a box.</div>
  </div>
{/if}

{#if editor.tool === 'stamp'}
  <div class="flyout">
    <div class="section-title">Stamps</div>
    {#each Object.entries(editor.project.stamps) as [key, s]}
      <button class="st" class:on={editor.stamp === key} onclick={() => (editor.stamp = key)} title={s.description}>
        <Icon name={s.icon ?? 'stamp'} size={15} /> <span>{s.name}</span>
      </button>
    {/each}
    <div class="faint small">Select things and use ⌘K → "Make stamp" to save your own.</div>
  </div>
{/if}

{#if editor.selection.length && editor.tool === 'select'}
  <div class="selbar">
    <span class="count">{editor.selection.length === 1 ? one?.id : `${editor.selection.length} selected`}</span>
    {#if shapes.length}
      <div class="seg">
        <button class:on={kind === 'box'} onclick={() => conv('box')} title="Box (B)">Box</button>
        <button class:on={kind === 'ramp'} onclick={() => conv('ramp')} title="Ramp (R, again to turn)">Ramp</button>
        <button class:on={kind === 'stairs'} onclick={() => conv('stairs')} title="Stairs (Shift+S)">Stairs</button>
        <button class:on={kind === 'prism' || kind === 'cylinder'} onclick={() => conv('prism')} title="Round / N-gon prism (C)">Round</button>
        <button class:on={kind === 'blob'} onclick={() => conv('blob')} title="Blob (O)">Blob</button>
      </div>
      <button class="btn sm" class:on={hollow} onclick={() => key('h')} title="Hollow room (H)">Room</button>
      <button class="btn sm" onclick={() => key('x')} title="Toggle cut / solid (X)">{shapes.every((s) => s.role === 'cut') ? 'Make solid' : 'Make cut'}</button>
    {/if}
    <button class="btn sm ghost" onclick={() => A.duplicate()} title="Duplicate (⌘D) — or Alt-drag"><Icon name="copy" size={13} /></button>
    <button class="btn sm ghost" onclick={() => editor.engine?.frameSelection()} title="Frame (F)"><Icon name="search" size={13} /></button>
    <button class="btn sm ghost danger" onclick={() => editor.remove(editor.selection)} title="Delete (⌫)"><Icon name="trash" size={13} /></button>
  </div>
{/if}

<style>
  .toolbar { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 2px; padding: 5px; background: rgba(31, 35, 42, 0.94); border: 1px solid var(--line2); border-radius: 12px; box-shadow: var(--shadow); z-index: 4; }
  .tool { position: relative; width: 38px; height: 38px; display: grid; place-items: center; border-radius: 8px; color: #b8c0cc; }
  .tool:hover { background: #2d333d; color: var(--text); }
  .tool.on { background: var(--accent2); color: white; }
  .k { position: absolute; right: 3px; bottom: 2px; font: 700 8.5px/1 var(--mono); opacity: 0.55; }
  .flyout { position: absolute; left: 66px; top: 50%; transform: translateY(-50%); width: 190px; background: rgba(31, 35, 42, 0.96); border: 1px solid var(--line2); border-radius: 10px; padding: 8px; display: flex; flex-direction: column; gap: 2px; box-shadow: var(--shadow); z-index: 4; }
  .st { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; text-align: left; color: #cfd6df; cursor: pointer; }
  .st:hover { background: #2d333d; }
  .st.on { background: rgba(77, 163, 255, 0.18); color: #d8eaff; }
  .small { font-size: 11px; padding: 6px 4px 0; }
  .shapes { width: 200px; }
  .stepper { display: inline-flex; align-items: center; gap: 2px; background: #14171c; border: 1px solid var(--line2); border-radius: 6px; }
  .stepper button { width: 20px; height: 20px; border-radius: 5px; color: var(--dim); }
  .stepper button:hover { background: #343b46; color: var(--text); }
  .stepper b { font: 600 11px var(--mono); min-width: 16px; text-align: center; }
  .selbar { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 6px; padding: 5px 6px 5px 12px; background: rgba(31, 35, 42, 0.95); border: 1px solid var(--line2); border-radius: 10px; box-shadow: var(--shadow); z-index: 4; white-space: nowrap; }
  .count { font-weight: 600; font-size: 12px; margin-right: 4px; font-family: var(--mono); }
  .btn.on { border-color: var(--accent); color: #bcdcff; }
</style>
