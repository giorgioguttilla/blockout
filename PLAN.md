# Blockout — a semantic 3D level-sketching editor (working name)

> A map maker / annotator, **not** a 3D modeler. You sketch the intent of a level in 3D with
> cheap primitives and tags. An AI (any AI, any engine, any asset library) turns that into a
> real level. The file is the contract between you and the AI.

---

## 0. TL;DR

- **Drawing-first.** One "smart pencil" tool: drag = box, click-click-click = polygon. Every
  shape is a 2D footprint on a work plane, pulled up to a height. That one idea (from SketchUp)
  is what makes 3D drawing with a mouse feel like drawing on paper.
- **Pens, not menus.** You pick a *pen* (a tag: `solid`, `cut`, `trees`, `chest`, `water`…) the
  way you'd pick a colored marker. The pen decides what a stroke *means*. Number keys switch pens.
- **Five primitives:** Shape (solid / cut / zone), Path (spline with width), Marker (point +
  facing + optional radius), Stamp (reusable template like "door"), Note. Everything carries
  `tags`, `props`, `notes` and a `precision` flag (exact vs. loose).
- **Character-aware.** The project has a character profile (speeds, jump height, etc.). The
  editor gives you a live **jump ruler**, a **walk mode** to run around the graybox with those
  exact physics, and a **traversal analysis** that colors what's reachable and how.
- **Plain files in your repo.** Open any folder (e.g. `my-game/design/`). Levels are
  canonical, git-friendly JSON. Named versions, semantic + visual diffs.
- **Handoff loop.** "Hand off" writes a `BRIEF.md` + screenshots + the JSON. After you edit,
  "Hand off changes" writes a `CHANGES.md` (semantic diff since the last handoff, by stable
  element ID) so the AI can make targeted edits instead of rebuilding.
- **Stack:** SvelteKit (Svelte 5) + TypeScript + vanilla three.js, a local Node server for
  file I/O + file watching, and a CLI so agents can use it headlessly.

---

## 1. Product principles

1. **Intent over geometry.** Record *what* and *where*, not *how it looks*. No UVs, no
   materials, no bevels. "Use bevels" is a tag.
2. **Pencil speed.** Idea → something on screen in one gesture. Never require a dialog to
   create something. Tagging, naming and notes are optional and can happen later.
3. **Forgiving, then precise.** Rough by default (grid snap, default heights), exact when you
   want it (type a number while dragging).
4. **Always readable by an AI.** Human-readable IDs, meters, documented coordinate system,
   tag descriptions that live in the project. No code, no engine assumptions.
5. **Feedback is instant.** Dimensions, scale reference and jump feasibility are always one
   key away, so "is this jump possible?" is never tribal knowledge.

---

## 2. Data model

### 2.1 Elements

Every element has a common envelope:

```jsonc
{
  "id": "chest-03",            // stable, human-readable, never changes after creation
  "type": "marker",            // shape | path | marker | stamp | note | group
  "name": "Reward chest",      // optional
  "tags": ["chest", "locked"], // first tag = primary tag (drives color/icon/proxy)
  "role": "guide",             // solid | cut | zone | guide  (see below)
  "props": { "contents": "red-key" },  // free key/values, suggested by tag definitions
  "notes": "Visible from the bridge but only reachable via the cave.",
  "precision": "exact",        // exact | loose — how literally the AI should place it
  "storey": "ground",          // optional, for filtering/section views
  "parent": "grp-ruins"        // optional group
}
```

**Roles** (what it is physically):

| role    | meaning                                                          | look                     |
|---------|------------------------------------------------------------------|--------------------------|
| `solid` | blockout geometry you can stand on / collide with                | light gray, edge lines   |
| `cut`   | subtracted from solids it overlaps (doorways, holes, tunnels)    | red, translucent, hatched|
| `zone`  | non-physical area/volume with meaning ("trees here", "water")    | tag color, translucent   |
| `guide` | non-physical point/line (spawn, patrol route, camera path)       | icon / dashed line       |

