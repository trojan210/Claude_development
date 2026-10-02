// Dive site definitions for Bali. Terrain functions return height (m, negative = depth)
// and a 0..1 "rock" factor used for texturing and reef placement.
import { Simplex, smoothstep, clamp } from './noise.js';

const tulambenNoise = new Simplex(1945);
const penidaNoise = new Simplex(2024);

export const SITES = {
  tulamben: {
    id: 'tulamben',
    name: 'トランベン — USAT リバティ号',
    area: 'バリ島 北東部・アメッド近郊',
    blurb: '1942年に被雷し、1963年のアグン山噴火で海岸から滑り落ちた全長120mの輸送船。黒い火山砂の斜面に横たわる船体はソフトコーラルとウミウチワに覆われ、ギンガメアジの群れが渦を巻く。',
    depthRange: '5 – 30 m',
    temp: 28,
    visibility: '20 – 25 m',
    sand: 'volcanic',
    absorb: [0.27, 0.056, 0.024],
    scatter: [0.03, 0.034, 0.04],
    sun: { elevation: 63, azimuth: 35 },
    sky: [0.55, 0.78, 1.0],
    reefDensity: 1.0,
    wreck: { x: 6, z: -4, rotY: 0.08 },
    start: { x: -18, z: -92, y: -2.5, yaw: Math.PI },
    species: ['jack', 'anthias', 'fusilier', 'butterfly', 'parrot', 'turtle', 'surgeon'],
    height(x, z) {
      const n = tulambenNoise;
      const zp = clamp(z + 200, 0, 420);
      let h = -(1.2 + zp * 0.088 + zp * zp * 0.000085);
      h += n.fbm2(x * 0.009, z * 0.009, 3) * 3.2;
      // lava-flow gullies running down-slope
      h += (n.ridged2(x * 0.028, z * 0.006, 3) - 0.5) * 1.8;
      h += n.fbm2(x * 0.12, z * 0.12, 2) * 0.35;
      const bm = smoothstep(0.28, 0.62, n.fbm2(x * 0.035 + 11.3, z * 0.035 - 4.1, 3));
      const bumps = n.fbm2(x * 0.22, z * 0.22, 3) * 0.5 + 0.5;
      h += bm * (1.2 + bumps * 1.6);
      // gentle sand apron around the wreck footprint
      const wx = x - 6, wz = z + 4;
      const wd = Math.hypot(wx / 70, wz / 18);
      h += smoothstep(1.4, 0.6, wd) * 0.9;
      return { h, rock: clamp(bm * 1.2 + smoothstep(0.55, 0.8, bumps) * bm, 0, 1) };
    },
  },
  penida: {
    id: 'penida',
    name: 'ヌサ・ペニダ — マンタポイント',
    area: 'ヌサ・ペニダ島 南岸',
    blurb: '断崖の真下、石灰岩の巨岩が転がる台地はナンヨウマンタのクリーニングステーション。外洋のうねりと栄養豊かな湧昇流が、翼幅4mのマンタを呼び寄せる。',
    depthRange: '8 – 18 m',
    temp: 24,
    visibility: '12 – 18 m',
    sand: 'coral',
    absorb: [0.3, 0.066, 0.038],
    scatter: [0.07, 0.078, 0.082],
    sun: { elevation: 55, azimuth: -20 },
    sky: [0.5, 0.75, 1.0],
    reefDensity: 0.55,
    wreck: null,
    start: { x: 0, z: -125, y: -3, yaw: Math.PI },
    species: ['manta', 'fusilier', 'anthias', 'butterfly', 'surgeon', 'jack'],
    height(x, z) {
      const n = penidaNoise;
      const zp = clamp(z + 200, 0, 420);
      let h = -(3 + 7 * smoothstep(0, 55, zp) + zp * 0.012 + smoothstep(230, 330, zp) * 22);
      h += n.fbm2(x * 0.012, z * 0.012, 3) * 1.8;
      h += n.fbm2(x * 0.1, z * 0.1, 2) * 0.25;
      // limestone boulders fallen from the cliff
      const b = n.noise2(x * 0.05 + 3.3, z * 0.05 + 7.7);
      const boulder = smoothstep(0.35, 0.75, b);
      const rough = n.fbm2(x * 0.3, z * 0.3, 3);
      h += boulder * (3.0 + rough * 0.9);
      // cliff base rubble near shore
      const near = smoothstep(60, 0, zp);
      h += near * (n.fbm2(x * 0.08, z * 0.08, 3) * 0.5 + 0.5) * 3;
      return { h, rock: clamp(boulder * 1.4 + near, 0, 1) };
    },
  },
};
