// The diver: fin propulsion, hydrodynamic drag, buoyancy (BCD gas + wetsuit + lungs all
// obey Boyle's law), breathing cycle, gas consumption and the decompression model.
import * as THREE from 'three';
import { Deco, ambient } from './deco.js';

const RHO = 1.025; // kg/L sea water
const MASS = 150; // diver + gear + entrained water (kg)

export class Diver {
  constructor(site, camera, opts) {
    this.camera = camera;
    this.mode = opts.mode; // 'real' | 'easy'
    this.pos = new THREE.Vector3(site.start.x, site.start.y, site.start.z);
    this.vel = new THREE.Vector3();
    this.yaw = site.start.yaw;
    this.pitch = -0.15;
    this.roll = 0;
    this.radius = 0.45;
    // buoyancy budget
    this.suitL = site.temp < 26 ? 7 : 4.5; // 5 mm vs 3 mm neoprene at the surface
    this.weight = 0; // set below for neutral-ish trim
    this.bcd = 0; // surface-litres of gas in the BCD
    this.lung = 0; // litres above mid-tidal volume
    this.breath = { phase: 'inhale', t: 0, hold: 0 };
    // weight the diver correctly: neutral at 5 m with an empty BCD and mid lungs, minus 0.8 kg
    this.weight = RHO * (this.suitL / ambient(5)) + 0.8;
    // start with enough gas in the BCD to float near the start depth
    this.bcd = Math.max(0, (this.weight - RHO * this.suitL / ambient(-site.start.y)) / RHO * ambient(-site.start.y));
    this.tankL = 11.1;
    this.pressure = 200;
    this.sacBase = 14; // L/min
    this.exertion = 0;
    this.deco = new Deco();
    this.time = 0;
    this.maxDepth = 0;
    this.ascentRate = 0; // m/min (+ = ascending)
    this.prevDepth = -this.pos.y;
    this.kickPhase = 0;
    this.kickPower = 0;
    this.safety = { required: false, remaining: 180, done: false, active: false };
    this.events = [];
    this.ndlCache = 99;
    this.ndlTimer = 0;
    this.speed = 0;
    this.groundDist = 10;
  }

  get depth() { return Math.max(0, -this.pos.y); }

  netBuoyancy() {
    const P = ambient(this.depth);
    const gas = this.bcd / P + this.suitL / P + this.lung;
    return RHO * gas - this.weight; // kgf (+ = floats)
  }

