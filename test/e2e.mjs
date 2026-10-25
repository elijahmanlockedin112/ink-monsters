// End-to-end check in real headless Chrome with real touch, mouse and keyboard input.
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
const screenIs = () => js('window.__ink.screen');

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
  await sleep(GAP);
}
async function clickAt(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(40);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(150);
}
let MOBILE = true;
async function tap(sel) {
  const p = await spot(sel);
  if (!p || !p.hit) throw new Error(`cannot tap ${sel}: ${JSON.stringify(p)}`);
  await (MOBILE ? touchTap(p.x, p.y) : clickAt(p.x, p.y));
}
async function key(code, keyName, vk) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: keyName, windowsVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: keyName, windowsVirtualKeyCode: vk });
  await sleep(120);
}
// drags a finger (or the mouse) through drawing-space points (0..1000) on the draw canvas
async function stroke(pts) {
  const r = await js(`(() => { const b = document.getElementById('drawCanvas').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width }; })()`);
  const P = pts.map(([x, y]) => ({ x: r.x + (x / 1000) * r.w, y: r.y + (y / 1000) * r.w }));
  if (MOBILE) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [P[0]] });
    for (const p of P.slice(1)) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] }); await sleep(8); }
    // a real finger slows down before lifting; ending at speed makes Chrome start a fling that eats the next tap
    const end = P[P.length - 1];
    for (let i = 0; i < 4; i++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: end.x + (i % 2) * 0.3, y: end.y }] }); await sleep(30); }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: P[0].x, y: P[0].y, button: 'left', clickCount: 1 });
    for (const p of P) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1 }); await sleep(6); }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: P[P.length - 1].x, y: P[P.length - 1].y, button: 'left', clickCount: 1 });
  }
  await sleep(GAP);
}
const circle = (cx, cy, rx, ry, n = 48, spikes = 0) => Array.from({ length: n + 3 }, (_, i) => {
  const a = (i / n) * Math.PI * 2; const k = spikes ? 1 + 0.25 * (i % 2 ? -1 : 1) : 1;
  return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k];
});
const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * (i / n), y0 + (y1 - y0) * (i / n)]);
async function tool(name) {
  await js(`window.__log = []; if (!window.__logOn) { window.__logOn = 1; for (const t of ['pointerdown','click','touchend','pointercancel']) document.addEventListener(t, (e) => window.__log.push(t + ':' + (e.target.id || e.target.tagName) + ':' + (e.target.textContent || '').slice(0, 8)), true); } 1`);
  await tap(`#tools button:nth-child(${['body', 'legs', 'arms', 'horns', 'wings', 'tail', 'mouth', 'eyes'].indexOf(name) + 1})`);
  const now = await js('window.__ink.part');
  if (now !== name) console.log(`      tool ${name} did not take (part is ${now}):`, await js('JSON.stringify(window.__log)'));
}

// plays one battle: picks moves (rotating through what's ready), taps the meter, stops at the result
async function fight(label, { keys = false, maxMs = 150000 } = {}) {
  const t0 = Date.now();
  const used = new Set();
  let turns = 0, shotTaken = false;
  while (Date.now() - t0 < maxMs) {
    const s = await js(`(() => {
      const pad = document.getElementById('actionPad');
      const grid = document.getElementById('moveGrid');
      return { live: pad.classList.contains('live'), grid: !grid.hidden, done: !document.getElementById('result').hidden,
        enabled: [...grid.children].map((b, i) => b.disabled ? -1 : i).filter((i) => i >= 0), names: [...grid.children].map((b) => b.querySelector('b').textContent) };
    })()`);
    if (s.done) break;
    if (s.live && s.grid && s.enabled.length) {
      const pickIdx = s.enabled[turns % s.enabled.length];
      used.add(s.names[pickIdx]);
      if (!shotTaken && turns === 0) await shot(`${label}-moves.png`);
      if (keys) await key(`Digit${pickIdx + 1}`, String(pickIdx + 1), 49 + pickIdx);
      else await tap(`#moveGrid button:nth-child(${pickIdx + 1})`);
      turns++;
      continue;
    }
    if (s.live && !s.grid) {
      await sleep(120 + Math.random() * 500);
      if (keys) await key('Space', ' ', 32); else await tap('#actionBtn');
      if (!shotTaken && turns === 2) { await sleep(520); await shot(`${label}-battle.png`); shotTaken = true; }
      continue;
    }
    await sleep(200);
  }
  return { turns, used: [...used] };
}

