/** Rendering tiers (art-direction-v3 §4) and the adaptive step-down controller (spec §4, §14.10). */
export type Tier = 'A' | 'B' | 'C';

export interface TierSettings {
  dprCap: number;
  /** MSAA samples for the post target; 0 = render straight to screen with renderer antialias. */
  samples: number;
  bloomLayers: number;
  post: boolean;
  shadows: 'soft' | 'pcf' | 'off';
  shadowMap: number;
  outlines: 'all' | 'landmarks' | 'characters';
  /** v4 detail budget (spec-v4 §15.8). */
  detail: { leaf: number; tufts: number; clouds: number; props: 1 | 2 | 3; ao: boolean };
}

export const TIERS: Record<Tier, TierSettings> = {
  A: { dprCap: 1.65, samples: 4, bloomLayers: 2, post: true, shadows: 'soft', shadowMap: 2048, outlines: 'all', detail: { leaf: 1, tufts: 6000, clouds: 24, props: 3, ao: true } },
  B: { dprCap: 1.3, samples: 2, bloomLayers: 1, post: true, shadows: 'pcf', shadowMap: 1024, outlines: 'landmarks', detail: { leaf: .5, tufts: 2000, clouds: 12, props: 2, ao: false } },
  C: { dprCap: 1.0, samples: 0, bloomLayers: 0, post: false, shadows: 'off', shadowMap: 1024, outlines: 'characters', detail: { leaf: .3, tufts: 0, clouds: 6, props: 1, ao: false } },
};

export function initialTier(): Tier {
  const forced = new URLSearchParams(location.search).get('quality')?.toUpperCase();
  if (forced === 'A' || forced === 'B' || forced === 'C') return forced;
  const coarse = matchMedia('(pointer:coarse)').matches;
  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
  return coarse ? (memory <= 4 ? 'C' : 'B') : 'A';
}

/** Steps down one tier when the median frame time stays above budget; never steps back up (no oscillation).
 * Disabled when a tier is forced with ?quality=. */
export class AdaptiveQuality {
  private samples: number[] = [];
  private since = 0;
  readonly locked = new URLSearchParams(location.search).has('quality');

  constructor(public tier: Tier, private apply: (t: Tier) => void) {}

  frame(dtMs: number, now: number) {
    if (this.locked || this.tier === 'C') return;
    this.samples.push(dtMs);
    if (this.samples.length > 90) this.samples.shift();
    if (now - this.since < 2500 || this.samples.length < 30) return;
    const sorted = [...this.samples].sort((a, b) => a - b), p50 = sorted[sorted.length >> 1];
    if (p50 > 33) {
      this.tier = this.tier === 'A' ? 'B' : 'C';
      this.apply(this.tier);
      this.samples = []; this.since = now;
    }
  }

  /** Called when the frame clock restarts (tab switch, mode change) so a stall is not counted. */
  reset(now: number) { this.samples = []; this.since = now; }
}
