<script lang="ts">
  import { editor } from '$lib/editor/editor.svelte';
  import * as A from '$lib/editor/actions';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';
  import Menu from './Menu.svelte';

  let levelMenu = $state(false);
  let planeMenu = $state(false);
  const storeyName = $derived(editor.level.storeys.find((s) => Math.abs(s.y - editor.planeY) < 1e-3)?.name);
  const saveLabel = $derived({ saved: 'Saved', saving: 'Saving…', dirty: 'Unsaved', error: 'Save failed' }[editor.saveState]);
  const levelName = $derived(editor.levels.find((l) => l.id === editor.levelId)?.name ?? editor.level.name);
  const baseline = $derived(editor.baseline());

  async function newLevel() {
    levelMenu = false;
    editor.openModal('new-level');
  }
  function addStorey() {
    const y = editor.planeY;
    if (editor.level.storeys.some((s) => Math.abs(s.y - y) < 1e-3)) {
      editor.toast('There is already a storey at this height — move the plane with Q / E first', 'info');
      return;
    }
    editor.commit({ ...editor.level, storeys: [...editor.level.storeys, { id: 'storey-' + Math.round(y * 100), name: `Storey @ ${y} m`, y }].sort((a, b) => a.y - b.y) });
    editor.toast(`Storey added at ${y} m`, 'ok');
  }
</script>

