<script lang="ts">
  import { editor } from '$lib/editor/editor.svelte';
  import type { LevelElement, PropValue, Role, ShapeKind } from '$lib/model/types';
  import { defaultSteps } from '$lib/engine/geometry';
  import { innerRadius, outerFromInner, shapeName, slopeInfo, taperOf } from '$lib/model/shapes';
  import { worldBounds } from '$lib/model/space';
  import NumField from './NumField.svelte';
  import TagInput from './TagInput.svelte';
  import Icon from './Icon.svelte';

  const sel = $derived(editor.selected);
  const one = $derived(sel.length === 1 ? sel[0] : null);
  let notesEl = $state<HTMLTextAreaElement | null>(null);
  let notes = $state('');
  let name = $state('');
  let newKey = $state('');

  $effect(() => {
    notes = one?.notes ?? '';
    name = one?.name ?? '';
  });
  $effect(() => {
    if (editor.focusNotes) setTimeout(() => notesEl?.focus(), 0);
  });

  function up(fn: (e: LevelElement) => void) {
    editor.patch(editor.selection, fn);
  }
  const roles = $derived<Role[]>(one?.type === 'shape' ? ['solid', 'cut', 'zone', 'guide'] : one?.type === 'path' ? ['zone', 'guide'] : []);
  const kinds: ShapeKind[] = ['box', 'extrude', 'prism', 'ramp', 'stairs', 'blob'];
  const kindLabel: Record<string, string> = { extrude: 'polygon', prism: 'n-gon' };
  const propDefs = $derived.by(() => {
    const out: [string, any][] = [];
    if (!one) return out;
    for (const t of one.tags) for (const [k, d] of Object.entries(editor.project.tags[t]?.props ?? {})) if (!out.some((o) => o[0] === k)) out.push([k, d]);
    return out;
  });
  const extraProps = $derived(one ? Object.keys(one.props).filter((k) => !propDefs.some((p) => p[0] === k)) : []);
  const commonTags = $derived(sel.length ? sel[0].tags.filter((t) => sel.every((e) => e.tags.includes(t))) : []);
  const bounds = $derived(one ? worldBounds(one, editor.project) : null);

  function setProp(k: string, v: PropValue | undefined) {
    up((e) => {
      if (v === undefined || v === '') delete e.props[k];
      else e.props[k] = v;
    });
  }
  function removeTag(t: string) {
    up((e) => (e.tags = e.tags.filter((x) => x !== t)));
  }
  function setKind(k: ShapeKind) {
    if (one?.type === 'shape' && one.shape.kind === 'cylinder' && k === 'prism') return (editor.engine?.tools.tools.select as any).convert('prism');
    if (!one || one.type !== 'shape' || one.shape.kind === k) return;
    if (k === 'extrude') {
      up((e) => {
        if (e.type !== 'shape' || !e.shape.size) return;
        const [x, y, z] = e.shape.size;
        e.shape = { kind: 'extrude', points: [[-x / 2, -z / 2], [x / 2, -z / 2], [x / 2, z / 2], [-x / 2, z / 2]], height: y, hollow: e.shape.hollow ?? undefined };
        if (!e.shape.hollow) delete e.shape.hollow;
      });
    } else (editor.engine?.tools.tools.select as any).convert(k);
  }
  function short(n: number) {
    return (Math.round(n * 100) / 100).toString();
  }
  const levelStats = $derived.by(() => {
    const c: Record<string, number> = {};
    for (const e of editor.level.elements) c[e.type] = (c[e.type] ?? 0) + 1;
    return c;
  });
</script>

