<script lang="ts">
  import { onMount } from 'svelte';
  import { editor } from '$lib/editor/editor.svelte';
  import Welcome from '$lib/ui/Welcome.svelte';
  import EditorShell from '$lib/ui/EditorShell.svelte';
  import Toasts from '$lib/ui/Toasts.svelte';
  let error = $state('');
  onMount(() => {
    editor.boot().catch((e) => (error = e.message));
  });
</script>

{#if error}
  <div class="boot">Could not reach the Blockout server: {error}</div>
{:else if !editor.ready}
  <div class="boot"><div class="spinner"></div></div>
{:else if !editor.root}
  <Welcome />
{:else}
  <EditorShell />
{/if}
<Toasts />

<style>
  .boot { height: 100vh; display: grid; place-items: center; color: var(--dim); }
  .spinner { width: 26px; height: 26px; border-radius: 50%; border: 3px solid #2e343e; border-top-color: var(--accent); animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
