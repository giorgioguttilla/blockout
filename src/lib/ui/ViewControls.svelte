<script lang="ts">
  import { editor } from '$lib/editor/editor.svelte';
  import Icon from './Icon.svelte';
  const toggles = $derived([
    { k: 'snap', on: editor.snap, icon: 'magnet', title: `Snap to grid (${editor.snapStep} m) — hold ⌘/Ctrl to draw freely`, run: () => (editor.snap = !editor.snap) },
    { k: 'labels', on: editor.showLabels, icon: 'tag', title: 'Labels', run: () => (editor.showLabels = !editor.showLabels) },
    { k: 'scale', on: editor.showScale, icon: 'person', title: 'Character scale reference at the cursor (`)', run: () => { editor.showScale = !editor.showScale; editor.engine?.tools.rehover(); } },
    { k: 'rings', on: editor.jumpRings, icon: 'ring', title: 'Jump rings at the cursor (J)', run: () => { editor.jumpRings = !editor.jumpRings; editor.engine?.tools.rehover(); } },
    { k: 'section', on: editor.section, icon: 'section', title: 'Section view: cut away everything above the plane (X)', run: () => { editor.section = !editor.section; editor.engine?.invalidate(); } }
  ]);
</script>
<div class="vc">
  {#each toggles as t}
    <button class:on={t.on} onclick={t.run} title={t.title}><Icon name={t.icon} size={15} /></button>
  {/each}
  <div class="sep"></div>
  <button onclick={() => editor.engine?.frameAll()} title="Frame everything (Shift+F)"><Icon name="search" size={15} /></button>
  <select class="mode" bind:value={editor.inputMode} title="How scrolling behaves: auto-detect, mouse wheel = zoom, trackpad = two-finger orbit + pinch zoom">
    <option value="auto">A</option>
    <option value="mouse">M</option>
    <option value="trackpad">T</option>
  </select>
</div>
<style>
  .vc { position: absolute; right: 12px; bottom: 12px; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px; background: rgba(31, 35, 42, 0.95); border: 1px solid var(--line2); border-radius: 10px; z-index: 4; }
  button { width: 30px; height: 28px; display: grid; place-items: center; border-radius: 6px; color: var(--faint); }
  button:hover { background: #2a303a; color: var(--text); }
  button.on { color: #9ccaff; background: rgba(77, 163, 255, 0.12); }
  .sep { height: 1px; width: 18px; background: var(--line2); margin: 3px 0; }
  .mode { width: 30px; appearance: none; text-align: center; height: 26px; background: #14171c; border: 1px solid var(--line2); border-radius: 6px; font-size: 11px; color: var(--dim); padding: 0 4px; }
</style>
