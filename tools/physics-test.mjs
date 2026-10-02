// Headless sanity checks for the diver physics / buoyancy / gas / deco model.
import * as THREE from 'three';
import { Diver } from '../src/diver.js';
import { Deco } from '../src/deco.js';

const site = { start: { x: 0, y: -5, z: 0, yaw: 0 }, temp: 28 };
const world = {
  terrain: { heightAt: () => -40 },
  wreck: null, current: new THREE.Vector2(), limit: 1000,
  silt() {}, colliders: () => [],
};
const keys = {};
const input = { axis: () => ({ forward: 0, strafe: 0, fast: false, up: false, down: false, inflate: false, deflate: false, inhale: false, exhale: false, ...keys }), consumeLook: () => ({ x: 0, y: 0 }) };
const run = (d, sec) => { for (let t = 0; t < sec; t += 1 / 60) d.update(1 / 60, input, world); };
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// 1. real mode: neutral-ish at the start depth (lungs oscillate, slight drift allowed)
let d = new Diver(site, new THREE.PerspectiveCamera(), { mode: 'real' });
run(d, 20);
ok(Math.abs(d.depth - 5) < 2.5, `real mode hovers near start depth (5m -> ${d.depth.toFixed(2)}m)`);
// 2. deflating sinks, and sinking accelerates as the suit compresses (Boyle)
keys.deflate = true; run(d, 3); keys.deflate = false;
const d0 = d.depth; run(d, 20);
ok(d.depth > d0 + 1, `deflated diver sinks (${d0.toFixed(1)} -> ${d.depth.toFixed(1)} m)`);
// 3. inflating at depth makes the diver rise
keys.inflate = true; run(d, 4); keys.inflate = false;
const d1 = d.depth; run(d, 15);
ok(d.depth < d1, `inflated diver ascends (${d1.toFixed(1)} -> ${d.depth.toFixed(1)} m)`);
// 4. kicking: cruise speed in a realistic range
d = new Diver(site, new THREE.PerspectiveCamera(), { mode: 'easy' });
keys.forward = 1; run(d, 15);
const hs = Math.hypot(d.vel.x, d.vel.z);
ok(hs > 0.6 && hs < 1.4, `cruise speed ${hs.toFixed(2)} m/s`);
keys.fast = true; run(d, 10);
const hf = Math.hypot(d.vel.x, d.vel.z);
ok(hf > hs && hf < 2.0, `fast kick speed ${hf.toFixed(2)} m/s`);
keys.forward = 0; keys.fast = false;
// 5. easy mode stays neutral without input
const e0 = d.depth; run(d, 20);
ok(Math.abs(d.depth - e0) < 1.0, `easy mode holds depth (${e0.toFixed(1)} -> ${d.depth.toFixed(1)} m)`);
// 6. gas: ~45 min at 18 m from 200 bar with a 11.1 L tank and SAC 14 L/min should be plausible
d = new Diver({ ...site, start: { ...site.start, y: -18 } }, new THREE.PerspectiveCamera(), { mode: 'easy' });
run(d, 600);
const used = 200 - d.pressure;
ok(used > 25 && used < 45, `10 min at 18 m uses ${used.toFixed(1)} bar`);
// 7. deco: NDL at 30 m from a fresh state should be ~13-20 min (air, GF 85)
const deco = new Deco();
const ndl30 = deco.ndl(30);
ok(ndl30 >= 12 && ndl30 <= 22, `NDL at 30 m = ${ndl30} min`);
const ndl18 = new Deco().ndl(18);
ok(ndl18 >= 38 && ndl18 <= 60, `NDL at 18 m = ${ndl18} min`);
