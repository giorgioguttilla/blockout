import type {
  Character,
  Level,
  LevelElement,
  Project,
  Role,
  StampDef,
  TagDef,
  Vec2,
  Vec3
} from './types';
import { ENGINE_PRESETS } from './engine';

export const DEFAULT_CHARACTER: Character = {
  height: 1.8,
  radius: 0.35,
  stepHeight: 0.35,
  maxSlope: 45,
  walkSpeed: 3.5,
  sprintSpeed: 6,
  jumpHeight: 1.25,
  timeToApex: 0.4,
  coyoteTime: 0.08,
  airControl: 0.6,
  extraJumps: 0,
  dashDistance: 0,
  crouchHeight: 1.0
};

const t = (
  category: TagDef['category'],
  color: string,
  description: string,
  extra: Partial<TagDef> = {}
): TagDef => ({ category, color, description, ...extra });

export const STARTER_TAGS: Record<string, TagDef> = {
  // geometry (solid blockout with meaning)
  wall: t('geometry', '#b8bec8', 'A wall. Final art decides the material.', { defaultRole: 'solid' }),
  floor: t('geometry', '#a9b0ba', 'Walkable floor or ground slab.', { defaultRole: 'solid' }),
  platform: t('geometry', '#c4b8a8', 'A platform the player is meant to stand on or jump to.', { defaultRole: 'solid' }),
  climbable: t('geometry', '#8fb39a', 'Surface the player can climb (ledges, vines, rock wall).', { defaultRole: 'solid' }),
  breakable: t('geometry', '#c98f6b', 'Can be destroyed by the player.', { defaultRole: 'solid' }),
  glass: t('geometry', '#9fd3e6', 'Transparent barrier: blocks movement, not sight.', { defaultRole: 'solid' }),
  cover: t('geometry', '#9aa3ad', 'Waist-high cover for combat.', { defaultRole: 'solid' }),
  building: t('geometry', '#b3a99c', 'A building mass. Interior not playable unless hollow.', { defaultRole: 'solid' }),

  // points
  spawn: t('point', '#4fc3f7', 'Player spawn. Facing = initial look direction.', { defaultRole: 'guide', needsFacing: true, icon: 'spawn', proxy: [0.7, 1.8, 0.7] }),
  checkpoint: t('point', '#81d4fa', 'Respawn / save point.', { defaultRole: 'guide', icon: 'flag', proxy: [0.6, 1.6, 0.6] }),
  goal: t('point', '#ffd54f', 'Level exit / objective.', { defaultRole: 'guide', icon: 'star', proxy: [1, 2, 1] }),
  camera: t('point', '#ce93d8', 'Camera position or shot. Facing = look direction.', { defaultRole: 'guide', needsFacing: true, icon: 'camera', proxy: [0.4, 0.4, 0.6] }),
  light: t('point', '#fff59d', 'Light source (lamp, torch, sun shaft).', { defaultRole: 'guide', icon: 'light', proxy: [0.4, 0.4, 0.4], props: { color: { type: 'string', default: 'warm' } } }),

  // objects
  chest: t('object', '#e0a526', 'Lootable chest. Facing = the side the player opens it from.', {
    defaultRole: 'guide', needsFacing: true, icon: 'chest', proxy: [1.0, 0.7, 0.6],
    props: { contents: { type: 'string' }, locked: { type: 'bool', default: false } }
  }),
  door: t('object', '#a1887f', 'A door the player can open. Facing = opening side.', {
    defaultRole: 'guide', needsFacing: true, icon: 'door', proxy: [1.2, 2.2, 0.15],
    props: { locked: { type: 'bool', default: false }, key: { type: 'string' } }
  }),
  key: t('object', '#ffca28', 'A key / unlock item.', { defaultRole: 'guide', icon: 'key', proxy: [0.3, 0.3, 0.3] }),
  pickup: t('object', '#66bb6a', 'Collectible or consumable pickup.', { defaultRole: 'guide', icon: 'gem', proxy: [0.4, 0.4, 0.4], props: { item: { type: 'string' } } }),
  ladder: t('object', '#bcaaa4', 'Climbable ladder. Facing = side you climb from.', { defaultRole: 'guide', needsFacing: true, icon: 'ladder', proxy: [0.8, 3, 0.2] }),
  lever: t('object', '#90a4ae', 'Interactable switch.', { defaultRole: 'guide', needsFacing: true, icon: 'lever', proxy: [0.4, 1, 0.3], props: { opens: { type: 'string' } } }),
  sign: t('object', '#d7ccc8', 'Readable sign / lore.', { defaultRole: 'guide', needsFacing: true, icon: 'sign', proxy: [0.8, 1.4, 0.15], props: { text: { type: 'string' } } }),
  crate: t('object', '#bf9a6a', 'Crate / prop clutter.', { defaultRole: 'guide', proxy: [1, 1, 1] }),
  tree: t('object', '#43a047', 'A single hero tree.', { defaultRole: 'guide', icon: 'tree', proxy: [1, 6, 1] }),
  'jump-pad': t('object', '#26c6da', 'Launches the player upward.', { defaultRole: 'guide', icon: 'up', proxy: [1.5, 0.2, 1.5], props: { height: { type: 'number', default: 6 } } }),

  // actors
  enemy: t('actor', '#ef5350', 'An enemy. Facing = initial look direction.', {
    defaultRole: 'guide', needsFacing: true, icon: 'enemy', proxy: [0.8, 1.8, 0.8],
    props: { kind: { type: 'string' }, behavior: { type: 'enum', values: ['idle', 'patrol', 'guard', 'ambush'], default: 'idle' } }
  }),
  npc: t('actor', '#7986cb', 'Friendly character.', { defaultRole: 'guide', needsFacing: true, icon: 'npc', proxy: [0.7, 1.8, 0.7], props: { name: { type: 'string' } } }),
  boss: t('actor', '#c62828', 'Boss encounter.', { defaultRole: 'guide', needsFacing: true, icon: 'boss', proxy: [2.5, 4, 2.5] }),

  // zones
  trees: t('zone', '#2e7d32', 'Tree cover. Blocks movement except along paths.', {
    defaultRole: 'zone', props: { density: { type: 'enum', values: ['sparse', 'medium', 'dense'], default: 'medium' } }
  }),
  grass: t('zone', '#7cb342', 'Grass / ground foliage. Walkable.', { defaultRole: 'zone' }),
  rocks: t('zone', '#8d8d8d', 'Scattered rocks and boulders.', { defaultRole: 'zone' }),
  water: t('zone', '#1e88e5', 'Water. Top of the shape = water surface.', { defaultRole: 'zone', props: { swimmable: { type: 'bool', default: true } } }),
  hazard: t('zone', '#ff7043', 'Damages the player (lava, spikes, fire).', { defaultRole: 'zone', props: { damage: { type: 'string', default: 'lethal' } } }),
  trigger: t('zone', '#ab47bc', 'Script trigger volume. Describe what happens in notes.', { defaultRole: 'zone' }),
  'no-go': t('zone', '#e53935', 'Player must not be able to enter. Block it with art.', { defaultRole: 'zone' }),
  encounter: t('zone', '#f4511e', 'Combat encounter space.', { defaultRole: 'zone' }),
  'safe-zone': t('zone', '#26a69a', 'No enemies. Rest area.', { defaultRole: 'zone' }),
  secret: t('zone', '#ec407a', 'Hidden area. Should not be obvious.', { defaultRole: 'zone' }),

  // flow
  'dirt-path': t('flow', '#a1887f', 'Dirt path / trail on the ground.', { defaultRole: 'zone' }),
  road: t('flow', '#78909c', 'Paved road.', { defaultRole: 'zone' }),
  river: t('flow', '#42a5f5', 'Flowing water along the path.', { defaultRole: 'zone' }),
  rail: t('flow', '#b0bec5', 'Grind rail / zipline.', { defaultRole: 'guide' }),
  patrol: t('flow', '#ef9a9a', 'Patrol route for an enemy (name the enemy in notes).', { defaultRole: 'guide' }),
  'critical-path': t('flow', '#ffee58', 'Intended main route through the level.', { defaultRole: 'guide' }),

  // style modifiers (secondary tags)
  ruined: t('style', '#a1887f', 'Broken, crumbling, damaged look.'),
  overgrown: t('style', '#689f38', 'Covered in vegetation.'),
  'use-bevels': t('style', '#b0bec5', 'Use bevelled / softened edges.'),
  landmark: t('style', '#ffd740', 'Must be visible from far away; used for orientation.')
};

