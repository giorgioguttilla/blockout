import type { Engine } from '$lib/engine/Engine';

export interface PEvent {
  x: number;
  y: number;
  shift: boolean;
  alt: boolean;
  /** Cmd (mac) / Ctrl: disables snapping */
  mod: boolean;
  native: PointerEvent | MouseEvent;
}

export interface Tool {
  activate?(): void;
  deactivate?(): void;
  down?(e: PEvent): void;
  move?(e: PEvent): void;
  up?(e: PEvent): void;
  hover?(e: PEvent): void;
  dblclick?(e: PEvent): void;
  leave?(): void;
  /** return true if the key was consumed */
  key?(e: KeyboardEvent): boolean;
  /** Esc: return true if something was cancelled */
  cancel?(): boolean;
  onLevelChanged?(): void;
  busy?(): boolean;
}

export type ToolCtor = new (engine: Engine) => Tool;
