<script lang="ts">
  import { onMount } from 'svelte';
  import { editor, TOOL_INFO, type ToolName } from '$lib/editor/editor.svelte';
  import * as A from '$lib/editor/actions';
  import { api, WEB } from '$lib/editor/api';

  interface Cmd { label: string; hint?: string; group: string; run: () => void; color?: string }
  let q = $state('');
  let idx = $state(0);
  let input: HTMLInputElement;
  let asking = $state<null | { prompt: string; done: (v: string) => void }>(null);
  onMount(() => {
    setTimeout(() => input?.focus(), 0);
    if (editor.modalArg === 'Make stamp') ask('Name for the new stamp', (v) => A.makeStampFromSelection(v));
  });
  const close = () => editor.openModal(null);
  function ask(prompt: string, done: (v: string) => void) {
    asking = { prompt, done };
    q = '';
    setTimeout(() => input?.focus(), 0);
  }
  function penFor(tag: string) {
    let i = editor.project.pens.indexOf(tag);
    if (i < 0) {
      i = editor.pen > 1 ? editor.pen : 9;
      editor.setPenSlot(i, tag);
      editor.toast(`Pen ${i} is now #${tag}`, 'info');
    } else editor.selectPen(i);
  }
  const cmds = $derived.by<Cmd[]>(() => {
    const c: Cmd[] = [];
    for (const [t, info] of Object.entries(TOOL_INFO)) c.push({ group: 'Tools', label: `${info.label} tool`, hint: info.key, run: () => A.setTool(t as ToolName) });
    c.push(
      { group: 'View', label: 'Toggle plan / 3D view', hint: 'Tab', run: A.toggleView },
      { group: 'View', label: 'Frame everything', hint: '⇧F', run: () => editor.engine?.frameAll() },
      { group: 'View', label: 'Toggle section view', hint: 'X', run: () => (editor.section = !editor.section) },
      { group: 'View', label: 'Toggle labels', run: () => (editor.showLabels = !editor.showLabels) },
      { group: 'View', label: 'Toggle jump rings', hint: 'J', run: () => (editor.jumpRings = !editor.jumpRings) },
      { group: 'View', label: 'Toggle snapping', run: () => (editor.snap = !editor.snap) },
      { group: 'View', label: 'Raise work plane', hint: 'E', run: () => A.shiftPlane(1) },
      { group: 'View', label: 'Lower work plane', hint: 'Q', run: () => A.shiftPlane(-1) },
      { group: 'View', label: 'Unhide everything', run: () => { const ids = editor.level.elements.filter((e) => e.hidden).map((e) => e.id); if (ids.length) editor.patch(ids, (e) => delete e.hidden); } },
      { group: 'Play', label: 'Walk mode', hint: 'G', run: A.startWalk },
      { group: 'Play', label: 'Analyze traversal', hint: 'A', run: () => A.runAnalysis(true) },
      { group: 'Level', label: 'Hand off to AI…', run: () => editor.openModal('handoff') },
      { group: 'Level', label: 'Save version…', hint: '⌘S', run: () => editor.openModal('save-version') },
      { group: 'Level', label: 'New level…', run: () => editor.openModal('new-level') },
      { group: 'Level', label: 'Duplicate level as variant', run: () => editor.branchVersion(null) },
      ...(WEB ? [] : [{ group: 'Level', label: 'Show project folder in Finder', run: () => api.reveal() }]),
      { group: 'Project', label: 'Project & character settings…', run: () => editor.openModal('settings') },
      { group: 'Project', label: 'Tag library…', run: () => editor.openModal('tags') },
      { group: 'Project', label: 'Keyboard shortcuts', hint: '?', run: () => editor.openModal('help') },
      { group: 'Project', label: 'Open another project…', run: () => editor.closeFolder() }
    );
    if (editor.selection.length) {
      c.push(
        { group: 'Selection', label: 'Make stamp from selection…', run: () => ask('Name for the new stamp', (v) => A.makeStampFromSelection(v)) },
        { group: 'Selection', label: 'Duplicate', hint: '⌘D', run: A.duplicate },
        { group: 'Selection', label: 'Group', hint: '⌘G', run: A.groupSelection },
        { group: 'Selection', label: 'Hide', hint: '⇧H', run: A.hideSelection },
        { group: 'Selection', label: 'Delete', hint: '⌫', run: () => editor.remove(editor.selection) }
      );
      for (const [t, d] of Object.entries(editor.project.tags)) c.push({ group: 'Tag selection', label: `Tag selection #${t}`, color: d.color, run: () => editor.addTag(editor.selection, t) });
    }
    for (const [t, d] of Object.entries(editor.project.tags)) c.push({ group: 'Draw with', label: `Draw with #${t}`, hint: d.category, color: d.color, run: () => penFor(t) });
    for (const [k, s] of Object.entries(editor.project.stamps)) c.push({ group: 'Stamps', label: `Stamp: ${s.name}`, run: () => { editor.stamp = k; A.setTool('stamp'); } });
    for (const l of editor.levels) if (l.id !== editor.levelId) c.push({ group: 'Open level', label: `Open level: ${l.name}`, hint: l.id, run: () => editor.openLevel(l.id) });
    for (const e of editor.level.elements) c.push({ group: 'Go to', label: `Go to ${e.name ? e.name + ' · ' : ''}${e.id}`, hint: e.tags.map((t) => '#' + t).join(' '), color: e.tags[0] ? editor.tagColor(e.tags[0]) : undefined, run: () => { editor.selection = [e.id]; A.setTool('select'); setTimeout(() => editor.engine?.frameSelection(), 0); } });
    return c;
  });
  function score(label: string, s: string) {
    if (!s) return 1;
    const L = label.toLowerCase();
    const i = L.indexOf(s);
    if (i >= 0) return 100 - i;
    let j = 0;
    for (const ch of L) if (ch === s[j]) j++;
    return j === s.length ? 10 : 0;
  }
  const results = $derived.by(() => {
    const s = q.trim().toLowerCase();
    const scored = cmds.map((c) => ({ c, s: score(c.label, s) })).filter((x) => x.s > 0);
    if (s) scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, s ? 40 : 18).map((x) => x.c);
  });
  function run(c: Cmd) {
    close();
    c.run();
  }
  function key(e: KeyboardEvent) {
    e.stopPropagation();
    if (asking) {
      if (e.key === 'Enter' && q.trim()) {
        const a = asking;
        close();
        a.done(q.trim());
      }
      if (e.key === 'Escape') close();
      return;
    }
    if (e.key === 'ArrowDown') { idx = Math.min(results.length - 1, idx + 1); e.preventDefault(); }
    if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); e.preventDefault(); }
    if (e.key === 'Enter' && results[idx]) run(results[idx]);
    if (e.key === 'Escape') close();
  }
