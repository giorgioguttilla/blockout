<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type BrowseResult } from '$lib/editor/api';
  import Icon from './Icon.svelte';

  let { mode = 'open', start = '', onpick, oncancel }: { mode?: 'open' | 'create'; start?: string; onpick: (path: string) => void; oncancel: () => void } = $props();
  let res = $state<BrowseResult | null>(null);
  let pathInput = $state('');
  let name = $state('my-game-design');
  let err = $state('');

  async function go(p?: string) {
    err = '';
    try {
      res = await api.browse(p);
      pathInput = res.path;
    } catch (e) {
      err = (e as Error).message;
    }
  }
  onMount(() => go(start || undefined));

  const crumbs = $derived.by(() => {
    if (!res) return [];
    const parts = res.path.split('/').filter(Boolean);
    return parts.map((p, i) => ({ name: p, path: '/' + parts.slice(0, i + 1).join('/') }));
  });

  function pick() {
    if (!res) return;
    if (mode === 'create') onpick(res.path.replace(/\/$/, '') + '/' + name.trim());
    else onpick(res.path);
  }
</script>

<div class="backdrop" onclick={oncancel} role="presentation"></div>
<div class="picker" role="dialog" aria-label="Choose a folder">
  <header>
    <div class="title">{mode === 'create' ? 'Where should the new project live?' : 'Open a folder'}</div>
    <div class="muted">{mode === 'create' ? 'Pick a parent folder (e.g. your game repo), then name the design folder.' : 'Any folder works — Blockout adds blockout.project.json and a levels/ folder if they are missing.'}</div>
  </header>
  <div class="bar">
    <button class="btn sm ghost" disabled={!res?.parent} onclick={() => res?.parent && go(res.parent)} title="Up one level"><Icon name="up" size={14} /></button>
    <button class="btn sm ghost" onclick={() => go(res?.home)} title="Home">~</button>
    <input class="input grow mono" bind:value={pathInput} onkeydown={(e) => e.key === 'Enter' && go(pathInput)} spellcheck="false" />
  </div>
  <div class="crumbs">
    {#each crumbs as c, i}
      <button onclick={() => go(c.path)}>{c.name}</button>{#if i < crumbs.length - 1}<span class="faint">/</span>{/if}
    {/each}
    {#if res?.isProject}<span class="chip proj">Blockout project</span>{/if}
  </div>
  <div class="list scroll">
    {#if err}<div class="err">{err}</div>{/if}
    {#each res?.dirs ?? [] as d}
      <button class="dir" ondblclick={() => (mode === 'open' && d.isProject ? onpick(d.path) : go(d.path))} onclick={() => go(d.path)}>
        <Icon name="folder" size={15} />
        <span class="grow">{d.name}</span>
        {#if d.isProject}<span class="chip proj">project</span>{/if}
      </button>
    {:else}
      <div class="empty faint">No sub-folders</div>
    {/each}
  </div>
  <footer>
    {#if mode === 'create'}
      <label class="row grow"><span class="muted">Folder name</span><input class="input grow" bind:value={name} /></label>
    {:else}
      <div class="grow faint mono small">{res?.path}</div>
    {/if}
    <button class="btn" onclick={oncancel}>Cancel</button>
    <button class="btn primary" onclick={pick} disabled={!res || (mode === 'create' && !name.trim())}>{mode === 'create' ? 'Create project' : res?.isProject ? 'Open project' : 'Use this folder'}</button>
  </footer>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(5, 6, 8, 0.6); z-index: 50; backdrop-filter: blur(2px); }
  .picker { position: fixed; z-index: 51; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(640px, 94vw); height: min(560px, 88vh); background: var(--panel); border: 1px solid var(--line2); border-radius: 12px; box-shadow: var(--shadow); display: flex; flex-direction: column; }
  header { padding: 16px 18px 10px; }
  .title { font-size: 15px; font-weight: 650; margin-bottom: 3px; }
  .bar { display: flex; gap: 6px; padding: 0 14px; }
  .mono { font-family: var(--mono); font-size: 12px; }
  .crumbs { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding: 8px 18px; color: var(--dim); font-size: 12px; }
  .crumbs button:hover { color: var(--text); text-decoration: underline; }
  .list { flex: 1; margin: 0 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg2); padding: 4px; }
  .dir { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 9px; border-radius: 6px; text-align: left; color: #cfd6df; }
  .dir:hover { background: #2a303a; }
  .proj { height: 18px; font-size: 10.5px; color: #bcdcff; background: rgba(77, 163, 255, 0.14); border-color: rgba(77, 163, 255, 0.35); }
  .empty { padding: 20px; text-align: center; }
  .err { color: var(--err); padding: 10px; }
  footer { display: flex; gap: 8px; align-items: center; padding: 12px 14px; border-top: 1px solid var(--line); margin-top: 10px; }
  .small { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
