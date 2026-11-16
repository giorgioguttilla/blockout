<script lang="ts">
  import { editor } from '$lib/editor/editor.svelte';
  import Icon from './Icon.svelte';
  let { title, width = 520, children, footer }: { title: string; width?: number; children: any; footer?: any } = $props();
</script>
<div class="card" style="width:min({width}px, 94vw)" role="dialog" aria-label={title}>
  <header><b>{title}</b><button class="btn sm ghost" onclick={() => editor.openModal(null)}><Icon name="x" size={14} /></button></header>
  <div class="body scroll">{@render children()}</div>
  {#if footer}<footer>{@render footer()}</footer>{/if}
</div>
<style>
  .card { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); max-height: 88vh; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line2); border-radius: 12px; box-shadow: var(--shadow); z-index: 71; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px 8px 16px; font-size: 14px; }
  .body { padding: 6px 16px 14px; display: flex; flex-direction: column; gap: 12px; }
  footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 14px; border-top: 1px solid var(--line); }
</style>
