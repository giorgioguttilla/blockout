/** Shared "type a number while dragging" buffer. */
export class TypeBuffer {
  value = '';
  accepts(e: KeyboardEvent, extra = '') {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    return /^[0-9.,\-]$/.test(e.key) || (extra && extra.includes(e.key));
  }
  handle(e: KeyboardEvent, extra = ''): 'typed' | 'enter' | 'none' {
    if (this.value && e.key === 'Backspace') {
      this.value = this.value.slice(0, -1);
      return 'typed';
    }
    if (this.value && e.key === 'Enter') return 'enter';
    if (this.accepts(e, extra)) {
      this.value += e.key;
      return 'typed';
    }
    return 'none';
  }
  numbers(): number[] {
    return this.value
      .split(/[,x×]/)
      .map((s) => parseFloat(s))
      .filter((n) => Number.isFinite(n));
  }
  clear() {
    this.value = '';
  }
}