export const DEFAULT_PENS = ['@solid', '@cut', 'trees', 'chest', 'enemy', 'water', 'dirt-path', 'spawn', 'hazard', 'platform'];

function el(partial: Partial<LevelElement> & Pick<LevelElement, 'id' | 'type'>): LevelElement {
  return {
    tags: [],
    role: 'solid',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
    props: {},
    notes: '',
    precision: 'exact',
    ...partial
  } as LevelElement;
}

export const STARTER_STAMPS: Record<string, StampDef> = {
  door: {
    name: 'Door',
    description: 'Cuts a 1.2 × 2.2 m opening through the wall and places a door.',
    icon: 'door',
    surface: true,
    elements: [
      el({ id: 'cut', type: 'shape', role: 'cut', shape: { kind: 'box', size: [1.2, 2.2, 1], fit: 'depth' } } as any),
      el({ id: 'door', type: 'marker', role: 'guide', tags: ['door'], marker: { radius: 0 } } as any)
    ]
  },
  doorway: {
    name: 'Doorway',
    description: 'Open 1.6 × 2.6 m passage, no door.',
    icon: 'doorway',
    surface: true,
    elements: [el({ id: 'cut', type: 'shape', role: 'cut', shape: { kind: 'box', size: [1.6, 2.6, 1], fit: 'depth' } } as any)]
  },
  window: {
    name: 'Window',
    description: '1.2 × 1.0 m window opening, sill at 1 m.',
    icon: 'window',
    surface: true,
    elements: [
      el({ id: 'cut', type: 'shape', role: 'cut', transform: { position: [0, 1, 0], rotation: [0, 0, 0] }, shape: { kind: 'box', size: [1.2, 1.0, 1], fit: 'depth' } } as any)
    ]
  },
  arch: {
    name: 'Big opening',
    description: 'Wide 3 × 3 m opening for vehicles or set pieces.',
    icon: 'arch',
    surface: true,
    elements: [el({ id: 'cut', type: 'shape', role: 'cut', shape: { kind: 'box', size: [3, 3, 1], fit: 'depth' } } as any)]
  },
  ladder: {
    name: 'Ladder',
    description: 'A 4 m ladder against the surface.',
    icon: 'ladder',
    surface: true,
    elements: [
      el({ id: 'ladder', type: 'marker', role: 'guide', tags: ['ladder'], props: { height: 4 }, transform: { position: [0, 0, 0.15], rotation: [0, 0, 0] }, marker: { radius: 0 } } as any)
    ]
  },
  'jump-pad': {
    name: 'Jump pad',
    description: 'Launch pad on the floor.',
    icon: 'up',
    surface: false,
    elements: [el({ id: 'pad', type: 'marker', role: 'guide', tags: ['jump-pad'], marker: { radius: 0 } } as any)]
  }
};

