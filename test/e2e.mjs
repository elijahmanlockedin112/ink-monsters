// End-to-end check in real headless Chrome with real touch and keyboard input.
// Usage: node test/e2e.mjs [baseUrl]   (server must be running; screenshots land in test/shots)
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:47905/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = join(process.env.TEMP || '.', 'inkm-cdp');
const SHOTS = new URL('./shots/', import.meta.url);
const PORT = 9341;
// ms between a finger lift and the next touch; under ~100 ms headless Chrome reads it as a double tap and drops the click
const GAP = Number(process.env.GAP || 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(SHOTS, { recursive: true });
rmSync(PROFILE, { recursive: true, force: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--mute-audio',
  '--no-first-run', '--window-size=1440,1000', '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
const errors = [];
const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener('open', r, { once: true }));
        ws.addEventListener('message', (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
          if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
          if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value || a.description).join(' '));
        });
        return;
      }
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome did not open its debugging port');
}
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id;
  pending.set(n, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  return r.result.value;
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(new URL(name, SHOTS), Buffer.from(r.data, 'base64'));
}
async function viewport(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 3 : 1, mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
}
async function go(url) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 40; i++) { await sleep(150); if (await js('document.readyState === "complete" && !!window.__ink')) return; }
  throw new Error('page did not load: ' + url);
}

// where a selector's center is, and whether a tap there really lands on it
async function spot(sel) {
  return js(`(() => {
    const e = document.querySelector(${JSON.stringify(sel)});
    if (!e) return null;
    e.scrollIntoView({ block: 'center' });
    const b = e.getBoundingClientRect(); const x = b.x + b.width / 2, y = b.y + b.height / 2;
    const top = document.elementFromPoint(x, y);
    return { x, y, hit: !!top && (e === top || e.contains(top)) };
  })()`);
}
async function touchTap(x, y) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(50);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(120);
}
async function clickAt(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(40);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(120);
}
async function tap(sel, mobile = true) {
  const p = await spot(sel);
  if (!p || !p.hit) throw new Error(`cannot tap ${sel}: ${JSON.stringify(p)}`);
  await (mobile ? touchTap(p.x, p.y) : clickAt(p.x, p.y));
}
// drags a finger through drawing-space points (0..1000) on the draw canvas
async function stroke(pts) {
  const r = await js(`(() => { const b = document.getElementById('drawCanvas').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width }; })()`);
  const P = pts.map(([x, y]) => ({ x: r.x + (x / 1000) * r.w, y: r.y + (y / 1000) * r.w }));
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [P[0]] });
  for (const p of P.slice(1)) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] }); await sleep(8); }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(GAP);
}
const circle = (cx, cy, rx, ry, n = 48, spikes = 0) => Array.from({ length: n + 3 }, (_, i) => {
  const a = (i / n) * Math.PI * 2; const k = spikes ? 1 + 0.25 * (i % 2 ? -1 : 1) : 1;
  return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k];
});
const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * (i / n), y0 + (y1 - y0) * (i / n)]);

async function fight(mobile, label) {
  // wait for each turn's meter; tap at a varied moment; stop when the result shows
  let taps = 0, midShot = false;
  for (let i = 0; i < 400; i++) {
    const s = await js(`({ live: document.getElementById('actionPad').classList.contains('live'), done: !document.getElementById('result').hidden, scr: window.__ink.screen })`);
    if (s.done) break;
    if (s.live) {
      await sleep(150 + Math.random() * 600);
      if (mobile) await tap('#actionBtn', true);
      else { await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 }); }
      taps++;
      if (taps === 3 && !midShot) { await sleep(560); await shot(`${label}-battle.png`); midShot = true; }
    }
    await sleep(200);
  }
  return taps;
}

