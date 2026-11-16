<script lang="ts">
  import { editor } from '$lib/editor/editor.svelte';
  import { diffLevels, diffSummary } from '$lib/model/diff';
  const ext = $derived(editor.external ? diffSummary(diffLevels(editor.level, editor.external)) : '');
  const cmp = $derived(editor.compare ? diffLevels(editor.compare.base, editor.level) : null);
</script>
{#if editor.external}
  <div class="banner ext">
    <b>level.json changed on disk</b> <span class="muted">(an AI or another tool edited it: {ext})</span>
    <button class="btn sm primary" onclick={() => editor.acceptExternal()}>Load changes</button>
    <button class="btn sm" onclick={() => { editor.external = null; editor.scheduleSave(); }}>Keep mine</button>
  </div>
{/if}
{#if editor.compare && cmp}
  <div class="banner cmp">
    <b>Comparing with {editor.compare.label}</b>
    <span class="l add">+{cmp.added.length} added</span>
    <span class="l rem">−{cmp.removed.length} removed</span>
    <span class="l chg">~{cmp.modified.length} changed</span>
    <button class="btn sm" onclick={() => (editor.compare = null)}>Done <kbd>Esc</kbd></button>
  </div>
{/if}
<style>
  .banner { position: absolute; top: 60px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; padding: 7px 8px 7px 14px; border-radius: 10px; background: #242a33; border: 1px solid var(--line2); box-shadow: var(--shadow); z-index: 5; white-space: nowrap; font-size: 12.5px; }
  .banner.ext { border-color: #8a6a10; top: 104px; }
  .l { font-weight: 600; font-size: 12px; }
  .add { color: #6fdc8c; }
  .rem { color: #ff7a7a; }
  .chg { color: #ffc14d; }
</style>
