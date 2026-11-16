<script lang="ts">
  import { editor } from '$lib/editor/editor.svelte';
  import Palette from './Palette.svelte';
  import Modal from './Modal.svelte';
  import Settings from './Settings.svelte';
  import Handoff from './Handoff.svelte';
  import Tags from './Tags.svelte';
  import Help from './Help.svelte';
  import TagInput from './TagInput.svelte';

  let text = $state('');
  $effect(() => {
    if (editor.modal === 'save-version') text = '';
    if (editor.modal === 'new-level') text = editor.modalArg?.rename ? editor.level.name : '';
  });
  async function saveVersion() {
    await editor.saveVersion(text.trim() || `Version ${(editor.versions.at(-1)?.n ?? 0) + 1}`);
    editor.openModal(null);
  }
  async function newLevel() {
    const n = text.trim();
    if (!n) return;
    if (editor.modalArg?.rename) {
      editor.commit({ ...editor.level, name: n });
      await editor.save();
      await editor.refreshLevels();
    } else await editor.newLevel(n);
    editor.openModal(null);
  }
  function focus(node: HTMLInputElement) {
    setTimeout(() => node.focus(), 0);
  }
  const slot = $derived(typeof editor.modalArg === 'number' ? editor.modalArg : 0);
</script>

{#if editor.modal}
  <div class="backdrop" onclick={() => editor.openModal(null)} role="presentation"></div>
  {#if editor.modal === 'palette'}
    <Palette />
  {:else if editor.modal === 'save-version'}
    <Modal title="Save a version" width={440}>
      <label class="field"><span>What changed?</span>
        <input class="input" use:focus bind:value={text} placeholder="e.g. added the cave route" onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') saveVersion(); if (e.key === 'Escape') editor.openModal(null); }} />
      </label>
      <div class="faint">Snapshots go to <code>levels/{editor.levelId}/versions/</code>. Compare, restore or branch them from the Versions tab.</div>
      {#snippet footer()}<button class="btn" onclick={() => editor.openModal(null)}>Cancel</button><button class="btn primary" onclick={saveVersion}>Save version</button>{/snippet}
    </Modal>
  {:else if editor.modal === 'new-level'}
    <Modal title={editor.modalArg?.rename ? 'Rename level' : 'New level'} width={420}>
      <label class="field"><span>Name</span>
        <input class="input" use:focus bind:value={text} placeholder="e.g. Forest Approach" onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') newLevel(); if (e.key === 'Escape') editor.openModal(null); }} />
      </label>
      {#snippet footer()}<button class="btn" onclick={() => editor.openModal(null)}>Cancel</button><button class="btn primary" onclick={newLevel} disabled={!text.trim()}>{editor.modalArg?.rename ? 'Rename' : 'Create level'}</button>{/snippet}
    </Modal>
  {:else if editor.modal === 'pen-picker'}
    <Modal title={`Pen ${slot}`} width={420}>
      <div class="faint">Choose what pen {slot} draws. Press <kbd>{slot}</kbd> to pick it, <kbd>Shift+{slot}</kbd> to apply it to the selection.</div>
      <div class="row">
        <button class="btn" onclick={() => { editor.setPenSlot(slot, '@solid'); editor.openModal(null); }}><span class="dot" style="--c:#c9ced6"></span>Solid geometry</button>
        <button class="btn" onclick={() => { editor.setPenSlot(slot, '@cut'); editor.openModal(null); }}><span class="dot" style="--c:#ff5a5f"></span>Cut (subtract)</button>
      </div>
      <TagInput onpick={(t) => { editor.setPenSlot(slot, editor.ensureTag(t)); editor.openModal(null); }} placeholder="Search or create a tag…" />
      <div class="sp"></div>
    </Modal>
  {:else if editor.modal === 'settings'}
    <Settings />
  {:else if editor.modal === 'handoff'}
    <Handoff />
  {:else if editor.modal === 'tags'}
    <Tags />
  {:else if editor.modal === 'help'}
    <Help />
  {/if}
{/if}

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(5, 6, 8, 0.5); z-index: 70; }
  code { font-family: var(--mono); font-size: 11.5px; }
  .sp { height: 180px; }
</style>
