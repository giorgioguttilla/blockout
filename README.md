# Blockout

Sketch game levels in 3D with simple shapes and tags. Then hand them to an AI that builds the real level in
your engine. Blockout is not a 3D modeler. It records **intent**: what goes where, at what scale, and how the
player moves through it.

## Run it

```bash
npm install
npm run dev            # http://localhost:5199 — pick or create a project folder in the UI
```

Or open a folder directly with the production build:

```bash
npm run build
node bin/blockout.mjs ~/code/my-game/design     # or: npm link && blockout ~/code/my-game/design
```

On the welcome screen, **Try the demo level** creates a sample project in `~/Blockout/Demo`.

## Drawing (the 30-second version)

| | |
|---|---|
| `D` draw | **drag** draws the chosen shape · **click-click-click** = any polygon · then move up to set the height and click (clicking without moving keeps the last height). Type `4,6 ⏎` while dragging, `3 ⏎` for height. |
| Shapes | `D` again cycles **Box · N-gon · Circle · Cone · Ramp · Stairs** (or pick from the panel next to the toolbar). Round shapes drag **from the center**: the distance is the radius, the direction sets the first corner. `[` `]` change sides (3–16), `2 ⏎` = radius to corner, `2f ⏎` = radius to flat, `Alt`-drag fits the shape in a box. Corners, midpoints and **centers** snap, so stacking a hexagon on a hexagon is concentric. |
| Ramps & stairs | Drag from the bottom to where it should arrive. Release on a platform and the rise matches its height. Live check against your character: `11° ✓ walkable`, `0.28 m steps ✓` or a warning. |
| `0`–`9` pens | Choose *what* you're drawing (solid, cut, trees, chest, enemy, water…), the same way you'd pick a colored pencil. Zone pens draw freehand. Object pens switch to the marker tool. `Shift+n` applies a pen to the selection. Right-click a pen to change it. |
| `V` select | Drag to move (snaps to the grid). Blue arrows push/pull faces, change the radius or the height. The **red dot** tapers the top (frustum → cone/pyramid). The **orange ring** turns it, the **red and blue rings** tilt it around its own axes, the **white cube** scales it proportionally (`Alt`: from the center). The green arrow lifts. `Alt`-drag duplicates (type `x5 ⏎` for an array). **`Alt`-click any face** to set the selection onto it, slopes included. |
| `R` `⇧S` `C` `O` `H` `X` | Ramp (press again to turn it) · stairs · round (again: polygon) · blob · hollow room · cut ⇄ solid |
| `L` line | Paths and routes: click points or drag freehand. `[` `]` change the width. |
| `M` marker | Click to place. Drag to place and aim it (sets facing). |
| `S` stamp | Doors, windows and openings snap onto walls and cut through them at the wall's thickness. Make your own from a selection with `⌘K` → "Make stamp". |
| `N` note · `T` tape | Pin a sticky note · measure a gap and see whether it's a jump, a sprint jump, or too far |
| Work plane | You always draw on a plane: the ground, or **any face** you start on (tops, walls, ramps, faces of tilted shapes). `Q`/`E` move it up and down, `Shift+Q`/`E` jump between storeys, `Alt`-click a face locks the plane to it. |
| View | Right-drag orbits around the point under the cursor · middle-drag or `Space`-drag pans · wheel zooms to the cursor · trackpad: two fingers orbit, pinch zooms, `Shift` pans · `Tab` switches between plan view and 3D · `X` section view · `F` frames the selection |
| Check | `G` walk mode with your character's real speed and jump · `A` traversal analysis · `J` jump rings |
| Everything else | `⌘K` command palette · `?` shortcuts · `⌘Z` undo · `⌘S` save a named version |

## Project folder (lives in your game repo)

