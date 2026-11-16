<script lang="ts">
  import { editor } from '$lib/editor/editor.svelte';
  import { handleKey } from '$lib/editor/shortcuts';
  import TopBar from './TopBar.svelte';
  import LeftPanel from './LeftPanel.svelte';
  import Inspector from './Inspector.svelte';
  import Viewport from './Viewport.svelte';
  import Modals from './Modals.svelte';

  function beforeUnload(e: BeforeUnloadEvent) {
    if (editor.saveState === 'dirty' || editor.saveState === 'saving') {
      editor.save(true);
      e.preventDefault();
    }
  }
</script>

<svelte:window onkeydown={handleKey} onbeforeunload={beforeUnload} />

<div class="shell" class:hide-labels={!editor.showLabels}>
  <TopBar />
  <div class="body">
    {#if editor.leftPanel && !editor.walking}<LeftPanel />{/if}
    <div class="center"><Viewport /></div>
    {#if editor.rightPanel && !editor.walking}<Inspector />{/if}
  </div>
  <Modals />
</div>

<style>
  .shell { height: 100vh; display: flex; flex-direction: column; }
  .body { flex: 1; display: flex; min-height: 0; }
  .center { flex: 1; position: relative; min-width: 0; }
</style>
