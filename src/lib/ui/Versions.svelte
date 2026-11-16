<script lang="ts">
  import { editor } from '$lib/editor/editor.svelte';
  import Icon from './Icon.svelte';
  const list = $derived([...editor.versions].reverse());
  function ago(t: string) {
    const s = (Date.now() - new Date(t).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return new Date(t).toLocaleDateString();
  }
</script>
<div class="vp">
  <button class="btn primary save" onclick={() => editor.openModal('save-version')}><Icon name="check" size={14} /> Save version <kbd>⌘S</kbd></button>
  <div class="hint faint">Your work autosaves. Versions are named snapshots you can compare, restore or branch. Handoffs are saved as versions automatically.</div>
  <div class="list scroll">
    {#each list as v (v.n)}
      <div class="v" class:cmp={editor.compare?.label.startsWith('v' + v.n + ' ')}>
        <div class="row">
          <span class="n">v{v.n}</span>
          <span class="grow msg">{v.message}</span>
        </div>
        <div class="row meta">
          <span class="faint">{ago(v.time)}</span>
          {#if v.baseline}<span class="chip b" title="The version your AI last built from">built</span>{:else if v.handoff}<span class="chip h">handoff</span>{/if}
          <span class="grow"></span>
          <button class="a" onclick={() => editor.compareWith(v.n)} title="Compare with the current level"><Icon name="compare" size={13} /></button>
          <button class="a" onclick={() => editor.restoreVersion(v.n)} title="Restore (undoable)"><Icon name="restore" size={13} /></button>
          <button class="a" onclick={() => editor.branchVersion(v.n)} title="Branch into a new level"><Icon name="branch" size={13} /></button>
        </div>
      </div>
    {:else}
      <div class="empty faint">No versions yet.</div>
    {/each}
  </div>
</div>
<style>
  .vp { display: flex; flex-direction: column; min-height: 0; flex: 1; padding: 8px; gap: 8px; }
  .save { justify-content: center; }
  .save kbd { background: rgba(0, 0, 0, 0.2); border-color: rgba(255, 255, 255, 0.2); color: #e0ecff; }
  .hint { font-size: 11px; line-height: 1.45; }
  .list { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .v { padding: 7px 8px; border-radius: 7px; background: #242931; border: 1px solid transparent; }
  .v:hover { border-color: var(--line2); }
  .v.cmp { border-color: var(--warn); }
  .n { font: 700 11px var(--mono); color: #9ccaff; }
  .msg { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
  .meta { margin-top: 3px; font-size: 11px; gap: 4px; }
  .chip { height: 17px; font-size: 10px; padding: 0 6px; }
  .chip.b { background: rgba(67, 209, 122, 0.15); border-color: #2f7d50; color: #8ff0b1; }
  .chip.h { color: #bcdcff; }
  .a { width: 22px; height: 22px; display: grid; place-items: center; border-radius: 5px; color: var(--faint); }
  .a:hover { background: #343b46; color: var(--text); }
  .empty { text-align: center; padding: 20px; }
</style>