<aside class="insp scroll">
  {#if one}
    {@const e = one}
    <div class="head">
      <div class="row">
        <span class="type">{e.type === 'shape' ? `${e.role} ${shapeName(e.shape)}` : e.type}</span>
        <span class="grow"></span>
        <button class="btn sm ghost" onclick={() => navigator.clipboard?.writeText(e.id)} title="Copy id"><span class="mono">{e.id}</span><Icon name="copy" size={12} /></button>
      </div>
      <input class="input name" placeholder="Name (optional)" bind:value={name} onchange={() => up((x) => (x.name = name || undefined))} onkeydown={(ev) => { ev.stopPropagation(); if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }} />
    </div>

    <section>
      <div class="st">Tags <span class="faint">— what this is. The AI reads these.</span></div>
      <div class="tags">
        {#each e.tags as t}
          <span class="chip" style="--c:{editor.tagColor(t)}"><span class="dot"></span>{t}<button onclick={() => removeTag(t)} title="Remove"><Icon name="x" size={11} /></button></span>
        {/each}
      </div>
      <TagInput autofocus={false} onpick={(t) => editor.addTag([e.id], t)} exclude={e.tags} placeholder="+ add tag" />
      {#if e.tags[0] && editor.project.tags[e.tags[0]]?.description}<div class="desc faint">{editor.project.tags[e.tags[0]].description}</div>{/if}
    </section>

    {#if roles.length}
      <section>
        <div class="st">Role</div>
        <div class="seg full">
          {#each roles as r}<button class:on={e.role === r} onclick={() => up((x) => (x.role = r))} title={{ solid: 'Blockout geometry (collides)', cut: 'Subtracts from solids it overlaps', zone: 'Non-physical area with meaning', guide: 'Reference only' }[r]}>{r}</button>{/each}
        </div>
      </section>
    {/if}

    {#if e.type === 'shape'}
      {@const s = e.shape}
      <section>
        <div class="st">Shape</div>
        <div class="seg full wrap">
          {#each kinds as k}<button class:on={s.kind === k || (k === 'prism' && s.kind === 'cylinder')} onclick={() => setKind(k)}>{kindLabel[k] ?? k}</button>{/each}
        </div>
        {#if s.size}
          <div class="g3">
            <NumField label="W" value={s.size[0]} min={0.05} onchange={(v) => up((x) => x.type === 'shape' && x.shape.size && (x.shape.size[0] = v))} unit="m" />
            <NumField label="H" value={s.size[1]} min={0} onchange={(v) => up((x) => x.type === 'shape' && x.shape.size && (x.shape.size[1] = v))} unit="m" />
            <NumField label="D" value={s.size[2]} min={0.05} onchange={(v) => up((x) => x.type === 'shape' && x.shape.size && (x.shape.size[2] = v))} unit="m" />
          </div>
        {:else if s.kind === 'prism'}
          {@const n = s.sides ?? 6}
          {@const R = s.radius ?? 1}
          <div class="row">
            <label class="tog"><input type="checkbox" checked={!!s.smooth} onchange={(ev) => up((x) => { if (x.type !== 'shape') return; if ((ev.target as HTMLInputElement).checked) x.shape.smooth = true; else { delete x.shape.smooth; x.shape.sides = x.shape.sides ?? 6; } })} /> Smooth (circle)</label>
            {#if !s.smooth}<span class="grow"></span><NumField label="Sides" value={n} step={1} min={3} max={16} onchange={(v) => up((x) => x.type === 'shape' && (x.shape.sides = Math.round(v)))} />{/if}
          </div>
          <div class="g2">
            <NumField label={s.smooth ? 'Radius' : 'R corner'} value={R} min={0.05} onchange={(v) => up((x) => x.type === 'shape' && (x.shape.radius = v))} unit="m" />
            {#if !s.smooth}
              <NumField label="R flat" value={Math.round(innerRadius(R, n) * 1000) / 1000} min={0.05} onchange={(v) => up((x) => x.type === 'shape' && (x.shape.radius = Math.round(outerFromInner(v, n) * 1000) / 1000))} unit="m" />
            {:else}
              <NumField label="⌀" value={R * 2} min={0.1} onchange={(v) => up((x) => x.type === 'shape' && (x.shape.radius = v / 2))} unit="m" />
            {/if}
            <NumField label="H" value={s.height ?? 0} min={0} onchange={(v) => up((x) => x.type === 'shape' && (x.shape.height = v))} unit="m" />
            <NumField label="Top R" value={Math.round(R * taperOf(s) * 1000) / 1000} min={0} max={R} onchange={(v) => up((x) => { if (x.type !== 'shape') return; const t = Math.max(0, Math.min(1, v / (x.shape.radius ?? 1))); if (t >= 1) delete x.shape.taper; else x.shape.taper = Math.round(t * 1000) / 1000; })} unit="m" />
          </div>
          {#if !s.smooth}<div class="faint small">{n % 2 === 0 ? `Flat to flat ${short(2 * innerRadius(R, n))} m · ` : ''}corner to corner {short(n % 2 === 0 ? 2 * R : R + innerRadius(R, n))} m · first corner on local +X</div>{/if}
        {:else}
          <div class="g2">
            <NumField label="H" value={s.height ?? 0} min={0} onchange={(v) => up((x) => x.type === 'shape' && (x.shape.height = v))} unit="m" />
            <div class="faint small center">{s.points?.length} corners · drag the white dots</div>
          </div>
        {/if}
        {#if s.kind === 'box' || s.kind === 'extrude'}
          <NumField label="Top" value={Math.round(taperOf(s) * 100)} step={5} min={0} max={100} unit="% of base" onchange={(v) => up((x) => { if (x.type !== 'shape') return; const t = Math.max(0, Math.min(1, v / 100)); if (t >= 1) delete x.shape.taper; else x.shape.taper = t; })} />
        {/if}
        {#if s.kind === 'ramp' || s.kind === 'stairs'}
          {@const info = slopeInfo(s, editor.project.character)}
          {#if info}<div class="verdict" class:bad={!info.walkable}>{info.verdict}{s.kind === 'stairs' ? ` · ${info.angle.toFixed(0)}° overall` : ''} · rise {short(info.rise)} m over {short(info.run)} m · goes up toward local +Z</div>{/if}
        {/if}
        {#if s.kind === 'stairs'}
          <NumField label="Steps" value={s.steps ?? defaultSteps(s.size?.[1] ?? 1)} step={1} min={1} onchange={(v) => up((x) => x.type === 'shape' && (x.shape.steps = Math.round(v)))} />
          <div class="faint small">Step height {short((s.size?.[1] ?? 1) / (s.steps ?? defaultSteps(s.size?.[1] ?? 1)))} m (character can step {editor.project.character.stepHeight} m)</div>
        {/if}
        {#if s.kind === 'cylinder'}
          <NumField label="Sides" value={s.sides ?? 24} step={1} min={3} max={64} onchange={(v) => up((x) => x.type === 'shape' && (x.shape.sides = Math.round(v)))} />
        {/if}
        {#if (s.kind === 'box' || s.kind === 'extrude') && e.role === 'solid'}
          <label class="tog"><input type="checkbox" checked={!!s.hollow} onchange={(ev) => up((x) => { if (x.type !== 'shape') return; if ((ev.target as HTMLInputElement).checked) x.shape.hollow = { wall: editor.project.defaults.wall, floor: true, ceiling: false }; else delete x.shape.hollow; })} /> Hollow room</label>
          {#if s.hollow}
            <div class="g3">
              <NumField label="Wall" value={s.hollow.wall} step={0.05} min={0.05} onchange={(v) => up((x) => x.type === 'shape' && x.shape.hollow && (x.shape.hollow.wall = v))} unit="m" />
              <label class="tog sm"><input type="checkbox" checked={s.hollow.floor} onchange={(ev) => up((x) => x.type === 'shape' && x.shape.hollow && (x.shape.hollow.floor = (ev.target as HTMLInputElement).checked))} /> Floor</label>
              <label class="tog sm"><input type="checkbox" checked={s.hollow.ceiling} onchange={(ev) => up((x) => x.type === 'shape' && x.shape.hollow && (x.shape.hollow.ceiling = (ev.target as HTMLInputElement).checked))} /> Ceiling</label>
            </div>
          {/if}
        {/if}
        {#if e.role === 'zone'}
          <label class="tog"><input type="checkbox" checked={!!s.infinite} onchange={(ev) => up((x) => { if (x.type === 'shape') { if ((ev.target as HTMLInputElement).checked) x.shape.infinite = true; else delete x.shape.infinite; } })} /> Infinite height (covers every floor)</label>
        {/if}
      </section>
    {:else if e.type === 'path'}
      <section>
        <div class="st">Path</div>
        <NumField label="Width" value={e.path.width} min={0.1} onchange={(v) => up((x) => x.type === 'path' && (x.path.width = v))} unit="m" />
        <div class="row">
          <label class="tog"><input type="checkbox" checked={e.path.smooth} onchange={(ev) => up((x) => x.type === 'path' && (x.path.smooth = (ev.target as HTMLInputElement).checked))} /> Smooth</label>
          <label class="tog"><input type="checkbox" checked={e.path.closed} onchange={(ev) => up((x) => x.type === 'path' && (x.path.closed = (ev.target as HTMLInputElement).checked))} /> Closed loop</label>
        </div>
        <div class="faint small">{e.path.points.length} points · double-click the path to add one, Alt-click a point to delete</div>
      </section>
    {:else if e.type === 'marker'}
      <section>
        <div class="st">Marker</div>
        <div class="g2">
          <NumField label="Facing" value={e.transform.rotation[1]} step={15} onchange={(v) => up((x) => (x.transform.rotation = [0, ((v % 360) + 360) % 360, 0]))} unit="°" />
          <NumField label="Radius" value={e.marker.radius} min={0} onchange={(v) => up((x) => x.type === 'marker' && (x.marker.radius = v))} unit="m" />
        </div>
      </section>
    {:else if e.type === 'stamp'}
      <section>
        <div class="st">Stamp</div>
        <select class="input" value={e.stamp} onchange={(ev) => up((x) => x.type === 'stamp' && (x.stamp = (ev.target as HTMLSelectElement).value))}>
          {#each Object.entries(editor.project.stamps) as [k, s]}<option value={k}>{s.name}</option>{/each}
        </select>
        <NumField label="Wall depth" value={e.depth ?? 0.3} step={0.05} min={0.05} onchange={(v) => up((x) => x.type === 'stamp' && (x.depth = v))} unit="m" />
      </section>
    {/if}

    <section>
      <div class="st">Position</div>
      <div class="g3">
        {#each [0, 1, 2] as i}
          <NumField label={'XYZ'[i]} value={e.transform.position[i]} onchange={(v) => up((x) => (x.transform.position[i] = v))} />
        {/each}
      </div>
      {#if e.type !== 'marker'}
        <div class="st sub">Rotation</div>
        <div class="g3">
          {#each [0, 1, 2] as i}
            <NumField label={'XYZ'[i]} value={e.transform.rotation[i]} step={15} onchange={(v) => up((x) => (x.transform.rotation[i] = v))} unit="°" />
          {/each}
        </div>
      {/if}
      {#if bounds}<div class="faint small">Spans {short(bounds.min.y)} → {short(bounds.max.y)} m high</div>{/if}
    </section>

    {#if propDefs.length || extraProps.length || true}
      <section>
        <div class="st">Properties</div>
        {#each propDefs as [k, d]}
          <div class="prop">
            <span class="pk" title={d.description ?? ''}>{k}</span>
            {#if d.type === 'bool'}
              <input type="checkbox" checked={!!(e.props[k] ?? d.default)} onchange={(ev) => setProp(k, (ev.target as HTMLInputElement).checked)} />
            {:else if d.type === 'enum'}
              <select class="input" value={String(e.props[k] ?? d.default ?? '')} onchange={(ev) => setProp(k, (ev.target as HTMLSelectElement).value)}>
                <option value="">—</option>
                {#each d.values ?? [] as v}<option value={v}>{v}</option>{/each}
              </select>
            {:else if d.type === 'number'}
              <NumField label="" value={Number(e.props[k] ?? d.default ?? 0)} onchange={(v) => setProp(k, v)} />
            {:else}
              <input class="input" value={String(e.props[k] ?? '')} placeholder={String(d.default ?? '')} onchange={(ev) => setProp(k, (ev.target as HTMLInputElement).value)} onkeydown={(ev) => ev.stopPropagation()} />
            {/if}
          </div>
        {/each}
        {#each extraProps as k}
          <div class="prop">
            <span class="pk">{k}</span>
            <input class="input" value={String(e.props[k])} onchange={(ev) => { const v = (ev.target as HTMLInputElement).value; setProp(k, v === 'true' ? true : v === 'false' ? false : v !== '' && !isNaN(Number(v)) ? Number(v) : v); }} onkeydown={(ev) => ev.stopPropagation()} />
            <button class="btn sm ghost" onclick={() => setProp(k, undefined)}><Icon name="x" size={12} /></button>
          </div>
        {/each}
        <div class="prop">
          <input class="input" placeholder="+ custom property" bind:value={newKey} onkeydown={(ev) => { ev.stopPropagation(); if (ev.key === 'Enter' && newKey.trim()) { setProp(newKey.trim(), ''); setProp(newKey.trim(), 'value'); newKey = ''; } }} />
        </div>
      </section>
    {/if}

    <section>
      <div class="st">Notes <span class="faint">— intent, in plain words</span></div>
      <textarea class="input" rows="3" bind:this={notesEl} bind:value={notes} placeholder="e.g. should feel cramped; visible from the bridge…" onblur={() => notes !== e.notes && up((x) => (x.notes = notes))} onkeydown={(ev) => { ev.stopPropagation(); if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) (ev.target as HTMLTextAreaElement).blur(); }}></textarea>
    </section>

    <section>
      <div class="row">
        <div class="seg">
          <button class:on={e.precision === 'exact'} onclick={() => up((x) => (x.precision = 'exact'))} title="Gameplay depends on the exact position/size">Exact</button>
          <button class:on={e.precision === 'loose'} onclick={() => up((x) => (x.precision = 'loose'))} title="Rough placement; the AI has creative freedom">Loose</button>
        </div>
        <span class="grow"></span>
        <button class="btn sm ghost" onclick={() => up((x) => (x.locked = !x.locked || undefined))} title="Lock (can't be selected in the viewport)"><Icon name="lock" size={13} />{e.locked ? 'Locked' : ''}</button>
        <button class="btn sm ghost danger" onclick={() => editor.remove([e.id])}><Icon name="trash" size={13} /></button>
      </div>
    </section>
  {:else if sel.length > 1}
    <div class="head"><div class="type">{sel.length} selected</div></div>
    <section>
      <div class="st">Tags on all</div>
      <div class="tags">
        {#each commonTags as t}<span class="chip" style="--c:{editor.tagColor(t)}"><span class="dot"></span>{t}<button onclick={() => removeTag(t)}><Icon name="x" size={11} /></button></span>{/each}
      </div>
      <TagInput autofocus={false} onpick={(t) => editor.addTag(editor.selection, t)} placeholder="+ add tag to all" />
    </section>
    <section>
      <div class="st">Role</div>
      <div class="seg full">
        {#each ['solid', 'cut', 'zone', 'guide'] as r}<button onclick={() => up((x) => { if (x.type === 'shape' || (x.type === 'path' && (r === 'zone' || r === 'guide'))) x.role = r as Role; })}>{r}</button>{/each}
      </div>
    </section>
    <section>
      <div class="row">
        <div class="seg">
          <button onclick={() => up((x) => (x.precision = 'exact'))}>Exact</button>
          <button onclick={() => up((x) => (x.precision = 'loose'))}>Loose</button>
        </div>
        <span class="grow"></span>
        <button class="btn sm" onclick={() => editor.openModal('palette', 'Make stamp')}>Make stamp…</button>
        <button class="btn sm ghost danger" onclick={() => editor.remove(editor.selection)}><Icon name="trash" size={13} /></button>
      </div>
    </section>
  {:else}
    <div class="head"><div class="type">Level</div></div>
    <section>
      <label class="field"><span>Name</span><input class="input" value={editor.level.name} onchange={(ev) => editor.commit({ ...editor.level, name: (ev.target as HTMLInputElement).value })} onkeydown={(ev) => ev.stopPropagation()} /></label>
    </section>
    <section>
      <label class="field"><span>Intent — what should this level do / feel like?</span>
        <textarea class="input" rows="5" value={editor.level.intent} placeholder="e.g. Tutorial for jumping. Calm and open. The player should always see the tower." onchange={(ev) => editor.commit({ ...editor.level, intent: (ev.target as HTMLTextAreaElement).value })} onkeydown={(ev) => ev.stopPropagation()}></textarea>
      </label>
    </section>
    <section>
      <div class="st">Storeys</div>
      {#each editor.level.storeys as s, i}
        <div class="prop">
          <input class="input" value={s.name} onchange={(ev) => editor.commit({ ...editor.level, storeys: editor.level.storeys.map((x, j) => (j === i ? { ...x, name: (ev.target as HTMLInputElement).value } : x)) })} onkeydown={(ev) => ev.stopPropagation()} />
          <NumField label="Y" value={s.y} onchange={(v) => editor.commit({ ...editor.level, storeys: editor.level.storeys.map((x, j) => (j === i ? { ...x, y: v } : x)).sort((a, b) => a.y - b.y) })} unit="m" />
          {#if editor.level.storeys.length > 1}<button class="btn sm ghost" onclick={() => editor.commit({ ...editor.level, storeys: editor.level.storeys.filter((_, j) => j !== i) })}><Icon name="x" size={12} /></button>{/if}
        </div>
      {/each}
      <button class="btn sm" onclick={() => { const top = Math.max(...editor.level.storeys.map((s) => s.y)); editor.commit({ ...editor.level, storeys: [...editor.level.storeys, { id: 'storey-' + (editor.level.storeys.length + 1), name: `Floor ${editor.level.storeys.length + 1}`, y: top + 4 }] }); }}><Icon name="plus" size={12} /> Add storey</button>
    </section>
    <section class="stats">
      <div class="st">Contents</div>
      <div class="faint">{levelStats.shape ?? 0} shapes · {levelStats.marker ?? 0} markers · {levelStats.path ?? 0} paths · {levelStats.stamp ?? 0} stamps · {levelStats.note ?? 0} notes</div>
      <div class="faint small mono">{editor.root}/levels/{editor.levelId}/level.json</div>
    </section>
    <section class="tips">
      <div class="st">Quick start</div>
      <div><kbd>D</kbd> drag = box, clicks = polygon. Then move up, click.</div>
      <div><kbd>0</kbd>–<kbd>9</kbd> pens: pick what you're drawing.</div>
      <div><kbd>V</kbd> select · drag to move · arrows on faces push/pull.</div>
      <div><kbd>R</kbd> ramp · <kbd>⇧S</kbd> stairs · <kbd>H</kbd> room · <kbd>X</kbd> cut.</div>
      <div><kbd>S</kbd> stamp doors/windows into walls.</div>
      <div><kbd>T</kbd> tape: "can I make this jump?" · <kbd>G</kbd> walk it.</div>
      <div><kbd>⌘K</kbd> find anything · <kbd>?</kbd> all shortcuts.</div>
    </section>
  {/if}
</aside>

<style>
  .insp { width: 284px; flex: none; background: var(--panel); border-left: 1px solid var(--line); display: flex; flex-direction: column; }
  .head { padding: 10px 12px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
  .type { font-weight: 650; text-transform: capitalize; }
  .mono { font-family: var(--mono); font-size: 11px; }
  .name { font-weight: 550; }
  section { padding: 10px 12px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 7px; }
  .st { font-size: 11px; font-weight: 650; color: var(--dim); text-transform: uppercase; letter-spacing: 0.04em; }
  .st .faint { text-transform: none; letter-spacing: 0; font-weight: 400; }
  .st.sub { margin-top: 2px; }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; }
  .tags:empty { display: none; }
  .chip { border-color: color-mix(in srgb, var(--c) 50%, transparent); }
  .chip button { display: inline-flex; color: var(--faint); margin-right: -3px; }
  .chip button:hover { color: var(--text); }
  .desc { font-size: 11.5px; line-height: 1.4; }
  .seg.full { display: flex; }
  .seg.full button { flex: 1; text-transform: capitalize; }
  .seg.wrap { flex-wrap: wrap; }
  .seg.wrap button { flex: 1 0 30%; }
  .g3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
  .g2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; align-items: center; }
  .small { font-size: 11px; }
  .center { text-align: center; }
  .tog { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #cfd6df; }
  .tog.sm { font-size: 11px; }
  .prop { display: flex; align-items: center; gap: 6px; }
  .prop > :global(*:not(.pk)) { flex: 1; min-width: 0; }
  .pk { width: 74px; flex: none; color: var(--dim); font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
  .tips div { color: var(--dim); font-size: 12px; }
  .verdict { font-size: 12px; color: #8ff0b1; }
  .verdict.bad { color: #ff9a9a; }
  .stats .mono { word-break: break-all; }
</style>
