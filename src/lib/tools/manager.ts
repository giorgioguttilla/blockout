import type { Engine } from '$lib/engine/Engine';
import type { ToolName } from '$lib/editor/editor.svelte';
import { TOOL_INFO } from '$lib/editor/editor.svelte';
import type { PEvent, Tool } from './types';
import { DrawTool } from './draw';
import { SelectTool } from './select';
import { LineTool } from './line';
import { MarkerTool } from './marker';
import { StampTool } from './stamp';
import { NoteTool } from './note';
import { TapeTool } from './tape';

export class ToolManager {
  engine: Engine;
  tools: Record<ToolName, Tool>;
  active: Tool | null = null;
  name: ToolName | null = null;
  private last: PEvent | null = null;

  constructor(engine: Engine) {
    this.engine = engine;
    this.tools = {
      select: new SelectTool(engine),
      draw: new DrawTool(engine),
      line: new LineTool(engine),
      marker: new MarkerTool(engine),
      stamp: new StampTool(engine),
      note: new NoteTool(engine),
      tape: new TapeTool(engine)
    };
  }

  activate(name: ToolName) {
    if (this.name === name) return;
    this.active?.cancel?.();
    this.active?.deactivate?.();
    this.engine.updateCursor(null);
    this.engine.editor.hud = null;
    this.name = name;
    this.active = this.tools[name];
    this.engine.editor.hint = TOOL_INFO[name].hint;
    this.active.activate?.();
    this.engine.container?.setAttribute('data-tool', name);
    if (this.last) this.active.hover?.(this.last);
    this.engine.invalidate();
  }

  private ev(e: PointerEvent | MouseEvent, x: number, y: number): PEvent {
    return { x, y, shift: e.shiftKey, alt: e.altKey, mod: e.metaKey || e.ctrlKey, native: e };
  }

  pointer(kind: 'down' | 'move' | 'up' | 'hover', e: PointerEvent, x: number, y: number) {
    const ev = this.ev(e, x, y);
    this.last = ev;
    const t = this.active;
    if (!t) return;
    if (kind === 'down') t.down?.(ev);
    else if (kind === 'move') (t.move ?? t.hover)?.call(t, ev);
    else if (kind === 'up') t.up?.(ev);
    else t.hover?.(ev);
  }
  dblclick(e: MouseEvent, x: number, y: number) {
    this.active?.dblclick?.(this.ev(e, x, y));
  }
  leave() {
    this.active?.leave?.();
    this.engine.updateCursor(null);
  }
  key(e: KeyboardEvent) {
    const handled = this.active?.key?.(e) ?? false;
    if (handled) this.engine.invalidate();
    return handled;
  }
  cancel() {
    return this.active?.cancel?.() ?? false;
  }
  busy() {
    return this.active?.busy?.() ?? false;
  }
  onLevelChanged() {
    this.active?.onLevelChanged?.();
  }
  /** re-run hover with the last pointer position (after plane/snap changes) */
  rehover() {
    if (this.last) this.active?.hover?.(this.last);
  }
}