try {
  await connect();
  await send('Runtime.enable'); await send('Page.enable');

  // ---------- phone ----------
  await viewport(390, 844, true);
  await go(BASE);
  await sleep(900);
  await shot('phone-home-empty.png');
  ok((await js('document.documentElement.scrollWidth')) <= 390, 'home has no sideways scroll at 390');
  ok((await js('document.getElementById("advLabel").textContent')) === 'Draw your first monster', 'a new player is pointed at drawing first');

  await tap('#advBtn');
  ok((await screenIs()) === 'draw', 'the big button opens the drawing pad');
  ok(await js('[...document.querySelectorAll("#tools button")].slice(1).every((b) => b.disabled)'), 'parts are locked until there is a body');
  await stroke(circle(500, 450, 240, 200, 40, 1));
  ok(!(await js('document.getElementById("nextBtn").disabled')), 'Next unlocks after drawing a body');
  await tool('legs');
  for (const [x0, x1] of [[400, 360], [460, 450], [540, 550], [600, 640]]) await stroke(line(x0, 620, x1, 800));
  await tool('arms');
  await stroke(line(740, 470, 860, 540)); await stroke(line(260, 470, 140, 540));
  await tool('horns');
  await stroke(line(470, 270, 440, 170, 6));
  await tool('mouth');
  await stroke([[540, 520], [580, 545], [620, 545], [660, 520]]);
  await tool('eyes');
  await stroke([[560, 400]]); await stroke([[650, 400]]);
  await shot('phone-draw.png');
  const drawn = await js(`(() => { const d = window.__ink.drawing; return { legs: d.legs.length, arms: d.parts.arms.length, horns: d.parts.horns.length, mouth: d.parts.mouth.length, eyes: d.eyes.length }; })()`);
  ok(drawn.legs === 4 && drawn.arms === 2 && drawn.horns === 1 && drawn.mouth === 1 && drawn.eyes === 2, `every part type went to the right place ${JSON.stringify(drawn)}`);
  await tap('#nextBtn');
  ok((await screenIs()) === 'style', 'Next opens Color it');
  await tap('#inkRow button:nth-child(2)'); // Fire
  ok((await js('document.getElementById("inkBlurb").textContent')).includes('10% harder'), 'picking Fire explains what it does');
  await tap('#tintRow button:nth-child(6)'); // a locked color with 0 drops
  ok((await js('document.getElementById("toast").textContent')).includes('Needs'), 'a locked color says how many drops it needs');
  await sleep(900);
  await shot('phone-style.png');
  await tap('#lifeBtn');
  await sleep(1800);
  await shot('phone-mon.png');
  const made = await js(`(() => { const d = window.__ink.store.mine[0]; const m = window.__ink.mon(d); return { ink: d.ink, moves: m.moves, names: [...document.querySelectorAll('#monMoves b')].map((b) => b.textContent), stats: m.stats }; })()`);
  console.log('      made:', JSON.stringify(made));
  ok(made.ink === 'fire', 'the monster is Fire ink');
  ok(made.moves.includes('haymaker') && made.moves.includes('gore') && made.moves.includes('chomp'), 'arms, horns and mouth became Haymaker, Gore and Chomp');
  ok(made.names.length === 4, 'the page lists 4 moves');

  // adventure
  await tap('#monBack');
  ok((await js('document.getElementById("advLabel").textContent')) === 'Adventure', 'home now offers the Adventure');
  await tap('#advBtn');
  ok((await screenIs()) === 'map', 'Adventure opens the map');
  await sleep(300);
  await shot('phone-map.png');
  ok((await js('document.querySelectorAll(".node:not(:disabled)").length')) === 1, 'only the first fight is open');
  await tap('.node.next');
  await sleep(1400);
  await shot('phone-foe.png');
  ok((await js('document.getElementById("fightBtn").textContent')) === 'Choose your fighter', 'a map fight previews the opponent');
  await tap('#fightBtn');
  ok((await screenIs()) === 'battle', 'with one monster, the fight starts right away');
  const f1 = await fight('phone');
  console.log('      adventure fight:', JSON.stringify(f1));
  ok(f1.used.length >= 2, `more than one move got used (${f1.used.join(', ')})`);
  await sleep(1300);
  await shot('phone-result.png');
  const after = await js(`(() => { const d = window.__ink.store.mine[0]; return { w: d.w, l: d.l, lvl: d.lvl, xp: d.xp, drops: window.__ink.store.drops, stars: window.__ink.store.stars, title: document.getElementById('resultTitle').textContent }; })()`);
  console.log('      after:', JSON.stringify(after));
  ok(after.w + after.l === 1, 'the fight is recorded');
  ok(after.lvl > 1 || after.xp > 0, 'the monster earned XP');
  if (after.w) ok(after.drops > 0 && after.stars['0-0'] >= 1, 'a win pays drops and stars');

  // gauntlet
  await tap('#resHome');
  await tap('#mapBack');
  await tap('#gauntletBtn');
  ok((await screenIs()) === 'battle' && (await js('document.getElementById("roundTag").textContent')).includes('round 1'), 'Gauntlet starts at round 1');
  await fight('phone-gauntlet');
  const g = await js(`({ title: document.getElementById('resultTitle').textContent, pri: document.getElementById('resPrimary').textContent, best: window.__ink.store.gauntletBest })`);
  console.log('      gauntlet:', JSON.stringify(g));
  ok(g.title.includes('cleared') ? g.pri === 'Round 2' && g.best >= 1 : g.pri === 'New run', 'Gauntlet offers the next round or a new run');
  await tap('#resHome');

  // evolution: jump the monster to LV 3 and add two parts
  await js(`(() => { const d = window.__ink.store.mine[0]; d.lvl = 3; d.xp = 0; localStorage.setItem('inkmonsters.v1', JSON.stringify(window.__ink.store)); return 1; })()`);
  await go(BASE);
  await tap('#mineList .row');
  ok(!(await js('document.getElementById("evolveBtn").hidden')), 'LV 3 unlocks Evolve');
  await tap('#evolveBtn');
  ok((await screenIs()) === 'draw' && (await js('document.getElementById("drawTitle").textContent')).startsWith('Evolve'), 'Evolve opens the pad on top of the old drawing');
  await tool('tail');
  await stroke([[260, 540], [180, 560], [120, 520], [100, 460]]);
  await tool('wings');
  await stroke([[420, 300], [380, 180], [300, 160], [330, 260], [420, 300]]);
  await tool('legs');
  await stroke(line(500, 640, 500, 800));
  await stroke(line(560, 640, 580, 800)); // a 4th new part: should be refused
  const evoDraw = await js(`({ legs: window.__ink.drawing.legs.length, tail: window.__ink.drawing.parts.tail.length, wings: window.__ink.drawing.parts.wings.length })`);
  ok(evoDraw.tail === 1 && evoDraw.wings === 1 && evoDraw.legs === 5, `evolving adds at most 3 new parts ${JSON.stringify(evoDraw)}`);
  await shot('phone-evolve-draw.png');
  await tap('#nextBtn');
  await tap('#lifeBtn');
  await sleep(2200);
  await shot('phone-evolved.png');
  const evo = await js(`(() => { const d = window.__ink.store.mine[0]; return { evo: d.evo, kicker: document.getElementById('monKicker').textContent, tail: d.parts.tail.length, wings: d.parts.wings.length, ready: !document.getElementById('evolveBtn').hidden }; })()`);
  ok(evo.evo === 1 && evo.kicker === 'Evolved!' && evo.tail === 1 && evo.wings === 1 && !evo.ready, 'evolution saves the new parts and uses up the evolve');

  // shop
  await js('window.__ink.grant(100); 1');
  await tap('#monBack');
  await tap('#drawBtn');
  await stroke(circle(500, 480, 200, 170));
  await tap('#nextBtn');
  await tap('#tintRow button:nth-child(6)');
  await tap('#tintRow button:nth-child(6)');
  const shop = await js(`({ owned: window.__ink.store.owned.tints.includes(5), drops: window.__ink.store.drops })`);
  ok(shop.owned, `two taps buy a color (drops now ${shop.drops})`);
  await tap('#lifeBtn');
  await sleep(600);

  // share link round trip keeps parts and ink
  const link = await js(`(async () => { const c = await import('./js/codec.js'); const d = window.__ink.store.mine.find((x) => x.evo === 1); return location.origin + location.pathname + '#m=' + await c.encodeMonster({ ...d, name: 'Linkzilla' }); })()`);
  console.log('      link length:', link.length);
  await js(`localStorage.setItem('inkmonsters.v1', JSON.stringify({ mine: [], challengers: [], seq: 0, muted: false }))`);
  await send('Page.navigate', { url: 'about:blank' }); await sleep(300);
  await go(link);
  await sleep(1500);
  const inc = await js(`(() => { const d = window.__ink.store.challengers[0]; return { scr: window.__ink.screen, name: document.getElementById('nameInput').value, tail: d && d.parts.tail.length, ink: d && d.ink, lvl: d && d.lvl, hash: location.hash }; })()`);
  ok(inc.scr === 'mon' && inc.name === 'Linkzilla' && inc.tail === 1 && inc.ink === 'fire' && inc.lvl === 3 && inc.hash === '', `a share link carries parts, ink and level ${JSON.stringify(inc)}`);

  // ---------- desktop ----------
  MOBILE = false;
  await viewport(1440, 900, false);
  await go(BASE);
  await sleep(900);
  await shot('desktop-home.png');
  await tap('#mineList .row .btn'); // fight the challenger: no monsters yet, so it opens the pad
  ok((await screenIs()) === 'draw', 'fighting a challenger with no monsters opens the pad');
  await stroke(circle(500, 500, 220, 180, 36));
  await tap('#nextBtn'); await tap('#lifeBtn');
  await sleep(1500);
  ok((await js('document.getElementById("fightBtn").textContent')) === 'Fight Linkzilla', 'the new monster goes straight at the challenger');
  await tap('#fightBtn');
  ok((await screenIs()) === 'battle', 'desktop battle starts');
  const f2 = await fight('desktop', { keys: true });
  ok(!(await js('document.getElementById("result").hidden')), `desktop battle finishes with number keys and Space (${f2.turns} turns)`);
  await tap('#resHome');
  await js(`(() => { window.__ink.store.stars['0-0'] = 3; window.__ink.store.stars['0-1'] = 2; localStorage.setItem('inkmonsters.v1', JSON.stringify(window.__ink.store)); return 1; })()`);
  await go(BASE);
  await tap('#advBtn');
  await sleep(500);
  await shot('desktop-map.png');
  ok((await js('document.querySelectorAll(".node:not(:disabled)").length')) === 3, 'stars open the next fights on the map');

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
  if (errors.length) console.log('page errors:', errors.join('\n'));
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
  process.exitCode = fails.length ? 1 : 0;
}
