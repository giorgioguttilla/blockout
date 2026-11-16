<script lang="ts">
  import { editor } from '$lib/editor/editor.svelte';
  import FolderPicker from './FolderPicker.svelte';
  import Icon from './Icon.svelte';

  let picker = $state<null | 'open' | 'create'>(null);
  let busy = $state(false);
  let err = $state('');

  async function open(path: string, opts: { create?: boolean; demo?: boolean } = {}) {
    busy = true;
    err = '';
    try {
      await editor.openFolder(path, opts);
    } catch (e) {
      err = (e as Error).message;
    } finally {
      busy = false;
      picker = null;
    }
  }
  const demoPath = $derived(editor.home + '/Blockout/Demo');
  const short = (p: string) => p.replace(editor.home, '~');
</script>

<main>
  <section class="hero">
    <div class="logo">
      <svg viewBox="0 0 64 64" width="56" height="56"><rect x="6" y="26" width="28" height="30" rx="2" fill="#c9ced6" /><rect x="26" y="12" width="32" height="22" rx="2" fill="#f2b94b" /><rect x="34" y="40" width="10" height="16" fill="#ff5a5f" opacity=".8" /><circle cx="50" cy="48" r="5" fill="#4da3ff" /></svg>
    </div>
    <h1>Blockout</h1>
    <p class="tag">Sketch levels in 3D, add tags for what goes where, and hand them to your AI to build.</p>
  </section>

  <section class="actions">
    <button class="card primary" onclick={() => open(demoPath, { create: true, demo: true })} disabled={busy}>
      <Icon name="sparkle" size={22} />
      <div><div class="t">Try the demo level</div><div class="d">Opens a sample project in {short(demoPath)}</div></div>
    </button>
    <button class="card" onclick={() => (picker = 'open')} disabled={busy}>
      <Icon name="folder" size={22} />
      <div><div class="t">Open a folder…</div><div class="d">Your repo's <code>design/</code> folder, or any folder</div></div>
    </button>
    <button class="card" onclick={() => (picker = 'create')} disabled={busy}>
      <Icon name="plus" size={22} />
      <div><div class="t">New project…</div><div class="d">Creates blockout.project.json and a first level</div></div>
    </button>
  </section>
  {#if err}<div class="err">{err}</div>{/if}

  {#if editor.recent.length}
    <section class="recent">
      <div class="section-title">Recent</div>
      {#each editor.recent as r}
        <button class="rec" onclick={() => open(r)}><Icon name="folder" size={14} /><span>{r.split('/').pop()}</span><span class="faint">{short(r)}</span></button>
      {/each}
    </section>
  {/if}

  <section class="how">
    <div><kbd>D</kbd> drag to draw a box, click to start a polygon</div>
    <div><kbd>1</kbd>–<kbd>9</kbd> pick what you're drawing (trees, chest, enemy…)</div>
    <div><kbd>G</kbd> walk around it with your character's real speed and jump</div>
    <div><kbd>⇪ Hand off</kbd> writes a brief + screenshots for your AI</div>
  </section>
</main>

{#if picker}
  <FolderPicker mode={picker} onpick={(p) => open(p, { create: picker === 'create' })} oncancel={() => (picker = null)} />
{/if}

<style>
  main { height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; background: radial-gradient(1200px 600px at 50% -10%, #263044 0%, var(--bg) 60%); padding: 30px; overflow: auto; }
  .hero { text-align: center; }
  .logo { display: inline-grid; place-items: center; width: 84px; height: 84px; border-radius: 22px; background: #1d222b; border: 1px solid var(--line2); box-shadow: var(--shadow); margin-bottom: 12px; }
  h1 { margin: 0; font-size: 34px; letter-spacing: -0.02em; }
  .tag { color: var(--dim); max-width: 520px; margin: 8px auto 0; font-size: 15px; }
  .actions { display: grid; grid-template-columns: repeat(3, minmax(0, 230px)); gap: 12px; }
  .card { display: flex; gap: 12px; align-items: flex-start; text-align: left; padding: 16px; border-radius: 12px; background: var(--panel); border: 1px solid var(--line2); transition: transform 0.1s, border-color 0.15s, background 0.15s; }
  .card:hover { transform: translateY(-2px); border-color: #4a5260; background: #232831; }
  .card.primary { background: linear-gradient(180deg, #2a5ea3, #22508c); border-color: #4d8ef7; }
  .card.primary:hover { background: linear-gradient(180deg, #3069b6, #275a9d); }
  .card .t { font-weight: 650; font-size: 14px; margin-bottom: 3px; }
  .card .d { color: var(--dim); font-size: 12px; }
  .card.primary .d { color: #cfe2ff; }
  code { font-family: var(--mono); font-size: 11px; }
  .recent { width: min(714px, 92vw); display: flex; flex-direction: column; gap: 4px; }
  .rec { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 8px; text-align: left; }
  .rec:hover { background: var(--panel); }
  .rec span:nth-child(2) { font-weight: 600; }
  .how { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 28px; color: var(--dim); font-size: 12.5px; }
  .err { color: var(--err); }
  @media (max-width: 760px) { .actions { grid-template-columns: 1fr; } .how { grid-template-columns: 1fr; } }
</style>
