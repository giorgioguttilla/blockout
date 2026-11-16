import type { Character } from './types';

export type Tier = 'walk' | 'walk-jump' | 'sprint-jump' | 'extra-jump' | 'dash' | 'drop' | 'impossible';

export const TIER_COLORS: Record<Tier, string> = {
  walk: '#4caf50',
  'walk-jump': '#c0ca33',
  'sprint-jump': '#ffa726',
  'extra-jump': '#ab47bc',
  dash: '#29b6f6',
  drop: '#8d6e63',
  impossible: '#e53935'
};

export const TIER_LABEL: Record<Tier, string> = {
  walk: 'Walk',
  'walk-jump': 'Jump',
  'sprint-jump': 'Sprint jump',
  'extra-jump': 'Double jump',
  dash: 'Dash',
  drop: 'Drop down (one-way)',
  impossible: 'Not reachable'
};

export const TIER_ORDER: Tier[] = ['walk', 'walk-jump', 'sprint-jump', 'extra-jump', 'dash'];

export function derive(c: Character) {
  const g = (2 * c.jumpHeight) / (c.timeToApex * c.timeToApex);
  const v0 = (2 * c.jumpHeight) / c.timeToApex;
  return { g, v0, maxJump: c.jumpHeight * (1 + c.extraJumps) };
}

/** time in the air for a jump that lands dh meters above the launch point, using `jumps` jumps chained at the apex */
export function airtime(c: Character, dh: number, jumps = 1): number {
  const { g } = derive(c);
  const peak = c.jumpHeight * jumps;
  if (dh > peak + 1e-6) return NaN;
  const up = c.timeToApex * jumps;
  const down = Math.sqrt((2 * Math.max(0, peak - dh)) / g);
  return up + down;
}

/** max horizontal edge-to-edge gap for a jump with height difference dh */
export function reach(c: Character, dh: number, speed: number, jumps = 1, dash = 0): number {
  const t = airtime(c, dh, jumps);
  if (!Number.isFinite(t)) return 0;
  return speed * (t + c.coyoteTime) + 2 * c.radius + dash;
}

export interface Classification {
  tier: Tier;
  reach: number;
  margin: number; // gap / reach for that tier (0..1)
}

export function classify(c: Character, gap: number, dh: number): Classification {
  gap = Math.max(0, gap);
  if (gap <= 0.15 && Math.abs(dh) <= c.stepHeight) return { tier: 'walk', reach: 0, margin: 0 };
  if (gap <= 0.15 && dh < 0) return { tier: 'drop', reach: 0, margin: 0 };
  const options: [Tier, number][] = [
    ['walk-jump', reach(c, dh, c.walkSpeed)],
    ['sprint-jump', reach(c, dh, c.sprintSpeed)]
  ];
  if (c.extraJumps > 0) options.push(['extra-jump', reach(c, dh, c.sprintSpeed, 1 + c.extraJumps)]);
  if (c.dashDistance > 0) options.push(['dash', reach(c, dh, c.sprintSpeed, 1 + c.extraJumps, c.dashDistance)]);
  for (const [tier, r] of options) {
    if (r > 0 && gap <= r) return { tier, reach: r, margin: gap / r };
  }
  return { tier: 'impossible', reach: options[options.length - 1][1], margin: Infinity };
}

export function tierRank(t: Tier) {
  const i = TIER_ORDER.indexOf(t);
  return i < 0 ? (t === 'drop' ? 0 : 99) : i;
}

export function jumpTable(c: Character) {
  const dhs = [-3, -1, 0, 0.5, 1, c.jumpHeight];
  return dhs.map((dh) => ({
    dh,
    walk: reach(c, dh, c.walkSpeed),
    sprint: reach(c, dh, c.sprintSpeed),
    extra: c.extraJumps > 0 ? reach(c, dh, c.sprintSpeed, 1 + c.extraJumps) : null
  }));
}