export function defaultProject(name = 'My Game'): Project {
  return {
    format: 'blockout/project@1',
    name,
    units: 'm',
    up: '+y',
    handedness: 'right',
    engine: { ...ENGINE_PRESETS.unity },
    grid: { size: 1, subdivisions: 2 },
    defaults: { height: 3, wall: 0.3 },
    character: { ...DEFAULT_CHARACTER },
    pens: [...DEFAULT_PENS],
    tags: structuredClone(STARTER_TAGS),
    stamps: structuredClone(STARTER_STAMPS),
    traversal: { tightMargin: 0.9, trivialMargin: 0.4 }
  };
}

export function emptyLevel(id: string, name: string): Level {
  return {
    format: 'blockout/level@1',
    id,
    name,
    intent: '',
    storeys: [{ id: 'ground', name: 'Ground', y: 0 }],
    elements: []
  };
}

// ---------------------------------------------------------------- demo level

function box(id: string, pos: Vec3, size: Vec3, tags: string[] = [], role: Role = 'solid', extra: Partial<LevelElement> = {}): LevelElement {
  return el({ id, type: 'shape', tags, role, transform: { position: pos, rotation: [0, 0, 0] }, shape: { kind: 'box', size }, ...extra } as any);
}
function poly(id: string, pos: Vec3, points: Vec2[], height: number, tags: string[], role: Role, extra: Partial<LevelElement> = {}): LevelElement {
  return el({ id, type: 'shape', tags, role, transform: { position: pos, rotation: [0, 0, 0] }, shape: { kind: 'extrude', points, height }, precision: role === 'zone' ? 'loose' : 'exact', ...extra } as any);
}
function marker(id: string, pos: Vec3, yaw: number, tags: string[], extra: Partial<LevelElement> = {}): LevelElement {
  return el({ id, type: 'marker', tags, role: 'guide', transform: { position: pos, rotation: [0, yaw, 0] }, marker: { radius: 0 }, ...extra } as any);
}

