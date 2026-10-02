// DOM overlay: wrist dive computer, compass, buoyancy gauge, notifications, fish log.
import { SPECIES } from './fish.js';

export const LOGBOOK = {
  wreck: { name: 'USAT リバティ号', sci: 'US Army Transport, 1918年建造', desc: '1942年1月、ロンボク海峡で日本軍潜水艦の魚雷を受け、トランベンの浜に座礁。1963年のアグン山噴火に伴う地震で海中に滑り落ちた。' },
  jack: { name: SPECIES.jack.name, sci: SPECIES.jack.sci, desc: '数百匹が渦を巻いて群れる「トルネード」はリバティ号の名物。銀色の体に背中の青灰色、えらぶたの黒斑が目印。' },
  anthias: { name: SPECIES.anthias.name, sci: SPECIES.anthias.sci, desc: 'サンゴの頭上に乱舞するオレンジの小魚。群れの中の紫色の個体はハーレムを率いるオス。' },
  fusilier: { name: SPECIES.fusilier.name, sci: SPECIES.fusilier.sci, desc: '青い体に黄色い背と尾。中層を高速で流れるように泳ぎ、プランクトンを食べる。' },
  butterfly: { name: SPECIES.butterfly.name, sci: SPECIES.butterfly.sci, desc: '目を隠す黒い帯と、背びれ後端の黒い眼状斑で天敵を欺く。たいていペアで泳ぐ。' },
  parrot: { name: SPECIES.parrot.name, sci: SPECIES.parrot.sci, desc: '全長1mを超えるブダイ科最大種。額のこぶでサンゴを砕き、硬いくちばしでかじり取る。' },
  surgeon: { name: SPECIES.surgeon.name, sci: SPECIES.surgeon.sci, desc: '黄と青の縞模様が鮮やかな浅場の藻食魚。尾の付け根にメスのような鋭い棘を持つ。' },
  clown: { name: SPECIES.clown.name, sci: SPECIES.clown.sci, desc: 'イソギンチャクの毒触手に守られて暮らす。体表の粘液が刺胞の発射を防いでいる。' },
  turtle: { name: 'タイマイ', sci: 'Eretmochelys imbricata', desc: '鼈甲模様の甲羅を持つウミガメ。海綿を主食とし、ときどき水面へ息継ぎに上がる。' },
  manta: { name: 'ナンヨウマンタ', sci: 'Mobula alfredi', desc: '翼幅4mに達する。ホンソメワケベラに寄生虫を取ってもらうためクリーニングステーションを旋回する。腹側の斑紋は個体ごとに異なる。' },
};

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), depth: $('dc-depth'), max: $('dc-max'), time: $('dc-time'), ndl: $('dc-ndl'), ndlLabel: $('dc-ndl-label'),
      temp: $('dc-temp'), bar: $('dc-bar'), barFill: $('dc-bar-fill'), asc: $('dc-asc'), stop: $('dc-stop'), tissue: $('dc-tissue'),
      compass: $('compass-strip'), heading: $('compass-heading'), msg: $('msg'), toast: $('toast'), buoy: $('buoy'), buoyNeedle: $('buoy-needle'),
      bcd: $('bcd-level'), hint: $('hint'), log: $('log'), logList: $('log-list'), logCount: $('log-count'), light: $('light-ind'),
      gallery: $('gallery'),
    };
    this.msgTimer = 0;
    this.toastQueue = [];
    this.toastTimer = 0;
    this.found = new Set();
    this.buildCompass();
  }

  buildCompass() {
    const strip = this.el.compass;
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    let html = '';
    for (let rep = 0; rep < 3; rep++) {
      for (let d = 0; d < 360; d += 15) {
        const label = names[d] ? `<b>${names[d]}</b>` : d % 45 === 0 ? '' : '<i>|</i>';
        html += `<span>${label || d}</span>`;
      }
    }
    strip.innerHTML = html;
  }

  setMode(mode, touch) {
    this.el.buoy.style.display = mode === 'real' ? '' : 'none';
    this.el.hint.innerHTML = touch
      ? (mode === 'real' ? '左: 移動　右: 視点　▲▼: BCD 給気/排気' : '左: 移動　右: 視点　▲▼: 浮上/潜行')
      : (mode === 'real'
        ? 'WASD 移動 / Shift 強くキック / マウス 視点<br>E 給気・Q 排気 (BCD) / Space 深く吸う・C 吐き切る / F ライト / P 撮影 / Tab 図鑑'
        : 'WASD 移動 / Shift 強くキック / マウス 視点<br>Space 浮上・C 潜行 / F ライト / P 撮影 / Tab 図鑑');
  }

  message(text, sec = 3, cls = '') {
    this.el.msg.textContent = text;
    this.el.msg.className = 'show ' + cls;
    this.msgTimer = sec;
  }

  discover(key) {
    if (this.found.has(key) || !LOGBOOK[key]) return false;
    this.found.add(key);
    this.toastQueue.push(key);
    this.renderLog();
    return true;
  }

  renderLog(siteKeys) {
    if (siteKeys) this.siteKeys = siteKeys;
    const keys = this.siteKeys || Object.keys(LOGBOOK);
    this.el.logCount.textContent = `${keys.filter((k) => this.found.has(k)).length} / ${keys.length}`;
    this.el.logList.innerHTML = keys.map((k) => {
      const e = LOGBOOK[k];
      const f = this.found.has(k);
      return `<li class="${f ? 'found' : ''}"><div class="ln">${f ? e.name : '？？？'}</div><div class="ls">${f ? e.sci : ''}</div><p>${f ? e.desc : 'まだ出会っていない'}</p></li>`;
    }).join('');
  }

  toggleLog(show) {
    this.el.log.classList.toggle('show', show);
  }

  addPhoto(url) {
    const a = document.createElement('a');
    a.href = url; a.download = `bali-dive-${Date.now()}.jpg`;
    const img = document.createElement('img'); img.src = url;
    a.appendChild(img);
    this.el.gallery.prepend(a);
    while (this.el.gallery.children.length > 6) this.el.gallery.lastChild.remove();
  }

  update(dt, d, site, torchOn) {
    const e = this.el;
    e.depth.textContent = d.depth.toFixed(1);
    e.max.textContent = d.maxDepth.toFixed(1);
    const m = Math.floor(d.time / 60), s = Math.floor(d.time % 60);
    e.time.textContent = `${m}:${String(s).padStart(2, '0')}`;
    const ceil = d.deco.ceiling();
    if (ceil > 0) {
      e.ndlLabel.textContent = 'DECO';
      e.ndl.textContent = `${Math.ceil(ceil)}m`;
      e.ndl.parentElement.classList.add('warn');
    } else {
      e.ndlLabel.textContent = 'NDL';
      e.ndl.textContent = d.ndlCache >= 99 ? '99+' : `${d.ndlCache}'`;
      e.ndl.parentElement.classList.toggle('warn', d.ndlCache < 5);
    }
    e.temp.textContent = `${site.temp}°C`;
    e.bar.textContent = `${Math.round(d.pressure)} bar`;
    e.barFill.style.width = `${(d.pressure / 200) * 100}%`;
    e.barFill.className = d.pressure < 50 ? 'low' : d.pressure < 100 ? 'mid' : '';
    // ascent rate: arrows like real computers (each ≈ 3 m/min)
    const rate = d.ascentRate;
    const n = Math.max(0, Math.min(5, Math.round(rate / 3)));
    e.asc.textContent = rate > 1 ? '▲'.repeat(n) : rate < -1 ? '▼' : '';
    e.asc.className = rate > 10 ? 'alarm' : '';
    // tissue loading bar
    e.tissue.style.height = `${Math.min(100, d.deco.loading() * 100)}%`;
    // safety stop
    const st = d.safety;
    if (st.active) {
      const r = Math.max(0, st.remaining);
      e.stop.textContent = `安全停止 ${Math.floor(r / 60)}:${String(Math.floor(r % 60)).padStart(2, '0')}`;
      e.stop.className = 'show';
    } else if (st.required && !st.done && d.depth < 3 && d.depth > 0.2) {
      e.stop.textContent = '安全停止未完了';
      e.stop.className = 'show warn';
    } else e.stop.className = '';
    // compass
    let hdg = ((-d.yaw * 180) / Math.PI) % 360;
    if (hdg < 0) hdg += 360;
    const spanPx = 40; // px per 15°
    e.compass.style.transform = `translateX(${-(24 + hdg / 15) * spanPx - spanPx / 2}px)`;
    e.heading.textContent = `${Math.round(hdg).toString().padStart(3, '0')}°`;
    // buoyancy gauge
    const B = d.netBuoyancy();
    const pct = Math.max(-1, Math.min(1, B / 3));
    e.buoyNeedle.style.top = `${50 - pct * 45}%`;
    e.bcd.style.height = `${Math.min(100, (d.bcd / (4 + d.depth * 0.6)) * 100)}%`;
    e.light.classList.toggle('on', torchOn);

    if (this.msgTimer > 0) { this.msgTimer -= dt; if (this.msgTimer <= 0) e.msg.className = ''; }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) e.toast.className = '';
    } else if (this.toastQueue.length) {
      const k = this.toastQueue.shift();
      const en = LOGBOOK[k];
      e.toast.innerHTML = `<small>図鑑に登録</small><b>${en.name}</b><i>${en.sci}</i>`;
      e.toast.className = 'show';
      this.toastTimer = 4;
    }
  }
}