try {
  await connect();
  await send('Runtime.enable'); await send('Page.enable');

  // ---------- phone ----------
  await viewport(390, 844, true);
  await go(BASE);
  await sleep(900);
  await shot('phone-home.png');
  const overflow = await js('document.documentElement.scrollWidth');
  ok(overflow <= 390, `home has no sideways scroll at 390 (scrollWidth ${overflow})`);
  ok((await js('document.querySelectorAll("#rivalList .row").length')) === 4, 'four house monsters listed');

  await tap('#drawBtn');
  ok((await js('window.__ink.screen')) === 'draw', 'Draw button opens the drawing pad');
  ok(await js('document.getElementById("nextBtn").disabled'), 'Next is locked until there is a body');
  await stroke(circle(500, 470, 260, 210, 40, 1));
  await stroke(line(420, 470, 580, 470, 6));
  ok(!(await js('document.getElementById("nextBtn").disabled')), 'Next unlocks after drawing a body');
  await tap('#nextBtn');
  ok((await js('window.__ink.step')) === 'legs', 'Next goes to the legs step');
  for (const [x0, x1] of [[380, 340], [460, 450], [540, 550], [620, 670]]) await stroke(line(x0, 640, x1, 820));
  ok((await js('window.__ink.drawing.legs.length')) === 4, 'four leg strokes became four legs');
  await tap('#nextBtn');
  ok((await js('window.__ink.step')) === 'eyes', 'Next goes to the eyes step');
  await stroke([[430, 380]]); // a tap = one eye
  await stroke([[560, 380], [570, 380], [590, 380], [600, 382]]); // a drag = a bigger eye
  await shot('phone-draw-eyes.png');
  await tap('#nextBtn');
  await sleep(1800);
  await shot('phone-reveal.png');
  const made = await js(`(() => { const d = window.__ink.store.mine[0]; const m = window.__ink.mon(d); return { n: window.__ink.store.mine.length, legs: d.legs.length, eyes: d.eyes.length, eye2: d.eyes[1] && d.eyes[1].r > d.eyes[0].r, body: d.body.length, stats: m.stats, move: m.moveName, name: d.name, area: m.sil.area } })()`);
  console.log('      made:', JSON.stringify(made));
  ok(made.n === 1 && made.body === 2 && made.legs === 4 && made.eyes === 2, 'monster saved with 2 body strokes, 4 legs, 2 eyes');
  ok(made.eye2, 'dragging an eye made it bigger');
  ok(made.area > 0.15, `closed outline got filled in (area ${made.area.toFixed(2)})`);
  ok(made.stats.hp >= 60 && made.stats.pow >= 14 && made.stats.spd >= 10, 'stats came out of the drawing');

  // reload keeps it
  await go(BASE);
  ok((await js('window.__ink.store.mine.length')) === 1, 'monster survives a reload');
  await tap('#mineList .row .btn');
  ok((await js('window.__ink.screen')) === 'pick', 'Fight on your monster opens the opponent list');
  await tap('#pickList .row:nth-child(2) .btn'); // Prickle
  ok((await js('window.__ink.screen')) === 'battle', 'picking an opponent starts a battle');
  const taps = await fight(true, 'phone');
  await sleep(400);
  await shot('phone-result.png');
  const res = await js(`({ title: document.getElementById('resultTitle').textContent, w: window.__ink.store.mine[0].w, l: window.__ink.store.mine[0].l })`);
  console.log('      result:', JSON.stringify(res), 'taps', taps);
  ok(res.title.endsWith('wins') && res.w + res.l === 1, 'battle finishes and records a win or loss');
  ok(taps >= 2, `the meter took real taps (${taps})`);

  // share link round trip
  const link = await js(`(async () => { const c = await import('./js/codec.js'); const d = window.__ink.store.mine[0]; return location.origin + location.pathname + '#m=' + await c.encodeMonster({ ...d, name: 'Linkzilla' }); })()`);
  console.log('      link length:', link.length);
  await js(`localStorage.setItem('inkmonsters.v1', JSON.stringify({ mine: [], challengers: [], seq: 0, muted: false }))`);
  await send('Page.navigate', { url: 'about:blank' }); await sleep(300); // a link opens in a fresh page
  await go(link);
  await sleep(1500);
  await shot('phone-incoming.png');
  const inc = await js(`({ scr: window.__ink.screen, kicker: !document.getElementById('revealKicker').hidden, name: document.getElementById('nameInput').value, ch: window.__ink.store.challengers.length, btn: document.getElementById('fightBtn').textContent, hash: location.hash })`);
  ok(inc.scr === 'reveal' && inc.kicker && inc.name === 'Linkzilla' && inc.ch === 1, 'a share link opens as a challenger and is saved');
  ok(inc.hash === '', 'the link hash is cleared after reading');
  ok(inc.btn === 'Draw one to fight it', 'with no monsters, the challenger offers to draw one');

  // ---------- desktop ----------
  await viewport(1440, 900, false);
  await go(BASE);
  await sleep(900);
  await shot('desktop-home.png');
  await tap('#rivalList .row:nth-child(1)', false); // the challenger from the link
  await sleep(1400);
  await shot('desktop-reveal.png');
  // fight house vs house is impossible without your own monster, so draw quickly with the mouse
  await tap('#fightBtn', false);
  ok((await js('window.__ink.screen')) === 'draw', 'Draw one to fight it opens the pad');
  const r = await js(`(() => { const b = document.getElementById('drawCanvas').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width }; })()`);
  const P = circle(500, 500, 220, 180, 36).map(([x, y]) => [r.x + (x / 1000) * r.w, r.y + (y / 1000) * r.w]);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: P[0][0], y: P[0][1], button: 'left', clickCount: 1 });
  for (const [x, y] of P) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 }); await sleep(6); }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: P[P.length - 1][0], y: P[P.length - 1][1], button: 'left', clickCount: 1 });
  await sleep(100);
  await tap('#nextBtn', false); await tap('#nextBtn', false); await tap('#nextBtn', false);
  await sleep(1500);
  const auto = await js(`({ eyes: window.__ink.store.mine[0].eyes.length, legs: window.__ink.store.mine[0].legs.length, move: window.__ink.mon(window.__ink.store.mine[0]).move, btn: document.getElementById('fightBtn').textContent })`);
  ok(auto.eyes === 1 && auto.legs === 0 && auto.move === 'roll', 'skipping eyes gives one eye, no legs means Roll');
  ok(auto.btn === 'Fight Linkzilla', 'the answer monster goes straight at the challenger');
  await tap('#fightBtn', false);
  ok((await js('window.__ink.screen')) === 'battle', 'desktop battle starts');
  await fight(false, 'desktop');
  await sleep(400);
  await shot('desktop-result.png');
  ok(!(await js('document.getElementById("result").hidden')), 'desktop battle finishes using the Space key');

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  console.error('ERROR', e.message);
  fails.push(e.message);
  try { await shot('error.png'); } catch { /* ignore */ }
} finally {
  try { ws && ws.close(); } catch { /* ignore */ }
  chrome.kill();
  await sleep(300);
  rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
  process.exitCode = fails.length ? 1 : 0;
}