export function demoLevel(): Level {
  const elements: LevelElement[] = [
    box('ground-01', [0, -1, 0], [60, 1, 60], ['floor'], 'solid', { notes: 'Meadow floor. Gentle, open.', locked: true }),
    marker('spawn-01', [-20, 0, 18], 140, ['spawn'], { notes: 'Player sees the ruined keep straight away.' }),
    poly('trees-01', [-18, 0, -6], [[-8, -10], [6, -12], [10, -2], [4, 8], [-6, 10], [-11, 0]], 0, ['trees'], 'zone', { props: { density: 'dense' } }),
    poly('trees-02', [18, 0, 18], [[-6, -5], [7, -6], [9, 4], [-2, 8], [-8, 3]], 0, ['trees'], 'zone', { props: { density: 'sparse' } }),
    el({
      id: 'dirt-path-01', type: 'path', tags: ['dirt-path'], role: 'zone', precision: 'loose',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
      path: { points: [[-20, 0, 18], [-12, 0, 12], [-6, 0, 10], [0, 0, 6], [4, 0, 2]], width: 2.5, closed: false, smooth: true }
    } as any),
    // keep
    box('building-01', [8, 0, -6], [10, 5, 8], ['building', 'ruined'], 'solid', {
      shape: { kind: 'box', size: [10, 5, 8], hollow: { wall: 0.4, floor: true, ceiling: false } }, notes: 'Ruined keep. Roof collapsed.'
    } as any),
    el({ id: 'door-stamp-01', type: 'stamp', stamp: 'door', tags: [], role: 'solid', depth: 0.4, transform: { position: [8, 0, -2], rotation: [0, 0, 0] } } as any),
    marker('chest-01', [10.5, 0, -8.5], 180, ['chest'], { props: { contents: 'red-key', locked: false } }),
    marker('enemy-01', [6, 0, -7], 0, ['enemy'], { props: { kind: 'skeleton', behavior: 'guard' } }),
    // jumping lesson
    box('platform-01', [-4, 0, -2], [3, 0.6, 3], ['platform']),
    box('platform-02', [-4, 0, -7], [3, 1.4, 3], ['platform'], 'solid', { notes: 'First real jump.' }),
    box('platform-03', [-4, 0, -13], [3, 2.2, 3], ['platform']),
    box('platform-04', [2.6, 0, -15], [3, 3.2, 2], ['platform'], 'solid', { notes: 'Needs a sprint jump. Teaches sprint.' }),
    marker('pickup-01', [2.6, 3.2, -15], 0, ['pickup'], { props: { item: 'gem' } }),
    // pond
    poly('pond-cut-01', [-14, -0.6, -22], [[-5, -3], [4, -4], [7, 1], [2, 5], [-6, 3]], 0.7, [], 'cut'),
    poly('water-01', [-14, -0.6, -22], [[-5, -3], [4, -4], [7, 1], [2, 5], [-6, 3]], 0.45, ['water'], 'zone'),
    marker('goal-01', [8, 0, -12], 0, ['goal'], { notes: 'Exit through the back of the keep.' }),
    el({ id: 'note-01', type: 'note', tags: [], role: 'guide', transform: { position: [-8, 2.5, 4], rotation: [0, 0, 0] }, notes: 'Keep sightlines open to the keep from spawn.' } as any)
  ];
  return {
    format: 'blockout/level@1',
    id: 'demo',
    name: 'Demo: Meadow Keep',
    intent: 'A small tutorial meadow: follow the path, learn to jump on the platforms, sprint-jump for the gem, enter the ruined keep and grab the chest.',
    storeys: [{ id: 'ground', name: 'Ground', y: 0 }],
    elements
  };
}