**Types** (what shape it is):

- **Shape** — a footprint on a plane, extruded.
  ```jsonc
  "transform": { "position": [12, 0, -4], "rotation": [0, 90, 0] }, // degrees, Y-up
  "shape": {
    "kind": "box",                 // box | extrude | cylinder | ramp | stairs | blob
    "size": [6, 3, 0.4],           // box/ramp/stairs/blob
    "points": [[0,0],[8,0],[8,6]], // extrude: footprint polygon in local XZ
    "height": 3,                   // extrude/cylinder; null = infinite (zones only)
    "sides": 16,                   // cylinder
    "steps": 10,                   // stairs (default: derived from character step height)
    "hollow": { "wall": 0.3, "floor": true, "ceiling": false } // "room" — optional
  }
  ```
  A zone with `height: 0` is a flat area painted onto whatever surface is below it.
  A zone with `height: null` extends infinitely along its plane normal.
- **Path** — spline through 3D points with a width. Roads, rivers, rails, patrol routes.
  ```jsonc
  "path": { "points": [[0,0,0],[5,0,2],[9,1,8]], "width": 2.5, "widths": null,
            "closed": false, "smooth": true }
  ```
  role `zone` = an area (dirt path, river). role `guide` = a line (patrol route, camera track).
- **Marker** — a point with facing and optional radius.
  ```jsonc
  "transform": { "position": [3, 1, 7], "rotation": [0, 135, 0] },  // yaw = facing
  "marker": { "radius": 0 }   // radius > 0 → it's also a circular zone ("enemies within 8m")
  ```
  Whether a marker is an *object* (chest), an *actor* (enemy, NPC) or a *point* (spawn,
  checkpoint) comes from its tag's category — not from a separate primitive. In-editor they
  behave identically; downstream they mean different things, which is exactly what tags are for.
- **Stamp instance** — placement of a reusable template (see 2.3).
  ```jsonc
  { "type": "stamp", "stamp": "door", "transform": {...}, "props": { "locked": true } }
  ```
- **Note** — a sticky note pinned in space. `{ "type": "note", "transform": {...}, "notes": "…" }`
- **Group** — organizational only.

### 2.2 Tags (the project vocabulary)

Tags are strings. Their *definitions* live in the project file and are the glossary the AI reads:

```jsonc
"tags": {
  "chest": {
    "category": "object",          // object | actor | point | zone | surface | style | flow
    "description": "Lootable chest. Facing = the side the player opens it from.",
    "color": "#d4a017", "icon": "box",
    "proxy": [1.0, 0.7, 0.6],      // marker renders as a box this size → true scale
    "defaultRole": "guide",
    "needsFacing": true,
    "props": { "contents": { "type": "string" }, "locked": { "type": "bool", "default": false } }
  },
  "trees": {
    "category": "zone",
    "description": "Dense tree cover. Blocks movement except along paths.",
    "color": "#2f7d32", "defaultRole": "zone",
    "props": { "density": { "type": "enum", "values": ["sparse","medium","dense"], "default": "medium" } }
  }
}
```

- Ship **starter packs** (generic, platformer, shooter, RPG, stealth): spawn, checkpoint, goal,
  enemy, npc, pickup, chest, door, ladder, climbable, hazard, kill-volume, water, trees, grass,
  rocks, cover, road, dirt-path, light, camera, trigger, secret, no-go, one-way, breakable…
- You can create a tag inline just by typing a new word; it gets a color and an empty
  description you can fill in later. The AI can add tags too.
- Tag props are *suggestions*: the inspector shows them as fields, but `props` stays free-form.

### 2.3 Stamps (templates)

A stamp is a saved mini-scene in the project: e.g. **Door** = a `cut` box 1.2×2.2 + a `door`
marker with facing. **Window**, **Archway**, **Ladder**, **Jump pad**, **Doorway (no door)**.

- Create one from any selection ("Make stamp").
- Placing a stamp over a wall **snaps to the face, aligns to its normal, and sizes its cut to
  the wall thickness** — one click = doorway cut + door marker.
