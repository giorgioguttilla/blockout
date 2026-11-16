import { editor, DRAW_SHAPES } from './editor.svelte';
import * as A from './actions';
import { isTyping } from '$lib/engine/Engine';

export function handleKey(e: KeyboardEvent) {
  if (editor.walking) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key;

  // palette works everywhere
  if (mod && k.toLowerCase() === 'k') {
    e.preventDefault();
    editor.openModal(editor.modal === 'palette' ? null : 'palette');
    return;
  }
  if (editor.modal) {
    if (k === 'Escape') {
      editor.openModal(null);
      e.preventDefault();
    }
    return;
  }
  if (isTyping(e)) return;
  const eng = editor.engine;
  if (!eng) return;

  // the active tool gets first dibs
  if (k === 'Escape') {
    if (eng.tools.cancel()) return e.preventDefault();
    if (editor.compare) {
      editor.compare = null;
      eng.syncCompare();
      eng.refreshHighlights();
      return;
    }
    if (editor.inlineTag) {
      editor.inlineTag = null;
      return;
    }
    if (editor.selection.length) {
      editor.selection = [];
      eng.refreshHighlights();
      return;
    }
    if (editor.tool !== 'select') A.setTool('select');
    return;
  }
  if (!mod && eng.tools.key(e)) return e.preventDefault();

  if (mod) {
    const l = k.toLowerCase();
    if (l === 'z') {
      e.preventDefault();
      if (e.shiftKey) editor.redo();
      else editor.undo();
    } else if (l === 'y') {
      e.preventDefault();
      editor.redo();
    } else if (l === 'd') {
      e.preventDefault();
      A.duplicate();
    } else if (l === 'c') {
      A.copy();
    } else if (l === 'v') {
      A.paste();
    } else if (l === 'a') {
      e.preventDefault();
      A.selectAll();
    } else if (l === 'g') {
      e.preventDefault();
      A.groupSelection();
    } else if (l === 's') {
      e.preventDefault();
      editor.openModal('save-version');
    } else if (l === 'enter') {
      e.preventDefault();
      A.startWalk();
    }
    return;
  }
  if (e.altKey) return;

  // pens
  if (/^Digit[0-9]$/.test(e.code)) {
    const i = Number(e.code.slice(5));
    if (e.shiftKey) editor.applyPenToSelection(i);
    else editor.selectPen(i);
    e.preventDefault();
    return;
  }

  const tools = A.toolKeyMap();
  const low = k.toLowerCase();
  if (!e.shiftKey && low === 'd' && editor.tool === 'draw') {
    const order = DRAW_SHAPES.map((d) => d.key);
    editor.drawShape = order[(order.indexOf(editor.drawShape) + 1) % order.length];
    editor.engine?.tools.rehover();
    return;
  }
  if (!e.shiftKey && tools[low]) {
    A.setTool(tools[low]);
    return;
  }
  switch (k) {
    case 'Tab':
      e.preventDefault();
      A.toggleView();
      return;
    case 'q':
    case 'Q':
      A.shiftPlane(-1, e.shiftKey);
      return;
    case 'e':
    case 'E':
      A.shiftPlane(1, e.shiftKey);
      return;
    case 'f':
      eng.frameSelection();
      return;
    case 'F':
      eng.frameAll();
      return;
    case 'g':
      A.startWalk();
      return;
    case 'j':
      editor.jumpRings = !editor.jumpRings;
      editor.toast(editor.jumpRings ? 'Jump rings on — they follow your cursor' : 'Jump rings off', 'info');
      eng.tools.rehover();
      return;
    case 'x':
      editor.section = !editor.section;
      editor.toast(editor.section ? `Section view: hiding everything above ${(editor.planeY + 2.2).toFixed(1)} m` : 'Section view off', 'info');
      eng.invalidate();
      return;
    case 'H':
      A.hideSelection();
      return;
    case '`':
      editor.showScale = !editor.showScale;
      eng.tools.rehover();
      return;
    case '#':
      if (editor.selection.length) {
        const id = editor.selection[0];
        editor.inlineTag = { id, x: eng.width / 2, y: eng.height / 2, open: true } as any;
      }
      e.preventDefault();
      return;
    case 'Enter':
      if (editor.selection.length) {
        const el = editor.get(editor.selection[0]);
        if (el?.type === 'note') editor.editingNote = el.id;
        else editor.focusNotes++;
        e.preventDefault();
      }
      return;
    case 'a':
      A.toggleAnalysis();
      return;
    case '?':
      editor.openModal('help');
      return;
    case '\\':
      editor.leftPanel = editor.rightPanel = !(editor.leftPanel || editor.rightPanel);
      return;
    case 'Delete':
    case 'Backspace':
      if (editor.selection.length) editor.remove(editor.selection);
      return;
  }
}
