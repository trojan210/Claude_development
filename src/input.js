// Keyboard / mouse (pointer lock) / touch input.
export class Input {
  constructor(dom) {
    this.dom = dom;
    this.keys = new Set();
    this.look = { x: 0, y: 0 };
    this.move = { x: 0, y: 0 }; // touch joystick
    this.buttons = { up: false, down: false, fast: false };
    this.pressed = new Set(); // edge-triggered
    this.locked = false;
    this.touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    dom.addEventListener('click', () => {
      if (!this.touch && this.enabled && document.pointerLockElement !== dom) dom.requestPointerLock?.()?.catch?.(() => {});
    });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === dom; });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.look.x += e.movementX;
      this.look.y += e.movementY;
    });
    this.enabled = false;
  }

  bindTouch(ui) {
    // left: virtual joystick, right: drag to look
    const stick = ui.stick, knob = ui.knob;
    let stickId = null, lookId = null, sx = 0, sy = 0, lx = 0, ly = 0;
    const R = 55;
    const onStart = (e) => {
      for (const t of e.changedTouches) {
        if (t.target.closest && t.target.closest('.tbtn')) continue;
        if (t.clientX < innerWidth * 0.45 && stickId === null) {
          stickId = t.identifier; sx = t.clientX; sy = t.clientY;
          stick.style.left = `${sx - R}px`; stick.style.top = `${sy - R}px`; stick.style.opacity = 1;
        } else if (lookId === null) {
          lookId = t.identifier; lx = t.clientX; ly = t.clientY;
        }
      }
    };
    const onMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          let dx = t.clientX - sx, dy = t.clientY - sy;
          const l = Math.hypot(dx, dy);
          if (l > R) { dx *= R / l; dy *= R / l; }
          this.move.x = dx / R; this.move.y = -dy / R;
          knob.style.transform = `translate(${dx}px, ${dy}px)`;
        } else if (t.identifier === lookId) {
          this.look.x += (t.clientX - lx) * 1.6; this.look.y += (t.clientY - ly) * 1.6;
          lx = t.clientX; ly = t.clientY;
        }
      }
      e.preventDefault();
    };
    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          stickId = null; this.move.x = this.move.y = 0;
          knob.style.transform = ''; stick.style.opacity = 0.35;
        }
        if (t.identifier === lookId) lookId = null;
      }
    };
    this.dom.addEventListener('touchstart', onStart, { passive: false });
    this.dom.addEventListener('touchmove', onMove, { passive: false });
    this.dom.addEventListener('touchend', onEnd);
    this.dom.addEventListener('touchcancel', onEnd);
    const hold = (el, key) => {
      el.addEventListener('touchstart', (e) => { this.buttons[key] = true; el.classList.add('on'); e.preventDefault(); e.stopPropagation(); }, { passive: false });
      const up = (e) => { this.buttons[key] = false; el.classList.remove('on'); e.preventDefault(); };
      el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
    };
    hold(ui.btnUp, 'up');
    hold(ui.btnDown, 'down');
    hold(ui.btnFast, 'fast');
    const tap = (el, code) => el.addEventListener('touchstart', (e) => { this.pressed.add(code); e.preventDefault(); e.stopPropagation(); }, { passive: false });
    tap(ui.btnLight, 'KeyF');
    tap(ui.btnPhoto, 'KeyP');
    tap(ui.btnLog, 'Tab');
    tap(ui.btnPause, 'Escape');
  }

  consumeLook() {
    const l = { x: this.look.x, y: this.look.y };
    this.look.x = this.look.y = 0;
    return l;
  }

  wasPressed(code) {
    if (this.pressed.has(code)) { this.pressed.delete(code); return true; }
    return false;
  }

  clearPressed() { this.pressed.clear(); }

  axis() {
    const k = this.keys;
    let f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    f += this.move.y; s += this.move.x;
    return {
      forward: Math.max(-1, Math.min(1, f)),
      strafe: Math.max(-1, Math.min(1, s)),
      fast: k.has('ShiftLeft') || k.has('ShiftRight') || this.buttons.fast,
      up: k.has('Space') || k.has('KeyE') || this.buttons.up,
      down: k.has('KeyC') || k.has('KeyQ') || this.buttons.down,
      inflate: k.has('KeyE') || this.buttons.up,
      deflate: k.has('KeyQ') || this.buttons.down,
      inhale: k.has('Space'),
      exhale: k.has('KeyC'),
    };
  }
}
