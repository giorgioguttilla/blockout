export const AGENTS_DOC = `# Blockout level files — guide for AI agents

This folder holds **semantic level blockouts** made with Blockout. They describe the *intent* of game
levels (layout, scale, what goes where) using cheap primitives + tags. Your job, when asked, is to turn
them into real levels in the game's engine, using the game's own conventions and assets.

## Files
- \`game-settings.md\` — **gameplay numbers** (character height, speeds, jump height, time to apex,
  step height, slope, coyote time, extra jumps, dash; grid) and the **target engine's coordinate convention**
  (name, units per meter, up / forward / right axes, angle units — set \`engine\` to unity, unreal, godot,
  three, blender or roblox for presets, or describe any engine). Plain \`- key: value\` lines.
  **If you are building the game, keep this in sync with the real character controller** — just edit the
  values. Blockout reloads it live and uses it for jump checks, walk mode and briefs.
- \`blockout.project.json\` — tag vocabulary (with descriptions — read them), stamps (templates), pens.
- \`levels/<id>/level.json\` — the working copy of a level.
- \`levels/<id>/versions/NNNN.json\` + \`index.json\` — named snapshots. One may be marked
  \`baseline\`: the version that was last handed off (built).
- \`levels/<id>/handoff/BRIEF.md\` — human/AI readable brief of the level with screenshots.
- \`levels/<id>/handoff/CHANGES.md\` — what changed since the last handoff, by element id.

## Conventions
- Units: meters. Y-up, right-handed (three.js). Rotation: [x, y, z] degrees applied in YXZ order (yaw, then pitch, then roll); most things are pure yaw [0, y, 0].
- Forward of markers/stamps = local +Z. Facing is rotation[1] (yaw).
- Box-like shapes (box, ramp, stairs, cylinder, blob): position = **bottom center**, \`size\` = [x, y, z].
  Ramps and stairs rise toward local +Z.
- \`extrude\` shapes: \`points\` = footprint polygon in local XZ, extruded up by \`height\`.
- \`prism\` shapes: regular polygon with \`sides\` corners at \`radius\` (to the corners; inner radius =
  radius·cos(π/sides)), first corner on local +X, extruded up by \`height\`. \`smooth: true\` = round (cylinder/cone).
- \`taper\` (box, extrude, prism): the top is scaled by this factor about the footprint center. 1 = straight,
  0 = comes to a point (pyramid / cone), in between = frustum.
- Ramps and stairs: \`size\` = [width, rise, run]; they go up toward local +Z. Briefs say whether the character
  can walk them (slope vs max slope, step height vs step limit).
  \`infinite: true\` zones extend upward without limit. A zone with height 0 is a flat area on the ground.
- \`hollow\` shapes are rooms: walls of thickness \`wall\` around the footprint, optional floor/ceiling.
- Paths: \`points\` are relative to transform.position; \`width\` in meters.
- Markers: \`radius\` > 0 means it also covers a circular area.
- Stamps: \`stamp\` names a template in the project; its parts are listed in the brief.

## Roles
- **solid** — blockout geometry. Replace with real art at the same scale and collision.
- **cut** — subtract from overlapping solids (doorways, windows, holes, tunnels).
- **zone** — non-physical area/volume. Its tags say what goes there (trees, water, hazard…).
- **guide** — points/lines with meaning: spawns, objects, actors, routes.

## Rules
1. **Keep element ids** (\`chest-01\`, \`platform-03\`) as object names or metadata in the engine scene,
   so later change lists can target them.
2. \`precision: "exact"\` → keep position and size within ~0.1 m (gameplay depends on it).
   \`"loose"\` → match the spirit; you have creative freedom.
3. Tags are the instructions. Read the tag description in the project file. Free-text \`notes\` on
   elements carry the designer's intent — follow them.
4. When editing these JSON files yourself, preserve ids, keep the format, and only change what you
   were asked to. The editor watches the files and shows the designer a diff.
`;
