<script lang="ts">
  import { editor } from '$lib/editor/editor.svelte';
  import { onMount } from 'svelte';
  let { onpick, oncancel, autofocus = true, placeholder = 'tag…', exclude = [] }: { onpick: (t: string) => void; oncancel?: () => void; autofocus?: boolean; placeholder?: string; exclude?: string[] } = $props();
  let q = $state('');
  let idx = $state(0);
  let input: HTMLInputElement;
  const all = $derived(Object.entries(editor.project.tags));
  const list = $derived.by(() => {
    const s = q.trim().toLowerCase();
    const r = all.filter(([k]) => !exclude.includes(k) && (!s || k.includes(s)));
    r.sort((a, b) => (a[0].startsWith(s) ? 0 : 1) - (b[0].startsWith(s) ? 0 : 1) || a[0].localeCompare(b[0]));
    return r.slice(0, 8);
  });
  const isNew = $derived(q.trim() && !editor.project.tags[q.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')]);
  onMount(() => {
    if (autofocus) setTimeout(() => input?.focus(), 0);
  });
  function key(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'ArrowDown') { idx = Math.min(idx + 1, list.length - (isNew ? 0 : 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); e.preventDefault(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = idx < list.length ? list[idx]?.[0] : q.trim();
      if (pick) { onpick(pick); q = ''; idx = 0; }
      else if (q.trim()) { onpick(q.trim()); q = ''; }
    } else if (e.key === 'Escape') oncancel?.();
  }
</script>
<div class="ti">
  <input bind:this={input} class="input" bind:value={q} oninput={() => (idx = 0)} onkeydown={key} {placeholder} spellcheck="false" />
  {#if q || autofocus}
    <div class="sug">
      {#each list as [k, d], i}
        <button class:on={i === idx} onmousedown={(e) => { e.preventDefault(); onpick(k); q = ''; }} style="--c:{d.color}">
          <span class="dot"></span><span class="grow">{k}</span><span class="faint cat">{d.category}</span>
        </button>
      {/each}
      {#if isNew}
        <button class:on={idx === list.length} onmousedown={(e) => { e.preventDefault(); onpick(q.trim()); q = ''; }}>
          <span class="faint">+ new tag</span> <b>{q.trim()}</b>
        </button>
      {/if}
    </div>
  {/if}
</div>
<style>
  .ti { position: relative; }
  .sug { position: absolute; top: calc(100% + 4px); left: 0; right: 0; min-width: 200px; background: #22262e; border: 1px solid var(--line2); border-radius: 8px; padding: 3px; z-index: 30; box-shadow: var(--shadow); }
  .sug:empty { display: none; }
  .sug button { display: flex; align-items: center; gap: 7px; width: 100%; padding: 5px 8px; border-radius: 5px; text-align: left; font-size: 12px; }
  .sug button.on, .sug button:hover { background: #2f3641; }
  .cat { font-size: 10.5px; }
</style>