```
design/
  game-settings.md          ← gameplay numbers (character size/speeds/jump, grid) + target engine axes/units
  blockout.project.json     ← tag vocabulary (with descriptions), stamps, pens
  AGENTS-blockout.md        ← format guide for AI agents
  levels/<id>/
    level.json              ← working copy (autosaved, canonical, git-friendly)
    versions/NNNN.json      ← named snapshots + index.json (one may be marked "built")
    handoff/                ← BRIEF.md, CHANGES.md, PROMPT.txt, analysis.json, screenshots
```

**`game-settings.md` is the source of truth for movement.** It is plain `- key: value` markdown, so the agent
building your game can keep it in sync with the real character controller. Blockout reloads it live. When you
change values in the UI, it rewrites them in place and keeps any notes the agent added.

### Section view

`X` cuts the level at 2.2 m above the work plane (or along a plane you locked with `Alt`-click). Everything the
cut passes through gets a hatched cap and a crisp outline, drawn on the GPU without changing the level.
**Hand off** also exports one floor plan per storey (`plan-<storey>.png`) using the same cut.

### Target engine

Blockout stores everything in its own convention (meters, up `+y`, forward `+z`, right `−x`). The target engine is
described the same way: **units per meter, which axis is up, which way things face at rotation 0 (forward), which
way a character's right hand points, and degrees or radians**. Handedness and the direction of positive rotation
follow from those axes. Unity, Unreal, Godot, three.js, Blender and Roblox are presets. For any other engine,
give it a name and its axes. Briefs then list every position, size, facing and path point already converted
(`in Unreal: pos (300, -100, 200) · yaw -90°`).

## The AI loop

1. Sketch. Tag things and write notes about intent.
2. **Hand off** writes `BRIEF.md` (every element by id, with position, size, facing, tags, notes and precision),
   labelled top and 3D screenshots, a traversal report, and a prompt you can paste into your agent. The version
   is saved and marked **built**.
3. Edit the sketch, then **Hand off → Changes since vN**. This writes `CHANGES.md`, a list of changes by
   element id ("chest-02 moved 4 m by [0, 0, -4]"), so the agent updates only what changed.
4. If an agent edits `level.json` directly, Blockout shows a "changed on disk" banner. Load the changes to see
   them highlighted, or undo them.

## CLI (headless, for agents)

```bash
blockout levels   <folder>
blockout brief    <folder> <level> [--analyze]
blockout diff     <folder> <level> [--since baseline|N] [--to N]
blockout analyze  <folder> <level> [--json]
blockout validate <folder>
```

## Data model

- **Element types:** shape (box / polygon / regular n-gon prism, cylinder, cone or frustum / ramp / stairs / blob, optionally tapered or a hollow room), path,
  marker (point + facing + optional radius), stamp instance, note.
- **Roles:** `solid` = blockout geometry, `cut` = subtracts from solids, `zone` = an area with meaning,
  `guide` = points and lines.
- Every element also has `tags`, free-form `props`, `notes`, and a precision flag (`exact` or `loose`).
- **Conventions:** meters, Y-up, right-handed. Rotations are [x, y, z] degrees applied yaw → pitch → roll (Euler YXZ). Forward is +Z. Box-like shapes
  are positioned by their bottom center. The brief explains how to convert to Unity, Unreal or Godot.

## Development

```bash
npm run check   # svelte-check (types)
npm test        # vitest: serialization, diff, physics, settings doc
npm run build   # adapter-node server + bundled CLI
```

Stack: SvelteKit 3 / Svelte 5, three.js (used directly), three-mesh-bvh (picking, walk-mode collision,
analysis), three-bvh-csg (cuts and hollow rooms). The local Node server only reads and writes inside the
folder you opened, and watches it for changes.

Code map: `src/lib/model` (format, diff, physics, brief, settings doc) · `src/lib/engine` (rendering, camera,
geometry, CSG) · `src/lib/tools` (one state machine per tool) · `src/lib/traversal` (analysis, walk mode) ·
`src/lib/ui` (Svelte panels) · `src/lib/server` + `src/routes/api` (file store) · `cli/`.