</script>

<div class="pal">
  <input bind:this={input} class="q" placeholder={asking ? asking.prompt : 'Search actions, tags, stamps, elements, levels…'} bind:value={q} oninput={() => (idx = 0)} onkeydown={key} spellcheck="false" />
  {#if !asking}
    <div class="res scroll">
      {#each results as c, i}
        <button class="r" class:on={i === idx} onmouseenter={() => (idx = i)} onclick={() => run(c)}>
          {#if c.color}<span class="dot" style="--c:{c.color}"></span>{/if}
          <span class="grow">{c.label}</span>
          <span class="g faint">{c.group}</span>
          {#if c.hint}<kbd>{c.hint}</kbd>{/if}
        </button>
      {:else}
        <div class="faint none">No matches</div>
      {/each}
    </div>
  {:else}
    <div class="faint none">Enter to confirm · Esc to cancel</div>
  {/if}
</div>

<style>
  .pal { position: fixed; top: 14vh; left: 50%; transform: translateX(-50%); width: min(620px, 92vw); background: #20242b; border: 1px solid var(--line2); border-radius: 12px; box-shadow: var(--shadow); z-index: 71; overflow: hidden; }
  .q { width: 100%; height: 48px; background: transparent; border: 0; border-bottom: 1px solid var(--line); padding: 0 16px; font-size: 15px; outline: none; }
  .res { max-height: 52vh; padding: 5px; }
  .r { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 10px; border-radius: 7px; text-align: left; }
  .r.on { background: #2e3540; }
  .g { font-size: 11px; }
  .none { padding: 14px 16px; }
</style>
