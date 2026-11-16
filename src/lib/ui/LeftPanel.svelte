<script lang="ts">
  import { editor } from '$lib/editor/editor.svelte';
  import type { LevelElement } from '$lib/model/types';
  import Icon from './Icon.svelte';
  import Versions from './Versions.svelte';

  let q = $state('');
  let collapsed = $state<Record<string, boolean>>({});
  const groups = $derived.by(() => {
    const s = q.trim().toLowerCase();
    const m = new Map<string, LevelElement[]>();
    for (const e of editor.level.elements) {
      if (s && !(e.id.includes(s) || (e.name ?? '').toLowerCase().includes(s) || e.tags.some((t) => t.includes(s)) || e.notes.toLowerCase().includes(s))) continue;
      const k = e.type === 'stamp' ? 'stamps' : e.type === 'note' ? 'notes' : e.tags[0] ?? (e.role === 'cut' ? 'cuts' : e.role === 'zone' ? 'zones' : 'geometry');
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    const order = (k: string) => (k === 'geometry' ? 0 : k === 'cuts' ? 1 : k === 'notes' ? 9 : k === 'stamps' ? 8 : 2);
    return [...m.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
  });
  function click(e: MouseEvent, id: string) {
    if (e.shiftKey || e.metaKey) editor.selection = editor.selection.includes(id) ? editor.selection.filter((x) => x !== id) : [...editor.selection, id];
    else editor.selection = [id];
    if (editor.tool !== 'select') editor.setTool('select');
  }
  function selectGroup(list: LevelElement[]) {
    editor.selection = list.map((e) => e.id);
    if (editor.tool !== 'select') editor.setTool('select');
  }
  const icon = (e: LevelElement) => (e.type === 'shape' ? (e.role === 'cut' ? 'x' : 'box') : e.type === 'path' ? 'line' : e.type === 'marker' ? 'marker' : e.type === 'stamp' ? 'stamp' : 'note');
  const color = (k: string) => (k === 'geometry' ? '#c9ced6' : k === 'cuts' ? '#ff5a5f' : k === 'notes' ? '#ffd54f' : k === 'stamps' ? '#4da3ff' : k === 'zones' ? '#9e9e9e' : editor.tagColor(k));
</script>

<aside class="lp">
  <div class="tabs">
    <button class:on={editor.leftTab === 'elements'} onclick={() => (editor.leftTab = 'elements')}><Icon name="layers" size={14} /> Elements <span class="faint">{editor.level.elements.length}</span></button>
    <button class:on={editor.leftTab === 'versions'} onclick={() => (editor.leftTab = 'versions')}><Icon name="history" size={14} /> Versions <span class="faint">{editor.versions.length}</span></button>
  </div>
  {#if editor.leftTab === 'elements'}
    <div class="search"><input class="input" placeholder="Filter by id, tag, note…" bind:value={q} onkeydown={(e) => e.stopPropagation()} /></div>
    <div class="list scroll">
      {#each groups as [k, list]}
        <div class="grp">
          <div class="gh" role="button" tabindex="-1" onclick={() => (collapsed[k] = !collapsed[k])} onkeydown={() => {}}>
            <span class="caret" class:open={!collapsed[k]}><Icon name="chevron" size={11} /></span>
            <span class="dot" style="--c:{color(k)}"></span>
            <span class="grow">{k === 'geometry' || k === 'cuts' || k === 'zones' || k === 'notes' || k === 'stamps' ? k : '#' + k}</span>
            <span class="faint">{list.length}</span>
            <button class="sa" onclick={(ev) => { ev.stopPropagation(); selectGroup(list); }} title="Select all">all</button>
          </div>
          {#if !collapsed[k]}
            {#each list as e (e.id)}
              <div class="it" class:sel={editor.selection.includes(e.id)} class:hid={e.hidden} role="button" tabindex="-1"
                onclick={(ev) => click(ev, e.id)} ondblclick={() => editor.engine?.frameSelection()}
                onmouseenter={() => { editor.hovered = e.id; editor.engine?.refreshHighlights(); }}
                onmouseleave={() => { editor.hovered = null; editor.engine?.refreshHighlights(); }} onkeydown={() => {}}>
                <span class="ic"><Icon name={icon(e)} size={13} /></span>
                <span class="grow name">{e.name || e.id}{#if e.type === 'note'}<span class="faint"> — {e.notes.slice(0, 40)}</span>{/if}</span>
                {#if e.tags.length > 1}<span class="faint tags">+{e.tags.length - 1}</span>{/if}
                <button class="eye" onclick={(ev) => { ev.stopPropagation(); editor.patch([e.id], (x) => (x.hidden = !x.hidden || undefined)); }} title={e.hidden ? 'Show' : 'Hide'}>
                  <Icon name={e.hidden ? 'eyeoff' : 'eye'} size={13} />
                </button>
              </div>
            {/each}
          {/if}
        </div>
      {:else}
        <div class="empty faint">{q ? 'Nothing matches' : 'Nothing here yet — press D and drag in the viewport.'}</div>
      {/each}
    </div>
  {:else}
    <Versions />
  {/if}
</aside>

<style>
  .lp { width: 248px; flex: none; background: var(--panel); border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; }
  .tabs { display: flex; padding: 6px; gap: 2px; border-bottom: 1px solid var(--line); }
  .tabs button { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; height: 28px; border-radius: 6px; color: var(--dim); font-size: 12px; }
  .tabs button.on { background: #2a303a; color: var(--text); }
  .search { padding: 8px; }
  .list { flex: 1; padding: 0 6px 10px; }
  .gh { display: flex; align-items: center; gap: 6px; padding: 5px 4px; font-weight: 600; font-size: 12px; color: #cfd6df; cursor: pointer; border-radius: 5px; }
  .gh:hover { background: #262b33; }
  .caret { display: inline-flex; transition: transform 0.12s; color: var(--faint); }
  .caret.open { transform: rotate(90deg); }
  .sa { font-size: 10.5px; color: var(--faint); padding: 1px 5px; border-radius: 4px; opacity: 0; }
  .gh:hover .sa { opacity: 1; }
  .sa:hover { background: #343b46; color: var(--text); }
  .it { display: flex; align-items: center; gap: 6px; padding: 4px 4px 4px 22px; border-radius: 5px; font-size: 12px; cursor: default; color: #c3cad4; }
  .it:hover { background: #262b33; }
  .it.sel { background: rgba(77, 163, 255, 0.16); color: white; }
  .it.hid { opacity: 0.45; }
  .ic { color: var(--faint); display: inline-flex; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mono); font-size: 11.5px; }
  .eye { opacity: 0; color: var(--faint); display: inline-flex; }
  .it:hover .eye, .it.hid .eye { opacity: 1; }
  .tags { font-size: 10px; }
  .empty { padding: 20px 10px; text-align: center; font-size: 12px; }
</style>