- Editing the stamp definition updates every instance. The brief lists instances both as
  "door stamp" and expanded into their parts.

### 2.4 Level & project files

```jsonc
// blockout.project.json
{
  "format": "blockout/project@1",
  "name": "My Game",
  "units": "m", "up": "+y", "handedness": "right",   // three.js convention, documented
  "grid": { "size": 1, "subdivisions": 4 },
  "character": { ... },                                // see §4
  "tags": { ... },
  "stamps": { ... }
}

// levels/forest-01/level.json
{
  "format": "blockout/level@1",
  "id": "forest-01",
  "name": "Forest Approach",
  "intent": "Tutorial for jumping. Calm, open, readable. Ends at the ruined gate.",
  "storeys": [ { "id": "ground", "name": "Ground", "y": 0 }, { "id": "upper", "name": "Ramparts", "y": 6 } ],
  "elements": [ ... ]
}
```

Serialization is **canonical**: stable key order, elements ordered by creation, numbers
rounded to 1 mm, 2-space pretty print → clean git diffs and stable semantic diffs.

---

## 3. The editor — UX

### 3.1 Layout

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ ◧ My Game / forest-01 ▾   [ Plan | 3D ]   Plane: Ground 0.0 m ▾   v7 · saved     ▶ Walk   ⚡ Analyze   ⇪ Hand off │
├────────────┬───────────────────────────────────────────────────────────┬────────────┤
│ OUTLINER   │                                                           │ INSPECTOR  │
│ ▸ Storeys  │                                                           │ #chest #locked │
│ ▸ By tag   │                     VIEWPORT                              │ role ▾     │
│   trees(4) │                                                           │ contents __│
│   chest(3) │                                                           │ size 1×.7×.6│
│ ▸ Groups   │                                                           │ notes ____ │
│            │   ┌─ tools ─────────────┐                                 │ exact/loose│
│ VERSIONS   │   │ V  D  L  M  S  N  T │                                 │            │
│  v7 cave   │   └─────────────────────┘                                 │            │
│  v6 ⇪ hand │  PENS  0 solid  1 cut  2 trees  3 chest  4 enemy  5 water  + │         │
└────────────┴───────────────────────────────────────────────────────────┴────────────┘
```

Side panels collapse (`\`) to a full-bleed canvas — the "blank sheet of paper" mode.

### 3.2 The work plane (the "paper")

The single hardest problem in 3D drawing with a 2D device is *where does a click land in
depth?* Answer: **you always draw on a plane**, and the editor makes picking that plane
effortless.

- Default plane = the current storey's floor (Y = 0).
- **Surface inference:** start a stroke on top of an existing platform → you're drawing on that
  platform. Start on a wall → you're drawing on the wall (windows, doorways, ledges).
- `Q` / `E` lower/raise the plane by one grid step; the HUD shows `Plane: 4.0 m`.
  Clicking a storey in the outliner jumps the plane there.
- `Alt`-click any face → lock the plane to it until `Esc`.
- **Depth cues are always on:** 3D cursor with a drop line to the ground, drop shadows/lines
  under floating objects, 1 m checker on solids, a dimmed grid at the active plane. These are
  what make the 3D view readable without a second viewport.

### 3.3 Views & camera

- `Tab` toggles **Plan** (top-down orthographic — literally paper) and **3D** (perspective),
  with a smooth animated transition. All tools work identically in both.
- **Section view** (`X`): hides everything above the active plane + a cap — floor plans for
  multi-storey buildings.
- **Mouse (default):** RMB-drag orbit, MMB-drag pan, wheel zoom-to-cursor, RMB + WASD fly
  (Unity-style) for big levels. Orbit pivots around the point under the cursor.
- **Trackpad (first-class fallback):** pinch = zoom, two-finger drag = orbit (3D) / pan (Plan),
  Shift + two-finger = pan, `Space`-drag = pan, `Option`-drag = orbit. Auto-detected from wheel
  event characteristics, with a manual override in settings.
- `F` frame selection, `Shift+F` frame all, `1/3/7`-style view presets via the view cube.

### 3.4 Tools (few, one key each)

| key | tool        | gesture                                                                                  |
|-----|-------------|------------------------------------------------------------------------------------------|
| `V` | **Select**  | click select, `Shift` add, marquee on empty space; drag body = move along plane; drag face handle = push/pull; `Alt`-drag = duplicate |
| `D` | **Draw**    | *smart pencil:* drag = rectangle footprint; click-click-click = polygon (close on first point / double-click / `Enter`); then move mouse to set height, click to commit — or click without moving to accept the last-used height |
| `L` | **Line**    | click = control points; drag = freehand stroke (auto-simplified to a spline); `[`/`]` width |
| `M` | **Marker**  | click = place; **click-drag = place and aim** (drag direction = facing)                  |
| `S` | **Stamp**   | pick a stamp, hover a surface (snaps + aligns), click                                     |
| `N` | **Note**    | click to pin a sticky note, type                                                          |
| `T` | **Tape**    | click two points → distance, Δheight, and which movement tier can make that jump          |

Hold `Cmd/Ctrl` in any drawing tool = temporary Select (Figma/Photoshop habit).

**Pens change gestures to match intent:**
- Solid / cut pens: Draw-drag = rectangle (architectural).
- Zone pens (trees, water, grass…): Draw-drag = **freehand lasso** (organic). `Alt` swaps.
- Object/actor/point pens (chest, enemy, spawn): picking one auto-switches to the Marker tool,
  which renders the tag's proxy box at true scale.

**Fast shape variants without new tools** — with a box selected:
`R` → ramp (press again to rotate the slope direction), `Shift+S` → stairs (step count derived
from the character's step height), `C` → cylinder, `H` → hollow room (walls + floor; cut doors
into it with stamps). Draw boxes fast, convert after.

### 3.5 Precision on demand

- Grid snap on by default; hold `Cmd/Ctrl` to free-draw. Snaps to vertices, edges, midpoints,
  face centers, and alignment guides to nearby objects (SketchUp-style inference lines).
- `Shift` while dragging = constrain to axis / 45°.
- **Type-to-dimension:** while dragging, just type `4` `Enter` → 4 m. `4,6` → 4 × 6. During the
  height phase, `3` → 3 m tall. While moving, `10` → moves 10 m along the drag direction.
- **Arrays:** after an `Alt`-drag duplicate, type `x5` → five evenly spaced copies (great for
  platform runs), `/5` → five copies dividing the distance.
- Live dimension labels on everything you're dragging.

### 3.6 Tagging without friction

- After you create something, a faint `#` chip appears next to it. Type to tag with autocomplete,
  `Enter`. Or ignore it and keep drawing — it fades.