<header class="top">
  <div class="left">
    <button class="proj" onclick={() => editor.openModal('settings')} title="Project settings">
      <Logo size={20} />
      <span>{editor.project.name}</span>
    </button>
    <span class="faint">/</span>
    <div class="rel">
      <button class="lvl" onclick={() => (levelMenu = !levelMenu)}>
        <span>{levelName}</span><Icon name="down" size={13} />
      </button>
      {#if levelMenu}
        <Menu onclose={() => (levelMenu = false)}>
          <div class="mhead section-title">Levels</div>
          {#each editor.levels as l}
            <button class="mi" class:on={l.id === editor.levelId} onclick={() => { levelMenu = false; editor.openLevel(l.id); }}>
              <span class="grow">{l.name}</span><span class="faint mono">{l.id}</span>
            </button>
          {/each}
          <div class="sep"></div>
          <button class="mi" onclick={newLevel}><Icon name="plus" size={14} /> New level…</button>
          <button class="mi" onclick={() => { levelMenu = false; editor.branchVersion(null); }}><Icon name="branch" size={14} /> Duplicate as variant</button>
          <button class="mi" onclick={() => { levelMenu = false; editor.openModal('new-level', { rename: true }); }}><Icon name="draw" size={14} /> Rename…</button>
          {#if !WEB}<button class="mi" onclick={() => { levelMenu = false; api_reveal(); }}><Icon name="reveal" size={14} /> Show in Finder</button>{/if}
          <button class="mi danger" onclick={() => { levelMenu = false; if (confirm(`Move level "${levelName}" to the project's .trash folder?`)) editor.deleteLevel(editor.levelId); }}><Icon name="trash" size={14} /> Delete level</button>
          <div class="sep"></div>
          <button class="mi" onclick={() => { levelMenu = false; editor.closeFolder(); }}><Icon name="folder" size={14} /> Open another project…</button>
        </Menu>
      {/if}
    </div>
    <span class="save {editor.saveState}" title={editor.root ?? ''}>{saveLabel}</span>
  </div>

  <div class="mid">
    <div class="seg" title="Tab">
      <button class:on={editor.view === 'plan'} onclick={() => editor.view !== 'plan' && A.toggleView()}><Icon name="plan" size={13} /> Plan</button>
      <button class:on={editor.view === '3d'} onclick={() => editor.view !== '3d' && A.toggleView()}><Icon name="cube" size={13} /> 3D</button>
    </div>
    <div class="rel">
      <button class="plane" onclick={() => (planeMenu = !planeMenu)} title="Work plane height — Q / E to move, Shift+Q / E to jump between storeys">
        <Icon name="layers" size={14} />
        <span>{storeyName ?? 'Plane'} · {editor.planeY.toFixed(2).replace(/\.?0+$/, '')} m</span>
        <span class="faint"><kbd>Q</kbd><kbd>E</kbd></span>
      </button>
      {#if planeMenu}
        <Menu onclose={() => (planeMenu = false)}>
          <div class="mhead section-title">Storeys</div>
          {#each [...editor.level.storeys].reverse() as s}
            <button class="mi" class:on={Math.abs(s.y - editor.planeY) < 1e-3} onclick={() => { A.setPlane(s.y); planeMenu = false; }}>
              <span class="grow">{s.name}</span><span class="faint mono">{s.y} m</span>
            </button>
          {/each}
          <div class="sep"></div>
          <button class="mi" onclick={() => { addStorey(); planeMenu = false; }}><Icon name="plus" size={14} /> Add storey at {editor.planeY} m</button>
          <button class="mi" onclick={() => { editor.section = !editor.section; planeMenu = false; editor.engine?.invalidate(); }}><Icon name="section" size={14} /> {editor.section ? 'Turn off' : 'Turn on'} section view <kbd>X</kbd></button>
        </Menu>
      {/if}
    </div>
  </div>

  <div class="right">
    <button class="btn ghost icon" onclick={() => editor.undo()} title="Undo ⌘Z" disabled={!editor.undoStack.length && false}><Icon name="undo" size={15} /></button>
    <button class="btn ghost icon" onclick={() => editor.redo()} title="Redo ⇧⌘Z"><Icon name="redo" size={15} /></button>
    <button class="btn ghost icon" onclick={() => editor.openModal('palette')} title="Search everything ⌘K"><Icon name="search" size={15} /></button>
    <div class="vsep"></div>
    <button class="btn" onclick={() => A.startWalk()} title="Walk around with your character (G)"><Icon name="walk" size={15} /> Walk</button>
    <button class="btn" class:active={editor.showAnalysis} onclick={() => A.toggleAnalysis()} title="Check what's reachable from spawn, and how (A)">
      <Icon name="bolt" size={15} /> {editor.analyzing ? `Analyzing ${Math.round(editor.analysisProgress * 100)}%` : 'Analyze'}
    </button>
    <button class="btn primary" onclick={() => editor.openModal('handoff')} title="Write BRIEF.md / CHANGES.md + screenshots for your AI">
      <Icon name="send" size={15} /> Hand off{#if baseline}<span class="badge">v{baseline.n}</span>{/if}
    </button>
    <button class="btn ghost icon" onclick={() => editor.openModal('settings')} title="Project & character settings"><Icon name="gear" size={15} /></button>
    <button class="btn ghost icon" onclick={() => editor.openModal('help')} title="Shortcuts (?)"><Icon name="help" size={15} /></button>
  </div>
</header>

<script lang="ts" module>
  import { api, WEB } from '$lib/editor/api';
  function api_reveal() {
    api.reveal().catch(() => {});
  }
</script>

<style>
  .top { height: 46px; flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 10px; background: var(--bg2); border-bottom: 1px solid var(--line); position: relative; z-index: 20; }
  .left, .right, .mid { display: flex; align-items: center; gap: 6px; }
  .mid { position: absolute; left: 50%; transform: translateX(-50%); }
  .proj { display: flex; align-items: center; gap: 8px; font-weight: 650; padding: 4px 6px; border-radius: 6px; }
  .proj:hover, .lvl:hover, .plane:hover { background: rgba(255, 255, 255, 0.06); }
  .lvl { display: flex; align-items: center; gap: 4px; padding: 4px 6px; border-radius: 6px; font-weight: 550; }
  .plane { display: flex; align-items: center; gap: 7px; height: 28px; padding: 0 10px; border-radius: 7px; border: 1px solid var(--line2); background: #14171c; font-size: 12px; }
  .plane kbd { font-size: 9.5px; padding: 1px 4px; margin-left: 1px; }
  .rel { position: relative; }
  .save { font-size: 11.5px; color: var(--faint); margin-left: 6px; }
  .save.dirty, .save.saving { color: var(--warn); }
  .save.error { color: var(--err); }
  .icon { width: 30px; padding: 0; justify-content: center; }
  .vsep { width: 1px; height: 20px; background: var(--line2); margin: 0 4px; }
  .badge { font-size: 10px; background: rgba(255, 255, 255, 0.2); border-radius: 4px; padding: 1px 4px; }
  .btn.active { border-color: var(--accent); color: #bcdcff; }
  .mono { font-family: var(--mono); font-size: 11px; }
  :global(.mi) { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 10px; border-radius: 6px; text-align: left; white-space: nowrap; }
  :global(.mi:hover) { background: #2d333d; }
  :global(.mi.on) { color: #bcdcff; }
  :global(.mi.danger:hover) { color: #ffb3b5; }
  :global(.mhead) { padding: 6px 10px 4px; }
  :global(.sep) { height: 1px; background: var(--line); margin: 4px 0; }
</style>
