import * as THREE from 'three';
import type { Engine } from '$lib/engine/Engine';
import type { NoteElement } from '$lib/model/types';
import { resolvePlane, snapOnPlane } from './snap';
import { CursorMark } from './cursor';
import type { PEvent, Tool } from './types';

export class NoteTool implements Tool {
  engine: Engine;
  cursor: CursorMark;
  constructor(engine: Engine) {
    this.engine = engine;
    this.cursor = new CursorMark(engine);
  }
  get ed() {
    return this.engine.editor;
  }
  deactivate() {
    this.cursor.update(null, null);
  }
  private at(e: PEvent) {
    const { wp } = resolvePlane(this.engine, e.x, e.y, false);
    const raw = this.engine.planeHit(e.x, e.y, wp.plane);
    if (!raw) return null;
    const p = snapOnPlane(this.engine, wp, raw, e.x, e.y, e.mod).point;
    this.cursor.update(p, wp);
    return p;
  }
  hover(e: PEvent) {
    this.at(e);
    this.engine.invalidate();
  }
  down(e: PEvent) {
    const p = this.at(e);
    if (!p) return;
    const el: NoteElement = {
      id: '',
      type: 'note',
      tags: [],
      role: 'guide',
      transform: { position: [r3(p.x), r3(p.y + 1.6), r3(p.z)], rotation: [0, 0, 0] },
      props: {},
      notes: '',
      precision: 'loose'
    };
    el.id = this.ed.newId(el);
    this.ed.add([el]);
    this.ed.editingNote = el.id;
  }
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;
export { THREE };
