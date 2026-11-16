import { describe, expect, it } from 'vitest';
import { demoLevel, defaultProject } from '../src/lib/model/defaults';
import { normalizeLevel, stringifyLevel } from '../src/lib/model/serialize';
import { diffLevels } from '../src/lib/model/diff';
import { classify, reach } from '../src/lib/model/physics';
import { applySettingsDoc, updateSettingsDoc } from '../src/lib/model/settingsDoc';
import { nextId } from '../src/lib/model/ids';
import { normalizeProject } from '../src/lib/model/serialize';
import { ENGINE_PRESETS, engineYaw, handedness, toEnginePos, toEngineSize } from '../src/lib/model/engine';

describe('serialization', () => {
  it('round-trips the demo level canonically', () => {
    const a = stringifyLevel(demoLevel());
    const b = stringifyLevel(normalizeLevel(JSON.parse(a), 'demo'));
    expect(b).toBe(a);
  });
  it('fills in missing fields from hand/AI-written json', () => {
    const l = normalizeLevel({ elements: [{ id: 'x', type: 'marker', tags: ['chest'], position: [1, 2, 3] }] }, 'lvl');
    expect(l.elements[0].transform.position).toEqual([1, 2, 3]);
    expect(l.elements[0].role).toBe('guide');
  });
});

describe('diff', () => {
  it('reports moves, prop changes, adds and removes by id', () => {
    const a = demoLevel();
    const b = structuredClone(a);
    const chest = b.elements.find((e) => e.id === 'chest-01')!;
    chest.transform.position = [10.5, 0, -4.5];
    chest.props.contents = 'gold';
    b.elements = b.elements.filter((e) => e.id !== 'note-01');
    const d = diffLevels(a, b);
    expect(d.removed.map((e) => e.id)).toEqual(['note-01']);
    expect(d.modified[0].id).toBe('chest-01');
    expect(d.modified[0].changes.join(' ')).toMatch(/moved 4 m/);
    expect(d.modified[0].changes.join(' ')).toMatch(/contents/);
  });
});

describe('physics', () => {
  const c = defaultProject().character;
  it('classifies gaps by movement tier', () => {
    expect(classify(c, 0, 0.2).tier).toBe('walk');
    expect(classify(c, 2, 0).tier).toBe('walk-jump');
    expect(classify(c, 5, 0).tier).toBe('sprint-jump');
    expect(classify(c, 20, 0).tier).toBe('impossible');
    expect(classify(c, 1, c.jumpHeight + 0.5).tier).toBe('impossible');
  });
  it('reaches further when dropping down', () => {
    expect(reach(c, -2, c.walkSpeed)).toBeGreaterThan(reach(c, 0, c.walkSpeed));
  });
});

describe('game-settings.md', () => {
  it('reads values and writes back in place, keeping prose', () => {
    const p = defaultProject();
    let md = updateSettingsDoc(null, p);
    md = md.replace('- jump height: 1.25', '- jump height: 2') + '\nAgent note: keep me.\n';
    const q = defaultProject();
    applySettingsDoc(q, md);
    expect(q.character.jumpHeight).toBe(2);
    q.character.walkSpeed = 5;
    const out = updateSettingsDoc(md, q);
    expect(out).toContain('Agent note: keep me.');
    expect(out).toMatch(/- walk speed: 5\b/);
    expect(out).toMatch(/- jump height: 2\b/);
  });
  it('tolerates loose formatting', () => {
    const p = defaultProject();
    applySettingsDoc(p, '* Sprint Speed : 9 m/s\nTarget engine: Godot\ntight jump: 85%');
    expect(p.character.sprintSpeed).toBe(9);
    expect(p.engine.name).toBe('Godot');
    expect(p.engine.forward).toBe('-z');
    expect(p.traversal.tightMargin).toBeCloseTo(0.85);
  });
});

describe('ids', () => {
  it('picks the next free readable id', () => {
    expect(nextId(['chest-01', 'chest-02', 'enemy-01'], 'chest')).toBe('chest-03');
    expect(nextId([], 'platform')).toBe('platform-01');
  });
});

describe('engine conventions', () => {
  const { unity, unreal, godot, three, blender } = ENGINE_PRESETS;
  it('derives handedness from the axes', () => {
    expect(handedness(unity)).toBe('left');
    expect(handedness(unreal)).toBe('left');
    expect(handedness(godot)).toBe('right');
    expect(handedness(three)).toBe('right');
    expect(handedness(blender)).toBe('right');
  });
  it('converts positions and sizes', () => {
    expect(toEnginePos(unity, [1, 2, 3])).toEqual([-1, 2, 3]);
    expect(toEnginePos(unreal, [1, 2, 3])).toEqual([300, -100, 200]);
    expect(toEnginePos(godot, [1, 2, 3])).toEqual([-1, 2, -3]);
    expect(toEnginePos(three, [1, 2, 3])).toEqual([1, 2, 3]);
    expect(toEngineSize(unreal, [2, 3, 4])).toEqual([400, 200, 300]);
  });
  it('converts facing into each engine\'s yaw', () => {
    // Blockout +x is the character's left; each engine must end up pointing the same physical way
    expect(engineYaw(unity, [1, 0, 0])).toBeCloseTo(-90); // Unity yaw -90 faces -x (= Blockout +x)
    expect(engineYaw(unreal, [1, 0, 0])).toBeCloseTo(-90); // UE yaw -90 faces -y (= Blockout +x)
    expect(engineYaw(godot, [1, 0, 0])).toBeCloseTo(90); // Godot +90 turns -z forward to -x (= Blockout +x)
    expect(engineYaw(three, [1, 0, 0])).toBeCloseTo(90);
    expect(engineYaw({ ...godot, angles: 'radians' }, [1, 0, 0])).toBeCloseTo(Math.PI / 2);
  });
  it('migrates projects that only stored an engine name', () => {
    const p = normalizeProject({ name: 'x', targetEngine: 'unreal' });
    expect(p.engine.unitsPerMeter).toBe(100);
    expect((p as any).targetEngine).toBeUndefined();
  });
  it('treats axis lines left over from another preset as stale', () => {
    const p = defaultProject(); // unity
    const md = updateSettingsDoc(null, p).replace('- engine: Unity', '- engine: unreal');
    applySettingsDoc(p, md);
    expect(p.engine.name).toBe('Unreal');
    expect(p.engine.up).toBe('+z');
  });
  it('accepts any custom engine and rejects impossible axes', () => {
    const p = defaultProject();
    applySettingsDoc(p, '- engine: Kiln\n- units per meter: 64\n- up axis: +z\n- forward axis: +y\n- right axis: +x');
    expect(p.engine).toMatchObject({ name: 'Kiln', unitsPerMeter: 64, up: '+z', forward: '+y', right: '+x' });
    expect(handedness(p.engine)).toBe('right');
    const w = applySettingsDoc(p, '- up axis: +z\n- forward axis: -z');
    expect(w.length).toBeGreaterThan(0);
    expect(p.engine.forward).toBe('+y');
  });
  it('upgrades an old settings doc in place', () => {
    const old = '# Game settings\n\n## World\n- target engine: godot   # old line\n- grid size: 1\n\nAgent note.\n';
    const p = defaultProject();
    applySettingsDoc(p, old);
    expect(p.engine.name).toBe('Godot');
    const out = updateSettingsDoc(old, p);
    expect(out).toContain('Agent note.');
    expect(out).toMatch(/- engine: Godot   # unity \| unreal[^\n]*\n- units per meter: 1/);
    expect(out).toMatch(/- forward axis: -z/);
  });
});
