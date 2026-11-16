<script lang="ts">
  import { editor } from '$lib/editor/editor.svelte';
  import { browserBackend, canOpenFolders, forgetRecent, webRecents, type WebRecent } from '$lib/store/browser';
  import Icon from './Icon.svelte';

  let busy = $state(false);
  let err = $state('');
  let recents = $state<WebRecent[]>(webRecents());
  let naming = $state(false);
  let name = $state('My Game');

  async function run(fn: () => Promise<unknown>) {
    busy = true;
    err = '';
    try {
      await fn();
    } catch (e) {
      const m = (e as Error).message ?? String(e);
      if (!/abort/i.test(m)) err = m;
    } finally {
      busy = false;
      recents = webRecents();
    }
  }
  const openFolder = () => run(async () => editor.openFolder(await browserBackend.pickFolder()));
  const demo = () => run(() => editor.openFolder('idb:Demo', { demo: true }));
  const create = () => run(() => editor.openFolder('idb:' + (name.trim() || 'My Game')));
  const ago = (t: number) => {
    const s = (Date.now() - t) / 1000;
    return s < 3600 ? `${Math.max(1, Math.floor(s / 60))} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(t).toLocaleDateString();
  };
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
    <button class="card primary" onclick={demo} disabled={busy}>
      <Icon name="sparkle" size={22} />
      <div><div class="t">Try the demo level</div><div class="d">Saved in this browser — nothing to install</div></div>
    </button>
    <button class="card" onclick={openFolder} disabled={busy || !canOpenFolders}>
      <Icon name="folder" size={22} />
      <div><div class="t">Open a folder on this computer…</div><div class="d">{canOpenFolders ? "Your repo's design/ folder — your agent edits the same files" : 'Needs Chrome or Edge'}</div></div>
    </button>
    {#if naming}
      <div class="card form">
        <input class="input" bind:value={name} onkeydown={(e) => e.key === 'Enter' && create()} />
        <button class="btn primary" onclick={create} disabled={busy}>Create</button>
      </div>
    {:else}
      <button class="card" onclick={() => (naming = true)} disabled={busy}>
        <Icon name="plus" size={22} />
        <div><div class="t">New project in this browser</div><div class="d">Download handoffs as a .zip</div></div>
      </button>
    {/if}
  </section>
  {#if err}<div class="err">{err}</div>{/if}

  {#if recents.length}
    <section class="recent">
      <div class="section-title">Recent</div>
      {#each recents as r (r.id)}
        <div class="rec">
          <button class="open" onclick={() => run(() => editor.openFolder(r.id))} disabled={busy}>
            <Icon name={r.kind === 'fsa' ? 'folder' : 'box'} size={14} />
            <span class="nm">{r.name}</span>
            <span class="faint">{r.kind === 'fsa' ? 'folder on this computer' : 'in this browser'} · {ago(r.time)}</span>
          </button>
          <button class="x" title="Remove from list" onclick={() => { forgetRecent(r.id); recents = webRecents(); }}><Icon name="x" size={12} /></button>
        </div>
      {/each}
    </section>
  {/if}

  <section class="note">
    {#if canOpenFolders}
      Folders you open are edited in place: nothing is uploaded. After a reload the browser asks once to let Blockout edit the folder again.
    {:else}
      This browser can't edit folders on disk, so projects are kept in the browser. Use Chrome or Edge to work on files your coding agent can edit.
    {/if}
    Prefer a local app? <a href="https://github.com/giorgioguttilla/blockout" target="_blank" rel="noreferrer">Run Blockout from GitHub</a> with <code>npm run dev</code>.
  </section>
</main>

<style>
  main { height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px; background: radial-gradient(1200px 600px at 50% -10%, #263044 0%, var(--bg) 60%); padding: 30px; overflow: auto; }
  .hero { text-align: center; }
  .logo { display: inline-grid; place-items: center; width: 84px; height: 84px; border-radius: 22px; background: #1d222b; border: 1px solid var(--line2); box-shadow: var(--shadow); margin-bottom: 12px; }
  h1 { margin: 0; font-size: 34px; letter-spacing: -0.02em; }
  .tag { color: var(--dim); max-width: 520px; margin: 8px auto 0; font-size: 15px; }
  .actions { display: grid; grid-template-columns: repeat(3, minmax(0, 240px)); gap: 12px; }
  .card { display: flex; gap: 12px; align-items: flex-start; text-align: left; padding: 16px; border-radius: 12px; background: var(--panel); border: 1px solid var(--line2); transition: transform 0.1s, border-color 0.15s; }
  .card:hover:not(:disabled) { transform: translateY(-2px); border-color: #4a5260; }
  .card:disabled { opacity: 0.55; }
  .card.primary { background: linear-gradient(180deg, #2a5ea3, #22508c); border-color: #4d8ef7; }
  .card .t { font-weight: 650; font-size: 14px; margin-bottom: 3px; }
  .card .d { color: var(--dim); font-size: 12px; }
  .card.primary .d { color: #cfe2ff; }
  .card.form { align-items: center; gap: 8px; }
  .recent { width: min(744px, 92vw); display: flex; flex-direction: column; gap: 2px; }
  .rec { display: flex; align-items: center; border-radius: 8px; }
  .rec:hover { background: var(--panel); }
  .open { flex: 1; display: flex; gap: 10px; align-items: center; padding: 8px 10px; text-align: left; }
  .nm { font-weight: 600; }
  .x { padding: 6px 10px; color: var(--faint); opacity: 0; }
  .rec:hover .x { opacity: 1; }
  .note { max-width: 640px; text-align: center; color: var(--dim); font-size: 12.5px; line-height: 1.5; }
  .note a { color: #9ccaff; }
  code { font-family: var(--mono); font-size: 11.5px; }
  .err { color: var(--err); }
  @media (max-width: 800px) { .actions { grid-template-columns: 1fr; } }
</style>
