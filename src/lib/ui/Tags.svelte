<script lang="ts">
  import { editor } from '$lib/editor/editor.svelte';
  import { slug } from '$lib/model/ids';
  import type { TagCategory, TagDef } from '$lib/model/types';
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';

  const cats: TagCategory[] = ['geometry', 'zone', 'flow', 'object', 'actor', 'point', 'style'];
  let q = $state('');
  let open = $state<string | null>(null);
  let newName = $state('');
  const used = $derived.by(() => {
    const m: Record<string, number> = {};
    for (const e of editor.level.elements) for (const t of e.tags) m[t] = (m[t] ?? 0) + 1;
    return m;
  });
  const list = $derived(Object.entries(editor.project.tags).filter(([k]) => !q || k.includes(q.toLowerCase())));
  function upd(k: string, fn: (d: TagDef) => void) {
    editor.updateProject((p) => {
      fn(p.tags[k]);
      return p;
    });
    editor.engine?.rebuildAll();
  }
  function add() {
    const k = slug(newName);
    if (!k) return;
    editor.ensureTag(k);
    open = k;
    newName = '';
  }
  function del(k: string) {
    if (used[k] && !confirm(`#${k} is used by ${used[k]} element(s) in this level. Delete the definition anyway? (Elements keep the tag text.)`)) return;
    editor.updateProject((p) => {
      delete p.tags[k];
      return p;
    });
  }
</script>

<Modal title="Tag library" width={680}>
  <div class="muted">Tags are your vocabulary. The description is what the AI reads, so say what the thing <i>is</i> and how it should behave.</div>
  <div class="row">
    <input class="input grow" placeholder="Filter…" bind:value={q} onkeydown={(e) => e.stopPropagation()} />
    <input class="input" style="width:180px" placeholder="new tag name" bind:value={newName} onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') add(); }} />
    <button class="btn" onclick={add}><Icon name="plus" size={13} /> Add</button>
  </div>
  {#each cats as cat}
    {@const items = list.filter(([, d]) => d.category === cat)}
    {#if items.length}
      <div class="section-title">{cat}</div>
      <div class="grid">
        {#each items as [k, d] (k)}
          <div class="tg" class:open={open === k}>
            <button class="th" onclick={() => (open = open === k ? null : k)}>
              <span class="dot" style="--c:{d.color}"></span><b class="grow">{k}</b>
              {#if used[k]}<span class="faint">{used[k]}×</span>{/if}
            </button>
            {#if open === k}
              <div class="ed">
                <div class="row">
                  <input type="color" value={d.color} onchange={(e) => upd(k, (x) => (x.color = (e.target as HTMLInputElement).value))} />
                  <select class="input" value={d.category} onchange={(e) => upd(k, (x) => (x.category = (e.target as HTMLSelectElement).value as TagCategory))}>
                    {#each cats as c}<option value={c}>{c}</option>{/each}
                  </select>
                  <button class="btn sm ghost danger" onclick={() => del(k)}><Icon name="trash" size={13} /></button>
                </div>
                <textarea class="input" rows="2" value={d.description} placeholder="What is it? How should it behave?" onchange={(e) => upd(k, (x) => (x.description = (e.target as HTMLTextAreaElement).value))} onkeydown={(e) => e.stopPropagation()}></textarea>
                {#if d.category === 'object' || d.category === 'actor' || d.category === 'point'}
                  <div class="row small"><span class="faint">Proxy size</span>
                    {#each [0, 1, 2] as i}<input class="input num" type="number" step="0.1" value={d.proxy?.[i] ?? 0.5} onchange={(e) => upd(k, (x) => { x.proxy = [...(x.proxy ?? [0.5, 0.5, 0.5])] as any; x.proxy![i] = Number((e.target as HTMLInputElement).value); })} />{/each}
                    <label class="row"><input type="checkbox" checked={!!d.needsFacing} onchange={(e) => upd(k, (x) => (x.needsFacing = (e.target as HTMLInputElement).checked))} /> facing matters</label>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/each}
</Modal>

<style>
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; align-items: start; }
  .tg { border: 1px solid var(--line2); border-radius: 8px; background: #1a1d23; }
  .tg.open { grid-column: span 3; border-color: var(--accent); }
  .th { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 9px; text-align: left; font-size: 12.5px; }
  .ed { padding: 0 9px 9px; display: flex; flex-direction: column; gap: 6px; }
  input[type='color'] { width: 34px; height: 28px; border: 1px solid var(--line2); border-radius: 6px; background: none; padding: 2px; }
  .num { width: 64px; }
  .small { font-size: 12px; }
</style>
