<script lang="ts">
  import { onMount } from 'svelte';
  import { editor } from '$lib/editor/editor.svelte';
  import { Engine } from '$lib/engine/Engine';
  import Toolbar from './Toolbar.svelte';
  import PenBar from './PenBar.svelte';
  import InlineTag from './InlineTag.svelte';
  import NoteEditor from './NoteEditor.svelte';
  import ViewControls from './ViewControls.svelte';
  import AnalysisPanel from './AnalysisPanel.svelte';
  import Banners from './Banners.svelte';
  import Icon from './Icon.svelte';

  let host: HTMLDivElement;
  let engine: Engine | null = null;

  onMount(() => {
    engine = new Engine(editor);
    engine.mount(host);
    return () => engine?.destroy();
  });

  // keep the engine in sync with UI state that lives in the editor store
  $effect(() => {
    editor.selection;
    editor.engine?.refreshHighlights();
    editor.engine?.tools?.tools.select && (editor.engine.tools.tools.select as any).refreshHandles?.();
  });
  $effect(() => {
    editor.compare;
    editor.engine?.syncCompare();
    editor.engine?.refreshHighlights();
  });
  $effect(() => {
    editor.planeY;
    editor.section;
    editor.showScale;
    editor.engine?.invalidate();
  });
  $effect(() => {
    const t = editor.tool;
    editor.engine?.tools?.activate(t);
  });
  $effect(() => {
    editor.drawShape;
    editor.ngonSides;
    if (editor.tool === 'draw') editor.engine?.tools?.rehover();
  });
  $effect(() => {
    if (!editor.showAnalysis) editor.engine?.showAnalysis(null);
  });
  $effect(() => {
    editor.project.character;
    editor.engine?.refreshCapsule?.();
  });
</script>

<div class="viewport" bind:this={host} data-tool={editor.tool}>
  {#if !editor.walking}
    <Toolbar />
    <PenBar />
    <ViewControls />
    <div class="hint">{editor.hint}</div>
    {#if editor.hud}
      <div class="hud" style="left:{editor.hud.x + 18}px; top:{editor.hud.y + 18}px">
        <b>{editor.hud.text}</b>{#if editor.hud.input}<span>{editor.hud.input}</span>{/if}
      </div>
    {/if}
    {#if editor.marquee}
      {@const m = editor.marquee}
      <div class="marquee" style="left:{m.x0}px; top:{m.y0}px; width:{m.x1 - m.x0}px; height:{m.y1 - m.y0}px"></div>
    {/if}
    <InlineTag />
    <NoteEditor />
    <Banners />
    {#if editor.showAnalysis && editor.analysis}<AnalysisPanel />{/if}
    {#if editor.level.elements.length === 0}
      <div class="empty">
        <div class="big">Start drawing</div>
        <div><kbd>D</kbd> drag on the grid to draw a box · click-click-click for any shape</div>
        <div>Pick a pen first (<kbd>2</kbd> trees, <kbd>3</kbd> chest…) to draw meaning, not just geometry</div>
        <div class="faint">Right-drag to orbit · scroll to zoom · two fingers on a trackpad to orbit, pinch to zoom · <kbd>Tab</kbd> top view</div>
      </div>
    {/if}
  {:else}
    <div class="walkhud">
      <div class="row"><Icon name="walk" /> <b>Walk mode</b> <span class="faint">click to capture the mouse</span></div>
      <div class="keys"><kbd>WASD</kbd> move <kbd>Shift</kbd> sprint <kbd>Space</kbd> jump <kbd>C</kbd> camera <kbd>R</kbd> respawn <kbd>Esc</kbd> exit</div>
      {#if editor.walkStats}
        <div class="stats">
          <span>{editor.walkStats.speed.toFixed(1)} m/s{editor.walkStats.sprint ? ' (sprint)' : ''}</span>
          <span>{editor.walkStats.grounded ? 'grounded' : `airborne ${editor.walkStats.airtime.toFixed(2)} s`}</span>
          <span>last jump peak {editor.walkStats.peak.toFixed(2)} m</span>
        </div>
      {/if}
    </div>
    <div class="crosshair"></div>
  {/if}
</div>

<style>
  .viewport { position: absolute; inset: 0; overflow: hidden; background: #1d2026; }
  .viewport :global(canvas.viewport-canvas) { display: block; outline: none; }
  .viewport[data-tool='draw'] :global(canvas), .viewport[data-tool='line'] :global(canvas), .viewport[data-tool='marker'] :global(canvas), .viewport[data-tool='note'] :global(canvas), .viewport[data-tool='tape'] :global(canvas), .viewport[data-tool='stamp'] :global(canvas) { cursor: crosshair; }
  .viewport :global(.on-handle canvas) { cursor: grab !important; }
  :global(.can-pan) :global(canvas), :global(.panning) :global(canvas) { cursor: grab !important; }
  :global(.orbiting canvas) { cursor: move !important; }
  .hint { position: absolute; left: 12px; bottom: 58px; max-width: 62%; font-size: 12px; color: var(--dim); background: rgba(21, 23, 28, 0.82); border: 1px solid var(--line); padding: 5px 9px; border-radius: 7px; pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hud { position: absolute; pointer-events: none; display: flex; flex-direction: column; gap: 2px; background: #2b6fd0; color: white; padding: 5px 8px; border-radius: 6px; font-size: 12px; box-shadow: var(--shadow); z-index: 5; }
  .hud span { font-size: 10.5px; opacity: 0.8; }
  .marquee { position: absolute; border: 1px solid var(--accent); background: rgba(77, 163, 255, 0.1); pointer-events: none; }
  .empty { position: absolute; left: 50%; top: 38%; transform: translate(-50%, -50%); text-align: center; color: var(--dim); display: flex; flex-direction: column; gap: 8px; pointer-events: none; background: rgba(21, 23, 28, 0.7); padding: 20px 26px; border-radius: 14px; border: 1px solid var(--line); }
  .empty .big { font-size: 20px; color: var(--text); font-weight: 650; }
  .walkhud { position: absolute; left: 16px; top: 14px; background: rgba(21, 23, 28, 0.85); border: 1px solid var(--line2); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
  .walkhud .keys { color: var(--dim); display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .walkhud .stats { display: flex; gap: 14px; font-family: var(--mono); font-size: 11.5px; color: #bcdcff; }
  .crosshair { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px; border-radius: 50%; background: rgba(255, 255, 255, 0.8); box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.4); pointer-events: none; }
</style>
