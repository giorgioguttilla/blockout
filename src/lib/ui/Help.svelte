<script lang="ts">
  import Modal from './Modal.svelte';
  const groups: [string, [string, string][]][] = [
    ['Draw', [['D', 'Draw: drag = the chosen shape, clicks = any polygon'], ['D again', 'Cycle Box → N-gon → Circle → Cone → Ramp → Stairs'], ['[ ]', 'Fewer / more sides (N-gon) · width (ramps, stairs)'], ['type 2 / 2f ⏎', 'Radius to corner / to flat while dragging a round shape'], ['Alt-drag', 'Fit a round shape inside the box you drag'], ['Ramp / Stairs', 'Drag from the bottom to where it arrives; release on a platform to match its height'], ['L', 'Line / path: clicks or freehand drag, Enter to finish'], ['M', 'Marker: click to place, drag to aim'], ['S', 'Stamp doors, windows… onto walls'], ['N', 'Pin a note'], ['T', 'Tape measure + jump check'], ['type 4,6 ⏎', 'Exact size while dragging; 3 ⏎ for height'], ['⌘ / Ctrl (hold)', 'Free-draw without snapping'], ['Shift (hold)', 'Square / 45° / one axis'], ['Alt-click a face', 'Draw: lock the plane to it (any angle) · Select: set the selection onto it'], ['Q / E', 'Lower / raise the work plane'], ['Shift+Q / E', 'Jump between storeys']]],
    ['Meaning', [['0–9', 'Pick a pen (what you draw)'], ['Shift+0–9', 'Apply that pen to the selection'], ['#', 'Tag the selection'], ['Enter', 'Edit notes'], ['right-click a pen', 'Change what it draws']]],
    ['Edit', [['V', 'Select / move / push-pull'], ['Alt-drag', 'Duplicate, then type x5 ⏎ for an array'], ['R', 'Ramp (again to turn)'], ['C', 'Round (again: polygon)'], ['Red dot', 'Drag to taper into a frustum / cone'], ['Red & blue rings', 'Tilt around the shape\'s own axes'], ['White cube', 'Scale proportionally (Alt: from the center)'], ['Shift+S', 'Stairs'], ['O / B', 'Blob / box'], ['H', 'Hollow room'], ['X', 'Cut ⇄ solid (or section view)'], [', .', 'Rotate 15° (Shift: 90°)'], ['Arrows / PgUp PgDn', 'Nudge / lift'], ['[ ]', 'Path width / marker radius'], ['⌘D ⌘C ⌘V', 'Duplicate, copy, paste at cursor'], ['⌘Z ⇧⌘Z', 'Undo / redo'], ['Shift+H', 'Hide (again with nothing selected: unhide all)'], ['⌫', 'Delete']]],
    ['View', [['Right-drag', 'Orbit around the point under the cursor'], ['Middle-drag / Space-drag', 'Pan'], ['Wheel', 'Zoom to cursor'], ['Right-drag + WASD/QE', 'Fly'], ['Trackpad', 'Two fingers orbit · Shift pans · pinch zooms'], ['Tab', 'Plan (top) ⇄ 3D'], ['F / Shift+F', 'Frame selection / all'], ['X', 'Section view'], ['J', 'Jump rings'], ['`', 'Character scale capsule'], ['\\', 'Hide panels']]],
    ['Play & ship', [['G', 'Walk mode with your character'], ['A', 'Traversal analysis'], ['⌘S', 'Save a named version'], ['⌘K', 'Command palette — everything is searchable']]]
  ];
</script>
<Modal title="Keyboard & mouse" width={860}>
  <div class="cols">
    {#each groups as [g, items]}
      <div class="grp">
        <div class="section-title">{g}</div>
        {#each items as [k, d]}<div class="it"><kbd>{k}</kbd><span>{d}</span></div>{/each}
      </div>
    {/each}
  </div>
</Modal>
<style>
  .cols { columns: 3 250px; column-gap: 26px; }
  .grp { break-inside: avoid; margin-bottom: 16px; display: flex; flex-direction: column; gap: 6px; }
  .it { display: flex; gap: 10px; align-items: baseline; font-size: 12.5px; color: #cfd6df; }
  .it kbd { flex: none; }
</style>
