<script lang="ts">
  import { editor } from '$lib/editor/editor.svelte';
  import { fly } from 'svelte/transition';
</script>
<div class="toasts">
  {#each editor.toasts as t (t.id)}
    <div class="toast {t.kind}" transition:fly={{ y: 10, duration: 160 }}>
      <span>{t.text}</span>
      {#if t.action}<button class="btn sm" onclick={() => { t.action?.run(); editor.toasts = editor.toasts.filter((x) => x.id !== t.id); }}>{t.action.label}</button>{/if}
    </div>
  {/each}
</div>
<style>
  .toasts { position: fixed; bottom: 86px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 6px; z-index: 100; pointer-events: none; }
  .toast { pointer-events: auto; display: flex; gap: 10px; align-items: center; background: #262b34; border: 1px solid var(--line2); padding: 7px 12px; border-radius: 8px; box-shadow: var(--shadow); font-size: 12.5px; max-width: 70vw; }
  .toast.ok { border-color: #2f7d50; }
  .toast.warn { border-color: #8a6a10; }
  .toast.error { border-color: #a23a3d; background: #2e2224; }
</style>
