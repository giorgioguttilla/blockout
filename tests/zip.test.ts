import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zip } from '../src/lib/store/zip';

describe('zip', () => {
  it('produces an archive unzip accepts', async () => {
    const blob = zip([
      { name: 'levels/demo/handoff/BRIEF.md', data: '# Brief\n' },
      { name: 'levels/demo/handoff/top.png', data: new Uint8Array([137, 80, 78, 71, 1, 2, 3]) }
    ]);
    const f = path.join(os.tmpdir(), `blockout-test-${Date.now()}.zip`);
    fs.writeFileSync(f, Buffer.from(await blob.arrayBuffer()));
    const out = execFileSync('unzip', ['-t', f]).toString();
    expect(out).toMatch(/No errors detected/);
    expect(execFileSync('unzip', ['-p', f, 'levels/demo/handoff/BRIEF.md']).toString()).toBe('# Brief\n');
    fs.unlinkSync(f);
  });
});
