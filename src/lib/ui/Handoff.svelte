<script lang="ts">
  import { editor } from '$lib/editor/editor.svelte';
  import * as A from '$lib/editor/actions';
  import { api, WEB, downloadHandoffZip } from '$lib/editor/api';
  import { diffLevels, diffSummary } from '$lib/model/diff';
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';

  const baseline = $derived(editor.baseline());
  let kind = $state<'brief' | 'changes'>('brief');
  let message = $state('');
  let busy = $state(false);
  let err = $state('');
  let copied = $state(false);
  let pending = $state('');
  $effect(() => {
    editor.handoffResult = null;
    kind = baseline ? 'changes' : 'brief';
  });
  $effect(() => {
    const b = baseline;
    if (!b) return;
    api.version(editor.levelId, b.n).then((lv) => (pending = diffSummary(diffLevels(lv, editor.level)))).catch(() => {});
  });
  async function go() {
    busy = true;
    err = '';
    try {
      await A.handoff(kind, message);
    } catch (e) {
      err = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function copy() {
    if (!editor.handoffResult) return;
    await navigator.clipboard.writeText(editor.handoffResult.prompt);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
  const res = $derived(editor.handoffResult);
</script>

<Modal title="Hand off to your AI" width={640}>
  {#if !res}
    <div class="muted">Writes a brief for an AI builder (Claude Code, Cursor, etc.) into <code>levels/{editor.levelId}/handoff/</code>: markdown, labelled screenshots and a traversal report. Saved as a version and marked as <b>built</b>, so next time you can hand off just the changes.</div>
    <div class="opts">
      <button class="opt" class:on={kind === 'changes'} disabled={!baseline} onclick={() => (kind = 'changes')}>
        <b>Changes since v{baseline?.n ?? '–'}</b>
        <span class="faint">{baseline ? `The AI already built v${baseline.n}. Send only what changed: ${pending || '…'}` : 'Available after the first handoff.'}</span>
      </button>
      <button class="opt" class:on={kind === 'brief'} onclick={() => (kind = 'brief')}>
        <b>Full brief</b>
        <span class="faint">Build the whole level from scratch: BRIEF.md + screenshots + analysis.</span>
      </button>
    </div>
    <label class="field"><span>Note for this version (optional)</span><input class="input" bind:value={message} placeholder="e.g. first pass of the forest" onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') go(); }} /></label>
    {#if err}<div class="err">{err}</div>{/if}
  {:else}
    <div class="done"><Icon name="check" size={18} /> <b>Handoff written</b> <span class="faint">({res.summary})</span></div>
    <div class="shots">{#each res.images as src}<img {src} alt="handoff view" />{/each}</div>
    <div class="field"><span>Paste this to your AI</span>
      <div class="prompt">{res.prompt}</div>
    </div>
    <div class="faint small mono">{res.dir}</div>
  {/if}
  {#snippet footer()}
    {#if !res}
      <button class="btn" onclick={() => editor.openModal(null)}>Cancel</button>
      <button class="btn primary" onclick={go} disabled={busy}>{busy ? 'Writing…' : kind === 'changes' ? 'Write CHANGES.md' : 'Write BRIEF.md'}</button>
    {:else}
      {#if WEB}
        <button class="btn" onclick={() => downloadHandoffZip(editor.levelId, editor.levelId)}><Icon name="down" size={14} /> Download .zip</button>
      {:else}
        <button class="btn" onclick={() => api.reveal(res.dir)}><Icon name="reveal" size={14} /> Show files</button>
      {/if}
      <button class="btn primary" onclick={copy}><Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? 'Copied' : 'Copy prompt'}</button>
    {/if}
  {/snippet}
</Modal>

<style>
  code, .mono { font-family: var(--mono); font-size: 11.5px; }
  .opts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .opt { display: flex; flex-direction: column; gap: 4px; text-align: left; padding: 12px; border-radius: 9px; border: 1px solid var(--line2); background: #1a1d23; }
  .opt.on { border-color: var(--accent); background: rgba(77, 163, 255, 0.08); }
  .opt:disabled { opacity: 0.5; }
  .opt span { font-size: 12px; }
  .done { display: flex; align-items: center; gap: 8px; color: #8ff0b1; }
  .shots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .shots img { width: 100%; border-radius: 6px; border: 1px solid var(--line2); }
  .prompt { background: #14171c; border: 1px solid var(--line2); border-radius: 8px; padding: 10px; font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; user-select: text; }
  .err { color: var(--err); }
  .small { font-size: 11px; word-break: break-all; }
</style>
