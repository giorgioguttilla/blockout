<script lang="ts">
  import * as THREE from 'three';
  import { editor } from '$lib/editor/editor.svelte';
  let text = $state('');
  let ta = $state<HTMLTextAreaElement | null>(null);
  let pos = $state({ x: 0, y: 0 });
  const id = $derived(editor.editingNote);
  $effect(() => {
    const cur = id;
    if (!cur) return;
    const el = editor.get(cur);
    if (!el) return;
    text = el.notes;
    const s = editor.engine?.toScreen(new THREE.Vector3(...el.transform.position).add(new THREE.Vector3(0, 0.5, 0)));
    if (s) pos = { x: s.x, y: s.y };
    setTimeout(() => ta?.focus(), 0);
  });
  function save() {
    const cur = id;
    if (!cur) return;
    editor.editingNote = null;
    const el = editor.get(cur);
    if (!el) return;
    if (!text.trim() && !el.notes) {
      editor.remove([cur]);
      return;
    }
    if (text !== el.notes) editor.patch([cur], (e) => (e.notes = text));
  }
  function key(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); save(); }
  }
</script>
{#if id}
  <div class="ne" style="left:{pos.x}px; top:{pos.y}px">
    <textarea bind:this={ta} bind:value={text} onkeydown={key} onblur={save} rows="4" placeholder="Write a note for the AI or yourself… (Enter to save, Shift+Enter for a new line)"></textarea>
  </div>
{/if}
<style>
  .ne { position: absolute; transform: translate(-50%, -100%); z-index: 8; }
  textarea { width: 260px; background: #ffe58a; color: #2e2600; border: 0; border-radius: 4px 12px 12px 12px; padding: 9px 10px; font: 500 13px/1.4 var(--font); box-shadow: var(--shadow); resize: none; outline: 2px solid #ffcf33; }
  textarea::placeholder { color: #7a6a20; }
</style>
