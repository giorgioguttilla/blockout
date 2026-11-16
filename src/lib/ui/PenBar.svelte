<script lang="ts">
  import { editor } from '$lib/editor/editor.svelte';
  import Icon from './Icon.svelte';
  const pens = $derived(editor.project.pens.map((_, i) => editor.penInfo(i)));
</script>

<div class="penbar">
  {#each pens as p}
    <button
      class="pen"
      class:on={editor.pen === p.index}
      style="--c:{p.color}"
      onclick={() => editor.selectPen(p.index)}
      oncontextmenu={(e) => { e.preventDefault(); editor.openModal('pen-picker', p.index); }}
      title="{p.label} — {p.index} to pick, Shift+{p.index} to apply to the selection, right-click to change"
    >
      <span class="num">{p.index}</span>
      {#if p.key === '@cut'}<span class="sw cut"></span>{:else}<span class="sw"></span>{/if}
      <span class="lbl">{p.label}</span>
      <span class="edit" role="button" tabindex="-1" onclick={(e) => { e.stopPropagation(); editor.openModal('pen-picker', p.index); }} onkeydown={() => {}}>✎</span>
    </button>
  {/each}
  <button class="more" onclick={() => editor.openModal('tags')} title="Tag library"><Icon name="tag" size={14} /></button>
</div>

<style>
  .penbar { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); display: flex; gap: 3px; padding: 4px; background: rgba(31, 35, 42, 0.95); border: 1px solid var(--line2); border-radius: 12px; box-shadow: var(--shadow); z-index: 4; max-width: calc(100% - 24px); overflow-x: auto; scrollbar-width: none; }
  .pen { position: relative; display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 10px 0 8px; border-radius: 8px; color: #cdd4de; font-size: 12px; white-space: nowrap; border: 1px solid transparent; }
  .pen:hover { background: #2a303a; }
  .pen.on { background: #2c3440; border-color: var(--c); color: white; box-shadow: 0 0 0 1px var(--c) inset; }
  .num { font: 700 10px/1 var(--mono); color: var(--faint); }
  .pen.on .num { color: var(--c); }
  .sw { width: 12px; height: 12px; border-radius: 3px; background: var(--c); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4) inset; }
  .sw.cut { background: repeating-linear-gradient(45deg, #ff5a5f 0 3px, transparent 3px 6px); border: 1px solid #ff5a5f; }
  .edit { display: none; position: absolute; top: -6px; right: -4px; width: 16px; height: 16px; font-size: 10px; line-height: 16px; text-align: center; border-radius: 50%; background: #3a414d; color: white; }
  .pen:hover .edit { display: block; }
  .more { width: 34px; display: grid; place-items: center; border-radius: 8px; color: var(--dim); }
  .more:hover { background: #2a303a; color: var(--text); }
</style>