- `#` on a selection = add tag; `Shift+1..9` = apply pen 1–9's tag to the selection.
- `0–9` = switch pen. `+` on the pen bar = new pen from any tag.
- `Enter` on a selection = edit notes. Notes are first-class: "this should feel cramped" is
  valuable grounding.
- **`Cmd+K` command palette**: every action, tag, stamp, storey, element and version is
  searchable. "Make stairs", "go to chest-03", "new tag lava".

### 3.7 Scale reference

Hold `H`-free: a ghost capsule of the project character follows the 3D cursor whenever a
drawing tool is active (toggle with `` ` ``). Hold `J` to also show jump rings: the max
horizontal reach for walk-jump / sprint-jump / extra abilities from the point under the cursor,
projected onto surfaces at different heights.

### 3.8 Default keyboard map (draft)

```
Tools     V select  D draw  L line  M marker  S stamp  N note  T tape
Pens      0–9 pick pen   Shift+0–9 apply pen to selection   # add tag   Enter notes
Convert   R ramp  Shift+S stairs  C cylinder  H hollow/room  X(toggle on selection) solid⇄cut
Plane     Q/E down/up   Alt+click lock plane to face
View      Tab plan⇄3D   F frame   Shift+F frame all   X section (no selection)   \ hide panels
Edit      Cmd+Z/Shift+Cmd+Z undo/redo  Cmd+D duplicate  Del delete  Cmd+G group  Cmd+C/V copy/paste
Play      G walk mode (Esc to exit)   J jump rings   Cmd+K palette   Cmd+S save version
```

(Keys will be tuned during implementation; everything is rebindable.)

---

## 4. Traversal: making movement rules explicit

### 4.1 Character profile (project-level)

```jsonc
"character": {
  "height": 1.8, "radius": 0.35, "stepHeight": 0.35, "maxSlope": 45,
  "walkSpeed": 4.0, "sprintSpeed": 7.0,
  "jumpHeight": 1.25, "timeToApex": 0.40,       // designer-friendly; gravity & v0 derived
  "coyoteTime": 0.1, "airControl": 0.5,
  "extraJumps": 0,                              // double jump etc.
  "abilities": [ { "name": "dash", "distance": 4, "airborne": true } ],
  "crouchHeight": 1.0
}
```

Derived: `g = 2h / t²`, `v₀ = 2h / t`. Airtime to land at height difference Δh:
`t(Δh) = (v₀ + √(v₀² − 2gΔh)) / g`. Max gap = `speed · (t(Δh) + coyoteTime) + 2·radius`.
With defaults: flat walk-jump ≈ 3.6 m, flat sprint-jump ≈ 6.3 m, max climb 1.25 m.
These numbers are shown in the project settings panel as a little table so they're never
implicit.

**Movement tiers** (each gets a color everywhere): walk · step/ramp · walk-jump · sprint-jump ·
extra jump · each ability · drop-only (can go down, can't come back).

### 4.2 Tools for answering "is this jump possible / too easy?"

1. **Jump rings** (hold `J`): instant, no baking. Shows reach envelopes from the cursor.
2. **Tape tool** (`T`): two points → `gap 4.8 m, +0.6 m → sprint-jump ✓ (82% of max)`.
   Margin % is the "too easy / too tight" signal: >90% flagged tight, <40% flagged trivial
   for that tier (thresholds configurable per project).
3. **Walk mode** (`G`): drop a capsule at the cursor (or a spawn) and play the graybox in
   first- or third-person with the exact profile physics (kinematic controller on a BVH).
   Nothing beats feeling the scale. Esc returns to where you were.
4. **Traversal analysis** (⚡ Analyze, runs in a Web Worker, optionally auto on idle):
   - Build a walkable navmesh from solids (minus cuts) with the character's radius, height,
     step and slope (Recast via `recast-navigation-js`).
   - Generate jump links between navmesh edges using the trajectory formula, checking
     clearance along the arc with raycasts.
   - Flood-fill from spawn markers → color every walkable surface by the *minimum tier needed
     to reach it*; hatch unreachable surfaces red; mark one-way drops (potential soft-locks).
   - Check tagged objectives (`goal`, `chest`, `checkpoint`) for reachability and list them.
   - Output a report panel + `analysis.json` (included in the handoff).

---

## 5. Projects, files, versions

### 5.1 Folder layout (lives in your game repo)

```
my-game/
  design/                         ← open this folder in the editor
    blockout.project.json         ← character, grid, tag vocabulary, stamps
    AGENTS-blockout.md            ← format spec for AIs (auto-written, versioned with the tool)
    levels/
      forest-01/
        level.json                ← working copy (autosaved)
        versions/
          index.json              ← [{ n, message, time, handoff: true|false }]
          0001.json  0002.json …
        handoff/
          BRIEF.md  CHANGES.md  analysis.json
          top.png  iso-ne.png  iso-sw.png  …
```

### 5.2 How the app reaches your files

Run `npx blockout ./design` (or `npm run dev -- ./design`). A small local Node server serves the
app and does file I/O inside that root only (path-traversal guarded). Why not the browser's
File System Access API alone: it's Chromium-only and can't watch files. The server can
**watch** files, so if an AI edits `level.json` the editor shows "Changed on disk" with a
visual diff and lets you accept it — the loop works in both directions.

### 5.3 Versioning

- **Autosave** the working copy continuously (debounced) + unlimited in-session undo.
- **Versions** are explicit named snapshots (`Cmd+S` → type a message, like a commit). Stored
  as full copies — levels are small, and full copies are robust. Diffs are computed on demand.
- **Semantic diff** between any two versions, by element ID: added / removed / moved (with
  distance) / resized / retagged / props changed / notes changed.
- **Visual diff** in the viewport: added = green, removed = red ghost, moved = ghost + arrow,
  modified = amber. Scrub between versions in the Versions panel.
- **Restore** a version, or **branch** it into a new level variant (`forest-01-alt`).
- Everything is also plain files, so git works on top for free.

---

## 6. The lifecycle with an AI

```
 sketch ──► Hand off (v3, marked) ──► AI builds level in engine (names objects by element ID)
   ▲                                                      │
   │                                                      ▼
 edit sketch (v4, v5) ──► Hand off changes ──► AI applies CHANGES.md (targeted refactor)
   ▲                                                      │
   └──────────── AI may also write level.json; editor shows the diff, you accept ◄──┘
```

**Hand off** writes `handoff/`:
- `BRIEF.md` — level intent; coordinate system + conversion table (Unity: flip Z; Unreal:
  Z-up, cm, swap axes; Godot: same as ours); character profile and derived jump table; storeys;
  every element grouped by tag with id, position, size, facing, props, notes, precision;
  stamp instances expanded; glossary of *only the tags used*; traversal report (tight jumps,
  unreachable areas, one-way drops); a "fidelity contract" (solids are blockout — final art is
  the AI's job; `exact` = keep within 0.1 m; `loose` = creative freedom; respect cuts as
  openings; keep element IDs as object names/metadata in the engine scene).
- Screenshots: top-down plan + 4 isometric views, with labels. Images + exact coordinates is
  the best grounding we can give a multimodal model.
- Marks that version as the **baseline**.

**Hand off changes** writes `CHANGES.md`: the semantic diff from the last baseline to now, plus
before/after screenshots, then moves the baseline. Because IDs are stable and the AI was told
to keep them in the engine scene, "chest-03 moved 4 m north" is a precise instruction.

Both buttons also offer **Copy prompt** — a ready-made instruction pointing at the files
("Build level forest-01 from design/levels/forest-01/handoff/BRIEF.md…").

**CLI (for agents, headless):**
`blockout brief <level>` · `blockout diff <level> [--since baseline|vN]` ·
`blockout validate` · `blockout analyze <level>` · `blockout render <level>` (later) — so
Claude Code can pull grounding without the UI. An MCP server wrapper is a later nice-to-have.

---

## 7. Architecture

**Stack:** SvelteKit (Svelte 5 runes) + TypeScript, `adapter-node`. three.js used directly
(not Threlte) — an editor is heavily imperative (picking, gizmos, tool state machines) and a
thin, explicit engine layer is easier to keep fast and correct. Svelte owns the UI chrome.

Libraries: `three-mesh-bvh` (fast picking, walk-mode collision), `three-bvh-csg` (cut
preview), `earcut` (polygon triangulation), `recast-navigation` (navmesh), `immer` (patches
for undo/redo and diffs), `zod` (schema + generated JSON Schema), `chokidar` (file watch).
Tests: Vitest (model, geometry, physics math, diff) + Playwright (interaction e2e, driving a
`window.__editor` test API).

```
src/lib/
  model/       types, zod schemas, ids, canonical serialize, semantic diff
  doc/         document store, commands, undo/redo (immer patches), selection
  engine/      renderer, scene sync (element id ↔ Object3D), camera controller
               (mouse + trackpad), work plane, picking, snapping, overlays/labels
  tools/       one finite-state machine per tool: select, draw, line, marker, stamp, note, tape
  geometry/    builders per shape kind, hollow rooms, CSG (only for solids touching cuts)
  traversal/   jump math, jump rings, walk controller, analysis worker (navmesh + links + flood)
  io/          client fs API, server-sent events for file changes
  handoff/     brief/changes markdown generation, screenshot capture
  ui/          Toolbar, PenBar, Inspector, Outliner, Versions, CommandPalette, HUD, Settings
src/routes/api/  fs endpoints scoped to the opened root, SSE watch stream
cli/             launcher + headless commands (shares src/lib/model + handoff)
```

Scene sync is keyed by element ID: a doc change produces patches → only touched elements are
rebuilt. CSG is computed only for solids that intersect a cut, debounced, in a worker; while
it's pending the cut shows as a red volume so editing never stalls.

---

## 8. Build phases (each ends usable)

| Phase | Scope | Done when |
|-------|-------|-----------|
| **0. Skeleton** | SvelteKit app, local server, open folder → create/open project + level, autosave, viewport with grid, camera (mouse + trackpad), Plan⇄3D | You can open a folder, see a grid, navigate comfortably with both mouse and trackpad |
| **1. Draw** | Smart pencil (box + polygon + height phase), work plane + surface inference + Q/E, select/move/duplicate/delete, push/pull, snapping, type-to-dimension, undo/redo, depth cues, scale capsule | You can block out a multi-level space with platforms in a couple of minutes without touching a panel |
| **2. Meaning** | Tag library + starter pack, pens, zones (incl. freehand lasso), markers with drag-to-aim + proxies, paths, notes, inspector, outliner, `#` chip, command palette, ramp/stairs/cylinder conversions | A level reads as a meaningful map: trees, paths, chests facing the right way, spawns |
| **3. Cuts & stamps** | Cut role + live CSG, hollow rooms, stamps (make, place face-aligned, edit definition), arrays | Draw a building, stamp doors and windows into it in seconds |
| **4. Versions & handoff** | Named versions, semantic + visual diff, restore/branch, external-change detection, BRIEF/CHANGES/screenshots, AGENTS doc, CLI (brief/diff/validate) | Full round trip with Claude Code on a real level |
| **5. Traversal** | Character profile UI + jump table, jump rings, tape tiers, walk mode, analysis bake + report | You can prove a platforming section works (and see where it's too easy) |
| **6. Polish** | Section view, blobs/terrain mounds, more tag packs, performance pass, rebindable keys, MCP server | — |

MVP for daily use = Phases 0–2 + a minimal "save version" from Phase 4.

---

## 9. Non-goals (on purpose)

No UVs, materials, textures, lighting, bevels, edge loops, per-vertex 3D mesh editing, animation,
scripting/logic graphs, engine plugins, or asset references baked into the format (an asset
hint can be a prop if you want one). If you feel the need for one of these, it should be a tag.

---

## 10. Risks & mitigations

- **3D depth ambiguity** → work plane + surface inference + drop lines + Plan view. Validate
  early with Playwright and by hand in Phase 1 before building more on top.
- **CSG robustness/perf** → compute only for affected solids, in a worker, with fallback display.
  The file stores cuts as cuts; CSG is display-only, so a CSG bug never corrupts data.
- **Trackpad gesture differences** (Chrome `ctrlKey` wheel vs. Safari gesture events) →
  dedicated input normalization layer, tested on both.
- **Navmesh WASM size / edge cases** → lazy-load only when Analyze/Walk is used; jump rings and
  tape work without it.
- **AI not preserving IDs** → the AGENTS doc and every brief state it explicitly; `validate`
  warns when a file written externally drops or rewrites IDs.

---

## 11. Open questions

1. Name? ("Blockout" is a placeholder.)
2. Where should the repo live? (e.g. `~/Documents/Projects/<name>`)
3. Which engines do you mostly target? (Sets the default conversion notes in the brief.)
4. OK to start with Phases 0–2 as the first build, then iterate on feel before going further?
