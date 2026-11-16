<script lang="ts">
  import { onMount } from 'svelte';
  let { onclose, children, align = 'left' }: { onclose: () => void; children: any; align?: 'left' | 'right' } = $props();
  let el: HTMLDivElement;
  onMount(() => {
    const h = (e: PointerEvent) => {
      if (!el.contains(e.target as Node)) onclose();
    };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onclose();
    setTimeout(() => window.addEventListener('pointerdown', h), 0);
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('pointerdown', h);
      window.removeEventListener('keydown', k);
    };
  });
</script>
<div class="menu {align}" bind:this={el}>{@render children()}</div>
<style>
  .menu { position: absolute; top: calc(100% + 6px); min-width: 230px; max-height: 70vh; overflow: auto; background: #22262e; border: 1px solid var(--line2); border-radius: 9px; box-shadow: var(--shadow); padding: 4px; z-index: 60; }
  .menu.left { left: 0; }
  .menu.right { right: 0; }
</style>
