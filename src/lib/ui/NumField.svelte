<script lang="ts">
  let { label, value, step = 0.5, min = -Infinity, max = Infinity, unit = '', onchange }: { label: string; value: number; step?: number; min?: number; max?: number; unit?: string; onchange: (v: number) => void } = $props();
  let text = $state('');
  let focused = $state(false);
  $effect(() => {
    if (!focused) text = fmt(value);
  });
  function fmt(v: number) {
    return (Math.round(v * 1000) / 1000).toString();
  }
  function commit() {
    let v = Number(text);
    if (!Number.isFinite(v)) {
      try {
        v = Function(`"use strict";return (${text.replace(/[^0-9+\-*/(). ]/g, '')})`)();
      } catch {
        v = value;
      }
    }
    v = Math.min(max, Math.max(min, v));
    if (v !== value) onchange(Math.round(v * 1000) / 1000);
    text = fmt(v);
  }
  // drag the label to scrub
  function scrub(e: PointerEvent) {
    const x0 = e.clientX;
    const v0 = value;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let last = v0;
    const move = (m: PointerEvent) => {
      const d = Math.round((m.clientX - x0) / 6) * step * (m.shiftKey ? 10 : 1);
      const v = Math.min(max, Math.max(min, Math.round((v0 + d) * 1000) / 1000));
      if (v !== last) {
        last = v;
        text = fmt(v);
      }
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      if (last !== v0) onchange(last);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }
</script>
<label class="nf">
  <span class="l" onpointerdown={scrub} title="Drag to scrub">{label}</span>
  <input
    class="input"
    bind:value={text}
    onfocus={() => (focused = true)}
    onblur={() => { focused = false; commit(); }}
    onkeydown={(e) => {
      e.stopPropagation();
      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); text = fmt(Number(text) + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1)); commit(); }
    }}
  />
  {#if unit}<span class="u">{unit}</span>{/if}
</label>
<style>
  .nf { display: flex; align-items: center; background: #14171c; border: 1px solid var(--line2); border-radius: 6px; height: 26px; min-width: 0; }
  .nf:focus-within { border-color: var(--accent); }
  .l { padding: 0 6px; color: var(--faint); font-size: 11px; cursor: ew-resize; user-select: none; font-weight: 600; white-space: nowrap; }
  .input { border: 0; background: transparent; height: 24px; padding: 0 4px 0 0; box-shadow: none !important; font-family: var(--mono); font-size: 12px; }
  .u { color: var(--faint); font-size: 10.5px; padding-right: 6px; }
</style>
