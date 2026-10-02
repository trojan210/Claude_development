// Bühlmann ZHL-16C nitrogen model with gradient factors — the same family of algorithm
// used by real dive computers. Breathing gas: air.
const HT = [5.0, 8.0, 12.5, 18.5, 27.0, 38.3, 54.3, 77.0, 109.0, 146.0, 187.0, 239.0, 305.0, 390.0, 498.0, 635.0];
const A = [1.1696, 1.0, 0.8618, 0.7562, 0.62, 0.5043, 0.441, 0.4, 0.375, 0.35, 0.3295, 0.3065, 0.2835, 0.261, 0.248, 0.2327];
const B = [0.5578, 0.6514, 0.7222, 0.7825, 0.8126, 0.8434, 0.8693, 0.891, 0.9092, 0.9222, 0.9319, 0.9403, 0.9477, 0.9544, 0.9602, 0.9653];
const FN2 = 0.79;
const PWV = 0.0627;
export const P_SURF = 1.013;

export const ambient = (depth) => P_SURF + Math.max(0, depth) / 10.0;

export class Deco {
  constructor(gfLow = 0.4, gfHigh = 0.85) {
    this.gfLow = gfLow;
    this.gfHigh = gfHigh;
    this.p = HT.map(() => FN2 * (P_SURF - PWV));
  }

  step(depth, dt) {
    const palv = FN2 * (ambient(depth) - PWV);
    for (let i = 0; i < 16; i++) {
      const k = 1 - Math.pow(2, -dt / 60 / HT[i]);
      this.p[i] += (palv - this.p[i]) * k;
    }
  }

  // tolerated ambient pressure for tissue loads p at gradient factor gf
  static ceilingPressure(p, gf) {
    let max = 0;
    for (let i = 0; i < 16; i++) {
      const tol = (p[i] - A[i] * gf) / (gf / B[i] + 1 - gf);
      if (tol > max) max = tol;
    }
    return max;
  }

  ceiling() {
    const pc = Deco.ceilingPressure(this.p, this.gfHigh);
    return Math.max(0, (pc - P_SURF) * 10);
  }

  /** No-decompression limit in minutes at the given depth (99 = more than enough). */
  ndl(depth) {
    if (this.ceiling() > 0) return 0;
    const palv = FN2 * (ambient(depth) - PWV);
    const p = this.p.slice();
    for (let m = 1; m <= 99; m++) {
      for (let i = 0; i < 16; i++) p[i] += (palv - p[i]) * (1 - Math.pow(2, -1 / HT[i]));
      if (Deco.ceilingPressure(p, this.gfHigh) > P_SURF) return m - 1;
    }
    return 99;
  }

  /** Highest tissue saturation relative to its surfacing M-value (0..1+) for the tissue bar graph. */
  loading() {
    let max = 0;
    for (let i = 0; i < 16; i++) {
      const m = P_SURF / B[i] + A[i];
      max = Math.max(max, (this.p[i] - FN2 * (P_SURF - PWV)) / (m - FN2 * (P_SURF - PWV)));
    }
    return Math.max(0, max);
  }
}
