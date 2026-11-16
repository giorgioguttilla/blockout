// Blockout data model. Units: meters. Y-up, right-handed (three.js convention).
// Rotations are Euler angles [x, y, z] in degrees, applied in YXZ order (yaw about Y, then pitch about X, then roll about Z). "Forward" for a marker/stamp is local +Z.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export type Role = 'solid' | 'cut' | 'zone' | 'guide';
export type ElementType = 'shape' | 'path' | 'marker' | 'stamp' | 'note';
export type Precision = 'exact' | 'loose';
export type PropValue = string | number | boolean;

export interface Transform {
  position: Vec3;
  rotation: Vec3;
}

export type ShapeKind = 'box' | 'extrude' | 'prism' | 'cylinder' | 'ramp' | 'stairs' | 'blob';

export interface Hollow {
  wall: number;
  floor: boolean;
  ceiling: boolean;
}

export interface ShapeData {
  kind: ShapeKind;
  /** box / cylinder / ramp / stairs / blob: local size. Origin is the bottom center. Ramps & stairs rise toward local +Z. */
  size?: Vec3;
  /** extrude: footprint polygon in local XZ (counter-clockwise or clockwise, both fine) */
  points?: Vec2[];
  /** extrude / prism: height along local +Y */
  height?: number;
  /** prism: regular polygon with `sides` corners at distance `radius` (to the corners); first corner on local +X */
  radius?: number;
  /** prism: render as a smooth circle (cylinder / cone) instead of a polygon */
  smooth?: boolean;
  /** box / extrude / prism: top scale relative to the bottom, about the footprint center. 1 = straight, 0 = point (cone / pyramid) */
  taper?: number;
  /** zones only: extend infinitely along local +Y */
  infinite?: boolean;
  sides?: number;
  steps?: number;
  hollow?: Hollow | null;
  /** inside stamps only: this cut stretches through the wall it is placed on */
  fit?: 'depth';
}

export interface PathData {
  /** points relative to transform.position */
  points: Vec3[];
  width: number;
  closed: boolean;
  smooth: boolean;
}

export interface MarkerData {
  radius: number;
}

export interface BaseElement {
  id: string;
  type: ElementType;
  name?: string;
  tags: string[];
  role: Role;
  transform: Transform;
  props: Record<string, PropValue>;
  notes: string;
  precision: Precision;
  storey?: string;
  group?: string;
  hidden?: boolean;
  locked?: boolean;
}

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shape: ShapeData;
}
export interface PathElement extends BaseElement {
  type: 'path';
  path: PathData;
}
export interface MarkerElement extends BaseElement {
  type: 'marker';
  marker: MarkerData;
}
export interface StampElement extends BaseElement {
  type: 'stamp';
  stamp: string;
  /** thickness of the surface it was placed on (for cuts that go through walls) */
  depth?: number;
}
export interface NoteElement extends BaseElement {
  type: 'note';
}

export type LevelElement = ShapeElement | PathElement | MarkerElement | StampElement | NoteElement;

export type TagCategory = 'geometry' | 'object' | 'actor' | 'point' | 'zone' | 'flow' | 'style';

export interface PropDef {
  type: 'string' | 'number' | 'bool' | 'enum';
  values?: string[];
  default?: PropValue;
  description?: string;
}

export interface TagDef {
  category: TagCategory;
  description: string;
  color: string;
  icon?: string;
  /** markers render as a box of this size [x, y, z] */
  proxy?: Vec3;
  defaultRole?: Role;
  needsFacing?: boolean;
  props?: Record<string, PropDef>;
}

export interface StampDef {
  name: string;
  description: string;
  icon?: string;
  /** align to the surface it is placed on (doors, windows) */
  surface: boolean;
  /** elements in stamp-local space; local +Z points out of the surface */
  elements: LevelElement[];
}

export interface Character {
  height: number;
  radius: number;
  stepHeight: number;
  maxSlope: number;
  walkSpeed: number;
  sprintSpeed: number;
  jumpHeight: number;
  timeToApex: number;
  coyoteTime: number;
  airControl: number;
  extraJumps: number;
  dashDistance: number;
  crouchHeight: number;
}

import type { EngineConvention } from './engine';
export type { EngineConvention };

export interface Project {
  format: 'blockout/project@1';
  name: string;
  units: 'm';
  up: '+y';
  handedness: 'right';
  /** coordinate convention of the engine the level will be built in */
  engine: EngineConvention;
  grid: { size: number; subdivisions: number };
  defaults: { height: number; wall: number };
  character: Character;
  /** pen slots 0–9: '@solid', '@cut' or a tag name */
  pens: string[];
  tags: Record<string, TagDef>;
  stamps: Record<string, StampDef>;
  traversal: { tightMargin: number; trivialMargin: number };
  /** name of the markdown settings doc (game-settings.md) */
  settings?: string;
  /** problems found while reading game-settings.md (not saved) */
  settingsWarnings?: string[];
}

export interface Storey {
  id: string;
  name: string;
  y: number;
}

export interface Level {
  format: 'blockout/level@1';
  id: string;
  name: string;
  intent: string;
  storeys: Storey[];
  elements: LevelElement[];
}

export interface VersionInfo {
  n: number;
  message: string;
  time: string;
  handoff?: boolean;
  baseline?: boolean;
}

export interface LevelSummary {
  id: string;
  name: string;
  modified: string;
  versions: number;
}
