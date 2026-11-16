<script lang="ts">
  import { editor } from '$lib/editor/editor.svelte';
  import TagInput from './TagInput.svelte';
  let open = $state(false);
  let timer: ReturnType<typeof setTimeout>;
  const it = $derived(editor.inlineTag);
  const el = $derived(it ? editor.get(it.id) : null);
  $effect(() => {
    const cur = editor.inlineTag;
    open = !!(cur as any)?.open;
    clearTimeout(timer);
    if (cur && !open) timer = setTimeout(() => { if (!open && editor.inlineTag === cur) editor.inlineTag = null; }, 8000);
  });
  $effect(() => {
    // hide when the element goes away or the selection moves on
    if (it && (!el || (editor.selection.length && !editor.selection.includes(it.id)))) editor.inlineTag = null;
  });
  function pick(t: string) {
    if (!it) return;
    editor.addTag([it.id], t);
    open = false;
    editor.inlineTag = null;
  }
</script>
{#if it && el}
  <div class="it" style="left:{Math.max(8, it.x)}px; top:{Math.max(8, it.y - 40)}px">
    {#if open}
      <div class="box"><TagInput onpick={pick} oncancel={() => (editor.inlineTag = null)} exclude={el.tags} placeholder="tag it: trees, chest, enemy…" /></div>
    {:else}
      <button class="chip add" onclick={() => (open = true)} title="Add a tag (#)"># tag {el.id}</button>
    {/if}
  </div>
{/if}
<style>
  .it { position: absolute; z-index: 6; transform: translateX(-50%); }
  .add { cursor: pointer; background: rgba(43, 111, 208, 0.9); border-color: #4d8ef7; color: white; animation: pop 0.18s ease-out; }
  .add:hover { background: #2f7fe0; }
  .box { width: 230px; }
  @keyframes pop { from { transform: scale(0.8); opacity: 0; } }
</style>