  update(dt, input, world) {
    const ax = input.axis();
    const look = input.consumeLook();
    const sens = 0.0022;
    this.yaw -= look.x * sens;
    this.pitch -= look.y * sens;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));

    const fwd = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // --- fins: thrust arrives in pulses with each kick cycle
    const kicking = Math.abs(ax.forward) > 0.05 || Math.abs(ax.strafe) > 0.05;
    const power = kicking ? (ax.fast ? 1.0 : 0.55) : 0;
    this.kickPower += (power - this.kickPower) * Math.min(1, dt * 3);
    const kickHz = 0.55 + this.kickPower * 0.55;
    this.kickPhase += dt * kickHz * Math.PI * 2;
    const pulse = 0.65 + 0.35 * Math.max(0, Math.sin(this.kickPhase)) * 1.6;
    const thrust = new THREE.Vector3();
    thrust.addScaledVector(fwd, ax.forward * (ax.forward < 0 ? 0.4 : 1));
    thrust.addScaledVector(right, ax.strafe * 0.45);
    if (thrust.lengthSq() > 1) thrust.normalize();
    thrust.multiplyScalar(this.kickPower * 1.15 * pulse);
    this.exertion += ((kicking ? (ax.fast ? 1 : 0.4) : 0) - this.exertion) * Math.min(1, dt * 0.15);

    // --- buoyancy control
    if (this.mode === 'real') {
      const P = ambient(this.depth);
      if (ax.inflate) { this.bcd += dt * 2.2 * P; this.emit('bcd-in'); } // low-pressure inflator
      if (ax.deflate && this.bcd > 0) { this.bcd = Math.max(0, this.bcd - dt * 3.0 * P); this.emit('bcd-out'); }
      // overpressure valve
      if (this.bcd / P > 16) this.bcd = 16 * P;
    } else {
      // easy mode: an automatic BCD keeps you neutral, vertical keys swim up/down
      const need = (this.weight - RHO * (this.suitL / ambient(this.depth))) / RHO * ambient(this.depth);
      this.bcd += (Math.max(0, need) - this.bcd) * Math.min(1, dt * 1.5);
      if (ax.up) thrust.y += 0.3;
      if (ax.down) thrust.y -= 0.3;
      // depth hold: when no vertical input, gently trim back to the depth where the diver stopped
      if (ax.up || ax.down || this.holdY === undefined) this.holdY = this.pos.y;
      else if (Math.abs(ax.forward) < 0.05) thrust.y += (this.holdY - this.pos.y) * 0.25 - this.vel.y * 0.8;
      else this.holdY = this.pos.y;
    }

    // --- breathing (lung volume changes buoyancy by ~±1 kg — real divers fine-tune with it)
    this.updateBreath(dt, ax);

    const B = this.netBuoyancy();
    const acc = new THREE.Vector3();
    acc.y += (B * 9.81) / MASS;
    acc.add(thrust);
    // quadratic drag, larger cross-section vertically
    const v = this.vel;
    const cdH = 0.42, cdV = 1.1;
    acc.x -= cdH * v.x * Math.abs(v.x);
    acc.z -= cdH * v.z * Math.abs(v.z);
    acc.y -= cdV * v.y * Math.abs(v.y);
    // linear damping for slow drifts
    acc.addScaledVector(v, -0.12);
    // gentle current
    acc.x += world.current.x * 0.05;
    acc.z += world.current.y * 0.05;
    // surge near the surface
    const surge = Math.exp(-this.depth / 6) * 0.25;
    acc.x += Math.sin(this.time * 0.9) * surge;
    acc.z += Math.cos(this.time * 0.7) * surge * 0.6;
    // keep the diver inside the dive area
    const lim = world.limit;
    if (Math.abs(this.pos.x) > lim || Math.abs(this.pos.z) > lim) {
      acc.x -= Math.sign(this.pos.x) * Math.max(0, Math.abs(this.pos.x) - lim) * 0.3;
      acc.z -= Math.sign(this.pos.z) * Math.max(0, Math.abs(this.pos.z) - lim) * 0.3;
    }

    v.addScaledVector(acc, dt);
    this.pos.addScaledVector(v, dt);
    this.speed = v.length();

    // --- collisions: seabed, wreck BVH, coral heads, surface
    const g = world.terrain.heightAt(this.pos.x, this.pos.z);
    this.groundDist = this.pos.y - g;
    if (this.pos.y < g + this.radius + 0.15) {
      this.pos.y = g + this.radius + 0.15;
      if (v.y < 0) v.y *= -0.1;
      v.x *= 1 - Math.min(1, dt * 3); v.z *= 1 - Math.min(1, dt * 3);
      if (this.speed > 0.15 || this.kickPower > 0.2) world.silt(this.pos, 3, 0.6);
    } else if (this.groundDist < 1.1 && this.kickPower > 0.3) {
      // fin wash stirs the sand behind the diver
      const back = this.pos.clone().addScaledVector(fwd, -1.2);
      back.y = world.terrain.heightAt(back.x, back.z) + 0.1;
      if (Math.random() < dt * 12 * this.kickPower) world.silt(back, 1, 0.35);
    }
    for (const c of world.colliders(this.pos)) {
      const d = this.pos.distanceTo(c.c);
      const min = c.r + this.radius;
      if (d < min) {
        const n = this.pos.clone().sub(c.c).normalize();
        this.pos.addScaledVector(n, min - d);
        const vn = v.dot(n);
        if (vn < 0) v.addScaledVector(n, -vn);
      }
    }
    if (world.wreck) {
      const hit = world.wreck.collider.boundsTree.closestPointToPoint(this.pos, {}, 0, this.radius + 0.1);
      if (hit && hit.distance < this.radius) {
        const n = this.pos.clone().sub(hit.point);
        const l = n.length();
        if (l > 1e-4) {
          n.divideScalar(l);
          this.pos.addScaledVector(n, this.radius - l);
          const vn = v.dot(n);
          if (vn < 0) v.addScaledVector(n, -vn * 1.1);
        }
      }
    }
    if (this.pos.y > -0.35) {
      this.pos.y = -0.35;
      if (v.y > 0) v.y = 0;
    }

    // --- dive computer
    this.time += dt;
    const depth = this.depth;
    this.maxDepth = Math.max(this.maxDepth, depth);
    const instRate = ((this.prevDepth - depth) / Math.max(dt, 1e-3)) * 60;
    this.ascentRate += (instRate - this.ascentRate) * Math.min(1, dt * 1.2);
    this.prevDepth = depth;
    this.deco.step(depth, dt);
    this.ndlTimer -= dt;
    if (this.ndlTimer <= 0) { this.ndlCache = this.deco.ndl(depth); this.ndlTimer = 1; }
    // safety stop: 3 min between 3 and 6 m after any dive deeper than 10 m
    const s = this.safety;
    if (this.maxDepth > 10) s.required = true;
    s.active = s.required && !s.done && depth >= 3 && depth <= 6.5;
    if (s.active) { s.remaining -= dt; if (s.remaining <= 0) { s.done = true; this.emit('safety-done'); } }

    // --- camera: subtle body motion from kicks and breathing
    const cam = this.camera;
    const bob = Math.sin(this.kickPhase) * 0.012 * this.kickPower;
    const targetRoll = -ax.strafe * 0.06 + Math.sin(this.kickPhase * 0.5) * 0.008 * this.kickPower;
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 3);
    cam.position.copy(this.pos);
    cam.position.y += bob;
    cam.rotation.order = 'YXZ';
    cam.rotation.set(this.pitch + bob * 0.5, this.yaw, this.roll);
    return { fwd, right };
  }

  updateBreath(dt, ax) {
    const b = this.breath;
    const rate = 1 + this.exertion * 0.7; // breathe faster when working hard
    b.t += dt * rate;
    const inT = 1.9, pauseIn = 0.35, exT = 2.6, pauseEx = 0.8;
    const deep = this.mode === 'real' && ax.inhale;
    const empty = this.mode === 'real' && ax.exhale;
    let target = this.lung;
    if (b.phase === 'inhale') {
      target = THREE.MathUtils.lerp(-0.6, deep ? 1.9 : 0.6, Math.min(1, b.t / inT));
      if (b.t >= inT + (deep ? 2.5 : pauseIn)) { b.phase = 'exhale'; b.t = 0; this.emit('exhale'); }
    } else {
      target = THREE.MathUtils.lerp(deep ? 1.9 : 0.6, empty ? -1.6 : -0.6, Math.min(1, b.t / exT));
      if (b.t >= exT + (empty ? 1.8 : pauseEx)) { b.phase = 'inhale'; b.t = 0; this.emit('inhale'); }
    }
    this.lung += (target - this.lung) * Math.min(1, dt * 4);
    // gas: SAC scaled by ambient pressure and exertion
    const sac = this.sacBase * (1 + this.exertion * 1.1);
    const used = (sac / 60) * ambient(this.depth) * dt;
    this.pressure = Math.max(0, this.pressure - used / this.tankL);
  }

  emit(e) { this.events.push(e); }
  drainEvents() { const e = this.events; this.events = []; return e; }
}
