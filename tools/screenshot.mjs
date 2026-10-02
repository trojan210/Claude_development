import { chromium } from '@playwright/test';
const SP = process.env.SHOT_DIR || 'screenshots';
import { mkdirSync } from 'node:fs';
mkdirSync(SP + '/shots', { recursive: true });
const url = process.argv[2] || 'http://localhost:4173/';
const site = process.argv[3] || 'tulamben';
const quality = process.argv[4] || 'high';
const poses = JSON.parse(process.argv[5] || '[]');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
await page.goto(url);
await page.waitForTimeout(800);
await page.screenshot({ path: `${SP}/shots/title.png` });
await page.click(`.site[data-id="${site}"]`);
await page.selectOption('#opt-quality', quality);
await page.uncheck('#opt-sound');
await page.click('#btn-start');
try {
  await page.waitForFunction(() => window.__bali.game && window.__bali.game.started, null, { timeout: +(process.env.LOAD_TIMEOUT || 240000) });
} catch (e) {
  console.log('LOAD FAILED:', await page.textContent('#load-text'));
  console.log(logs.join('\n'));
  await page.screenshot({ path: `${SP}/shots/fail.png` });
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(1500);
for (const [i, p] of poses.entries()) {
  await page.evaluate((p) => {
    const g = window.__bali.game;
    const d = g.diver;
    if (p.x !== undefined) d.pos.set(p.x, p.y, p.z);
    if (p.yaw !== undefined) d.yaw = p.yaw;
    if (p.pitch !== undefined) d.pitch = p.pitch;
    d.vel.set(0, 0, 0);
    g.torchOn = !!p.torch;
    d.mode = 'easy';
    g.exposure = 0; // snap eye adaptation for the screenshot
  }, p);
  await page.waitForTimeout(p.wait || 2500);
  if (p.eval) console.log('eval:', JSON.stringify(await page.evaluate(p.eval)));
  await page.screenshot({ path: `${SP}/shots/${site}-${i}.png` });
}
const info = await page.evaluate(() => { const g = window.__bali.game; return { pos: g.diver.pos.toArray().map(v=>+v.toFixed(2)), calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles }; });
console.log(JSON.stringify(info));
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
