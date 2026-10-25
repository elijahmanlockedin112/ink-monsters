import { clamp, ease, hashData, lerp, monsterName, simplify, strokeLen } from './geom.js';
import { INK, MOVES, SIGNAL, TINTS, autoEyes, drawMonster, makeMonster, newState, updateState } from './monster.js';
import { cry, isMuted, setMuted, sfx, unlock } from './audio.js';
import { decodeMonster, encodeMonster } from './codec.js';
import { rivals } from './rivals.js';

const $ = (id) => document.getElementById(id);
const DPR = () => Math.min(window.devicePixelRatio || 1, 2.5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DISPLAY_FONT = getComputedStyle(document.documentElement).getPropertyValue('--display').trim() || 'sans-serif';

// ---------- saved state ----------
const KEY = 'inkmonsters.v1';
let store = { mine: [], challengers: [], seq: 0, muted: false };
try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && Array.isArray(s.mine)) store = { ...store, ...s }; } catch { /* fresh start */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* storage full or blocked */ } };
const RIVALS = rivals();
setMuted(!!store.muted);

const cache = new Map();
function mon(d) {
  let m = cache.get(d.id);
  if (!m || m.data !== d) { m = makeMonster(d); m.faceSign = faceSign(m); cache.set(d.id, m); }
  return m;
}
// which way the drawing "looks": toward the side its eyes sit on
function faceSign(m) {
  const eyes = m.data.eyes;
  if (!eyes.length) return 1;
  const ex = eyes.reduce((a, e) => a + e.x, 0) / eyes.length;
  return ex < m.bb.cx - 8 ? -1 : 1;
}
const findData = (id) => store.mine.find((d) => d.id === id) || store.challengers.find((d) => d.id === id) || RIVALS.find((d) => d.id === id);

// ---------- tiny tween runner (driven by the frame loop) ----------
const tweens = [];
function tween(ms, fn) {
  return new Promise((res) => tweens.push({ t0: performance.now(), ms, fn, res }));
}
function runTweens(now) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    const k = clamp((now - tw.t0) / tw.ms, 0, 1);
    tw.fn(k);
    if (k >= 1) { tweens.splice(i, 1); tw.res(); }
  }
}

function fit(cv, w, h) {
  const d = DPR();
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  cv.width = Math.round(w * d); cv.height = Math.round(h * d);
  const g = cv.getContext('2d');
  g.setTransform(d, 0, 0, d, 0, 0);
  return g;
}

// ---------- stage: a strip of paper with a ground line where monsters live ----------
class Stage {
  constructor(cv) { this.cv = cv; this.actors = []; this.fx = []; this.stains = []; this.shake = 0; this.w = 0; this.h = 0; }
  resize(w, h, groundFrac = 0.84) {
    this.g = fit(this.cv, w, h); this.w = w; this.h = h; this.gy = Math.round(h * groundFrac);
    const r = Math.random;
    this.ground = [];
    for (let x = -4; x <= w + 8; x += 14) this.ground.push([x, this.gy + (r() - 0.5) * 1.6]);
    this.ticks = [];
    for (let x = 10; x < w; x += 18 + r() * 26) this.ticks.push([x, this.gy + 7 + r() * 10, 5 + r() * 9]);
    for (const a of this.actors) a.st.gy = this.gy;
  }
  scaleFor(mons, frac, hfrac = 0.62) {
    const mw = Math.max(...mons.map((m) => m.full.w)), mh = Math.max(...mons.map((m) => m.groundY - m.full.y));
    return Math.min((this.w * frac) / mw, (this.h * hfrac) / mh);
  }
  add(m, x, face) {
    const a = { mon: m, st: newState(m, x, this.gy, face), s: 1, home: x };
    this.actors.push(a);
    return a;
  }
  update(dt) {
    for (const a of this.actors) updateState(a.st, dt);
    this.shake *= Math.pow(0.0008, dt);
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life -= dt;
      if (f.kind === 'drop') {
        f.vy += 1300 * dt; f.x += f.vx * dt; f.y += f.vy * dt;
        if (f.y >= this.gy + 2) {
          if (this.stains.length > 140) this.stains.shift();
          this.stains.push({ x: f.x, y: this.gy + 3 + Math.random() * 6, r: f.r * 1.4, c: f.c });
          this.fx.splice(i, 1); continue;
        }
      } else if (f.kind === 'num') { f.y -= 46 * dt; }
      if (f.life <= 0) this.fx.splice(i, 1);
    }
  }
  draw() {
    const g = this.g, w = this.w, h = this.h;
    g.clearRect(0, 0, w, h);
    g.save();
    if (this.shake > 0.3) g.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    // ground
    g.strokeStyle = INK; g.lineWidth = 2; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    this.ground.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    g.lineWidth = 1.2; g.strokeStyle = 'rgba(29,26,23,0.35)';
    g.beginPath();
    for (const [x, y, l] of this.ticks) { g.moveTo(x, y); g.lineTo(x - l * 0.5, y + l * 0.35); }
    g.stroke();
    for (const s of this.stains) {
      g.fillStyle = s.c; g.globalAlpha = 0.85;
      g.beginPath(); g.ellipse(s.x, s.y, s.r * 1.6, s.r * 0.45, 0, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    // shadows, then monsters
    for (const a of this.actors) {
      const lift = clamp(-a.st.y / 160, 0, 1);
      g.fillStyle = 'rgba(29,26,23,0.10)';
      g.beginPath(); g.ellipse(a.st.x, this.gy + 1, a.mon.full.w * a.s * 0.36 * (1 - lift * 0.45), 5 * (1 - lift * 0.4), 0, 0, Math.PI * 2); g.fill();
    }
    for (const a of this.actors) drawMonster(g, a.mon, a.st, a.s);
    for (const f of this.fx) {
      if (f.kind === 'drop') {
        g.fillStyle = f.c; g.beginPath(); g.arc(f.x, f.y, f.r, 0, Math.PI * 2); g.fill();
      } else if (f.kind === 'num') {
        g.globalAlpha = clamp(f.life / 0.4, 0, 1);
        g.font = `800 ${f.size}px ${DISPLAY_FONT}`;
        g.textAlign = 'center';
        g.lineWidth = 5; g.strokeStyle = '#fbf8f1'; g.strokeText(f.text, f.x, f.y);
        g.fillStyle = f.c; g.fillText(f.text, f.x, f.y);
        g.globalAlpha = 1;
      }
    }
    g.restore();
  }
  hitTest(x, y) {
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const a = this.actors[i], m = a.mon;
      const hw = (m.full.w * a.s) / 2, top = (m.groundY - m.full.y) * a.s;
      if (x > a.st.x - hw - 10 && x < a.st.x + hw + 10 && y > this.gy - top - 10 && y < this.gy + 10) return a;
    }
    return null;
  }
  splash(x, y, dir, n, crit) {
    for (let i = 0; i < n; i++) {
      this.fx.push({
        kind: 'drop', x, y, r: 1.5 + Math.random() * 3.5,
        vx: dir * (80 + Math.random() * 320) + (Math.random() - 0.5) * 160, vy: -150 - Math.random() * 420,
        c: crit && i % 2 ? SIGNAL : INK, life: 3,
      });
    }
  }
  number(x, y, text, c, size) { this.fx.push({ kind: 'num', x, y, text, c, size, life: 1 }); }
}

const actorTop = (a) => a.st.gy - (a.mon.groundY - a.mon.full.y) * a.s;
const actorHeight = (a) => (a.mon.groundY - a.mon.full.y) * a.s;
const lean = (st, worldAngle) => { st.rot = worldAngle * st.face; };

async function hop(a, big = 1) {
  if (a.busy) return;
  a.busy = true;
  const h = actorHeight(a) * 0.22 * big;
  await tween(90, (k) => { a.st.sqy = -0.14 * k; a.st.sqx = 0.1 * k; });
  await tween(380, (k) => { a.st.y = -Math.sin(Math.PI * k) * h; a.st.sqy = lerp(0.1, 0, k); a.st.sqx = lerp(-0.06, 0, k); });
  a.st.y = 0;
  await tween(120, (k) => { a.st.sqy = -0.1 * Math.sin(Math.PI * k); a.st.sqx = 0.08 * Math.sin(Math.PI * k); });
  a.busy = false;
}

// ---------- screens ----------
let screen = 'home';
let active = null; // the stage drawn each frame
let wanderers = [];
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  screen = id;
  active = null;
  window.scrollTo(0, 0);
}

const homeStage = new Stage($('homeStage'));
const revealStage = new Stage($('revealStage'));
const arena = new Stage($('arena'));

function wrapWidth(el) { return Math.floor(el.getBoundingClientRect().width) - 3; }

// ---------- home ----------
function thumb(cv, d) {
  const m = mon(d);
  const g = fit(cv, 60, 60);
  const st = newState(m, 30, 0, m.faceSign);
  st.t = 0; st.nextBlink = 99;
  const s = 50 / Math.max(m.full.w, m.groundY - m.full.y);
  st.gy = 30 + ((m.groundY - m.full.y) * s) / 2;
  drawMonster(g, m, st, s);
}

function row(d, { tag = '', button = 'Fight', onButton, onRow } = {}) {
  const m = mon(d);
  const li = document.createElement('li');
  li.className = 'row';
  const cv = document.createElement('canvas'); cv.className = 'thumb';
  const text = document.createElement('div'); text.className = 'row-text';
  const b = document.createElement('b'); b.textContent = d.name;
  const sp = document.createElement('span');
  sp.innerHTML = (tag ? `<span class="tag">${tag}</span> · ` : '') + `${m.moveName} · HP ${m.stats.hp}`;
  text.append(b, sp);
  li.append(cv, text);
  if (button) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-small'; btn.textContent = button;
    btn.addEventListener('click', (e) => { e.stopPropagation(); unlock(); sfx('tap'); onButton(); });
    li.append(btn);
  }
  li.addEventListener('click', () => { unlock(); sfx('tap'); onRow(); });
  thumb(cv, d);
  return li;
}

function renderHome() {
  show('home');
  $('mineBlock').hidden = !store.mine.length;
  const ml = $('mineList'); ml.textContent = '';
  for (const d of store.mine) {
    const rec = d.w || d.l ? `${d.w}W ${d.l}L` : '';
    ml.append(row(d, { tag: rec, onButton: () => openPick('opponent', d), onRow: () => openReveal(d, 'mine') }));
  }
  const rl = $('rivalList'); rl.textContent = '';
  for (const d of store.challengers) rl.append(row(d, { tag: 'From a link', onButton: () => fightAs(d), onRow: () => openReveal(d, 'challenger') }));
  for (const d of RIVALS) rl.append(row(d, { tag: 'House', onButton: () => fightAs(d), onRow: () => openReveal(d, 'rival') }));
  $('drawBtn').textContent = store.mine.length ? 'Draw another' : 'Draw a monster';

  const w = wrapWidth($('homeStage').parentElement);
  homeStage.actors = [];
  homeStage.fx = []; homeStage.stains = [];
  homeStage.resize(w, Math.round(clamp(w * 0.5, 190, 300)));
  const cast = [...store.mine.slice(0, 2), ...RIVALS].slice(0, 3);
  const mons = cast.map(mon);
  const s = homeStage.scaleFor(mons, 0.27, 0.6);
  wanderers = mons.map((m, i) => {
    const a = homeStage.add(m, w * (0.2 + i * 0.3), m.faceSign);
    a.s = s; a.target = a.st.x; a.rest = 0.5 + i;
    return a;
  });
  active = homeStage;
}

function wander(dt) {
  for (const a of wanderers) {
    if (a.busy) continue;
    const dx = a.target - a.st.x;
    if (Math.abs(dx) < 3) {
      a.st.walk = Math.max(0, a.st.walk - dt * 5);
      a.rest -= dt;
      if (a.rest <= 0) {
        a.target = homeStage.w * (0.12 + Math.random() * 0.76);
        a.rest = 1.2 + Math.random() * 2.8;
      }
    } else {
      const sp = 45 + a.mon.stats.spd * 0.9;
      a.st.x += Math.sign(dx) * Math.min(Math.abs(dx), sp * dt);
      a.st.walk = Math.min(1, a.st.walk + dt * 5);
      a.st.face = Math.sign(dx) * a.mon.faceSign;
      a.st.lookX = Math.sign(dx);
    }
  }
}

function stageTap(stage, e) {
  unlock();
  const r = stage.cv.getBoundingClientRect();
  const a = stage.hitTest(e.clientX - r.left, e.clientY - r.top);
  if (!a) return;
  cry(a.mon);
  hop(a);
}
$('homeStage').addEventListener('pointerdown', (e) => stageTap(homeStage, e));
$('revealStage').addEventListener('pointerdown', (e) => stageTap(revealStage, e));

$('drawBtn').addEventListener('click', () => { unlock(); sfx('tap'); startDraw(); });
$('muteBtn').addEventListener('click', () => {
  unlock();
  store.muted = !isMuted(); setMuted(store.muted); save(); muteIcon(); sfx('tap');
});
function muteIcon() {
  $('muteBtn').querySelector('use').setAttribute('href', isMuted() ? '#i-mute' : '#i-sound');
  $('muteBtn').setAttribute('aria-label', isMuted() ? 'Sound off' : 'Sound on');
}
muteIcon();

// ---------- drawing ----------
const D = { step: 'body', data: null, cur: null, pen: false, size: 0, active: null, eyeEdit: null, preview: null, opponent: null };
const dcv = $('drawCanvas');
let dg = null;

function startDraw(opponent = null) {
  D.data = { body: [], legs: [], eyes: [], tint: Math.floor(Math.random() * TINTS.length) };
  D.step = 'body'; D.cur = null; D.preview = null; D.opponent = opponent;
  show('draw');
  sizeDraw();
  setStep('body');
}

function sizeDraw() {
  const wrap = $('padWrap');
  const w = wrapWidth(wrap) + 3;
  const size = Math.floor(Math.min(w, window.innerHeight - 270, 680));
  D.size = Math.max(240, size);
  dg = fit(dcv, D.size, D.size);
  renderDraw();
}

const HINTS = {
  body: 'Draw the body. Close the outline and it gets colored in.',
  legs: 'Add legs, one line each, starting at the body. No legs and it rolls instead.',
  eyes: 'Tap to stick on googly eyes. Drag to make one bigger, tap it again to pull it off.',
};

function setStep(step) {
  D.step = step;
  const order = ['body', 'legs', 'eyes'];
  for (const li of $('steps').children) {
    const i = order.indexOf(li.dataset.step), j = order.indexOf(step);
    li.className = i === j ? 'now' : i < j ? 'done' : '';
  }
  $('drawHint').textContent = HINTS[step];
  $('tintRow').hidden = step !== 'eyes';
  if (step === 'eyes') { D.preview = makeMonster({ ...D.data, eyes: [] }); buildTints(); }
  updateNext();
  renderDraw();
}

function updateNext() {
  const b = $('nextBtn');
  if (D.step === 'body') {
    b.textContent = 'Next: legs';
    b.disabled = !D.data.body.some((s) => strokeLen(s) > 60) && D.data.body.length < 3;
  } else if (D.step === 'legs') {
    b.textContent = D.data.legs.length ? 'Next: eyes' : 'No legs, next';
    b.disabled = false;
  } else {
    b.textContent = 'Bring it to life';
    b.disabled = false;
  }
}

function buildTints() {
  const row = $('tintRow'); row.textContent = '';
  TINTS.forEach((c, i) => {
    const b = document.createElement('button');
    b.style.background = c;
    b.setAttribute('aria-label', `Color ${i + 1}`);
    if (i === D.data.tint) b.className = 'on';
    b.addEventListener('click', () => {
      D.data.tint = i; sfx('tap');
      D.preview = makeMonster({ ...D.data, eyes: [] });
      buildTints(); renderDraw();
    });
    row.append(b);
  });
}

function toUnits(e) {
  const r = dcv.getBoundingClientRect();
  return { x: clamp(((e.clientX - r.left) / r.width) * 1000, 0, 1000), y: clamp(((e.clientY - r.top) / r.height) * 1000, 0, 1000) };
}

function penWidth(e, speed) {
  if (e.pointerType === 'pen' && e.pressure > 0) return 6 + e.pressure * 16;
  return clamp(16 - speed * 3.2, 7, 16);
}

function strokeSeg(g, a, b, k, color) {
  g.strokeStyle = color;
  g.lineWidth = ((a[2] + b[2]) / 2) * k;
  g.beginPath(); g.moveTo(a[0] * k, a[1] * k); g.lineTo(b[0] * k, b[1] * k); g.stroke();
}
function strokeAll(g, s, k, color) {
  if (s.length === 1) { g.fillStyle = color; g.beginPath(); g.arc(s[0][0] * k, s[0][1] * k, (s[0][2] * k) / 2, 0, Math.PI * 2); g.fill(); return; }
  for (let i = 1; i < s.length; i++) strokeSeg(g, s[i - 1], s[i], k, color);
}

function renderDraw() {
  if (!dg) return;
  const k = D.size / 1000, g = dg;
  g.clearRect(0, 0, D.size, D.size);
  g.fillStyle = 'rgba(29,26,23,0.13)';
  for (let x = 50; x < 1000; x += 50) for (let y = 50; y < 1000; y += 50) { g.beginPath(); g.arc(x * k, y * k, 1, 0, Math.PI * 2); g.fill(); }
  g.lineCap = g.lineJoin = 'round';
  if (D.step === 'eyes' && D.preview) {
    g.globalAlpha = 0.92;
    g.drawImage(D.preview.sil.canvas, 0, 0, D.size, D.size);
    g.globalAlpha = 1;
  }
  const bodyColor = D.step === 'legs' ? 'rgba(29,26,23,0.42)' : INK;
  for (const s of D.data.body) strokeAll(g, s, k, bodyColor);
  for (const s of D.data.legs) strokeAll(g, s, k, INK);
  if (D.cur) strokeAll(g, D.cur, k, INK);
  for (const e of D.data.eyes) {
    g.fillStyle = '#fffdf8'; g.strokeStyle = INK; g.lineWidth = Math.max(e.r * 0.16 * k, 1.3);
    g.beginPath(); g.arc(e.x * k, e.y * k, e.r * k, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = INK;
    g.beginPath(); g.arc(e.x * k, (e.y + e.r * 0.2) * k, e.r * 0.48 * k, 0, Math.PI * 2); g.fill();
  }
}

dcv.addEventListener('pointerdown', (e) => {
  unlock();
  if (e.pointerType === 'pen') D.pen = true;
  if (D.pen && e.pointerType === 'touch') return; // palm on the glass while using the Pencil
  if (D.active !== null) return;
  e.preventDefault();
  const p = toUnits(e);
  D.active = e.pointerId;
  try { dcv.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  if (D.step === 'eyes') {
    const hitIdx = D.data.eyes.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) <= q.r + 6);
    if (hitIdx >= 0) { D.eyeEdit = { idx: hitIdx, remove: true, x0: p.x, y0: p.y }; return; }
    if (D.data.eyes.length >= 8) { D.active = null; return; }
    const bb = D.preview ? D.preview.bb : { w: 400, h: 400 };
    const r = Math.round(clamp(Math.min(bb.w, bb.h) * 0.11, 22, 60));
    D.data.eyes.push({ x: Math.round(p.x), y: Math.round(p.y), r });
    D.eyeEdit = { idx: D.data.eyes.length - 1, remove: false, x0: p.x, y0: p.y, r0: r };
    sfx('eye');
    renderDraw();
    return;
  }
  D.cur = [[Math.round(p.x), Math.round(p.y), penWidth(e, 0)]];
  D.last = { t: e.timeStamp, x: p.x, y: p.y, w: D.cur[0][2] };
  renderDraw();
});

dcv.addEventListener('pointermove', (e) => {
  if (e.pointerId !== D.active) return;
  e.preventDefault();
  if (D.eyeEdit) {
    const p = toUnits(e), ed = D.eyeEdit, eye = D.data.eyes[ed.idx];
    const d = Math.hypot(p.x - ed.x0, p.y - ed.y0);
    if (d > 14) {
      if (ed.remove) { ed.remove = false; ed.r0 = eye.r; }
      eye.r = Math.round(clamp(ed.r0 + d * 0.6, 16, 110));
      renderDraw();
    }
    return;
  }
  if (!D.cur) return;
  const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
  const list = evs.length ? evs : [e];
  const k = D.size / 1000;
  dg.lineCap = 'round';
  for (const ev of list) {
    const p = toUnits(ev);
    const dist = Math.hypot(p.x - D.last.x, p.y - D.last.y);
    if (dist < 2.5) continue;
    if (D.cur.length > 1500) break;
    const dt = Math.max(1, ev.timeStamp - D.last.t);
    const target = penWidth(ev, dist / dt);
    const w = ev.pointerType === 'pen' ? target : D.last.w * 0.75 + target * 0.25;
    const pt = [Math.round(p.x), Math.round(p.y), Math.round(w * 4) / 4];
    strokeSeg(dg, D.cur[D.cur.length - 1], pt, k, INK);
    D.cur.push(pt);
    D.last = { t: ev.timeStamp, x: p.x, y: p.y, w };
  }
});

function endStroke(e) {
  if (e.pointerId !== D.active) return;
  D.active = null;
  if (D.eyeEdit) {
    if (D.eyeEdit.remove) { D.data.eyes.splice(D.eyeEdit.idx, 1); sfx('tap'); }
    D.eyeEdit = null;
    renderDraw();
    return;
  }
  const s = D.cur; D.cur = null;
  if (!s) return;
  const pts = s.length > 2 ? simplify(s, 1.2) : s;
  if (D.step === 'body') D.data.body.push(pts);
  else if (D.step === 'legs' && strokeLen(pts) >= 30 && D.data.legs.length < 8) D.data.legs.push(pts);
  sfx('ink');
  renderDraw();
  updateNext();
}
dcv.addEventListener('pointerup', endStroke);
dcv.addEventListener('pointercancel', endStroke);

$('undoBtn').addEventListener('click', () => {
  sfx('tap');
  const list = D.data[D.step];
  if (list.length) list.pop();
  else if (D.step === 'eyes') setStep('legs');
  else if (D.step === 'legs') setStep('body');
  renderDraw(); updateNext();
});
$('drawClose').addEventListener('click', () => { sfx('tap'); renderHome(); });

$('nextBtn').addEventListener('click', () => {
  unlock(); sfx('tap');
  if (D.step === 'body') setStep('legs');
  else if (D.step === 'legs') setStep('eyes');
  else finishDraw();
});

let pendingOpp = null; // set when someone drew a monster to answer a challenger
function finishDraw() {
  const d = D.data;
  pendingOpp = D.opponent;
  if (!d.eyes.length) d.eyes = autoEyes(d);
  d.name = monsterName(hashData(d));
  d.id = 'm' + Date.now().toString(36);
  store.seq += 1;
  d.no = store.seq; d.w = 0; d.l = 0;
  store.mine.unshift(d);
  save();
  openReveal(d, 'new');
}

// ---------- reveal / monster page ----------
let shown = null, shownMode = '';
function openReveal(d, mode) {
  shown = d; shownMode = mode;
  show('reveal');
  const m = mon(d);
  const own = mode === 'new' || mode === 'mine';
  $('revealTitle').textContent = own ? `No. ${String(d.no || 0).padStart(3, '0')}` : mode === 'rival' ? 'House monster' : 'Challenger';
  $('revealKicker').hidden = mode !== 'incoming';
  $('shareBtn').hidden = !own;
  const ni = $('nameInput');
  ni.value = d.name; ni.readOnly = !own;
  $('moveName').textContent = m.moveName;
  $('statHp').textContent = m.stats.hp; $('statPow').textContent = m.stats.pow; $('statSpd').textContent = m.stats.spd;
  for (const [id, v, max] of [['barHp', m.stats.hp, 140], ['barPow', m.stats.pow, 44], ['barSpd', m.stats.spd, 95]]) {
    const el = $(id); el.style.transition = 'none'; el.style.width = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = ''; el.style.width = `${Math.round((v / max) * 100)}%`; }));
  }
  $('whyText').textContent = m.why.join(' ');
  $('recordText').textContent = own && (d.w || d.l) ? `${d.w} win${d.w === 1 ? '' : 's'}, ${d.l} loss${d.l === 1 ? '' : 'es'}` : '';
  $('fightBtn').textContent = mode === 'new' && pendingOpp ? `Fight ${pendingOpp.name}`
    : own ? 'Fight' : store.mine.length ? 'Fight it' : 'Draw one to fight it';
  const del = $('deleteBtn');
  del.hidden = mode === 'rival';
  del.textContent = own ? 'Delete' : 'Remove';
  del.dataset.armed = '';

  const w = wrapWidth($('revealStage').parentElement);
  revealStage.actors = []; revealStage.fx = []; revealStage.stains = [];
  revealStage.resize(w, Math.round(clamp(w * 0.72, 240, 440)));
  const a = revealStage.add(m, -w * 0.3, m.faceSign);
  a.s = revealStage.scaleFor([m], 0.5, 0.72);
  active = revealStage;
  const fresh = mode === 'new' || mode === 'incoming';
  (async () => {
    a.busy = true;
    a.st.walk = 1;
    await tween(fresh ? 1300 : 800, (k) => { a.st.x = lerp(-w * 0.3, w * 0.5, ease.out(k)); a.st.walk = 1 - k * 0.7; });
    a.st.walk = 0; a.busy = false;
    if (shown !== d) return;
    cry(m);
    hop(a, fresh ? 1.6 : 1);
  })();
}

$('nameInput').addEventListener('input', (e) => {
  if (!shown || e.target.readOnly) return;
  shown.name = e.target.value.trim().slice(0, 16) || shown.name;
  save();
});
$('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('revealBack').addEventListener('click', () => { sfx('tap'); renderHome(); });
$('shareBtn').addEventListener('click', () => { unlock(); sfx('tap'); share(shown); });
$('fightBtn').addEventListener('click', () => {
  unlock(); sfx('tap');
  const own = shownMode === 'new' || shownMode === 'mine';
  if (shownMode === 'new' && pendingOpp) { const o = pendingOpp; pendingOpp = null; startBattle(shown, o); }
  else if (own) openPick('opponent', shown);
  else fightAs(shown);
});
$('deleteBtn').addEventListener('click', (e) => {
  const b = e.currentTarget;
  if (!b.dataset.armed) {
    b.dataset.armed = '1'; b.textContent = 'Tap again to delete';
    setTimeout(() => { if (b.dataset.armed) { b.dataset.armed = ''; b.textContent = shownMode === 'mine' || shownMode === 'new' ? 'Delete' : 'Remove'; } }, 3000);
    return;
  }
  store.mine = store.mine.filter((d) => d !== shown);
  store.challengers = store.challengers.filter((d) => d !== shown);
  cache.delete(shown.id);
  save();
  renderHome();
});

// ---------- picking who fights ----------
let pickCtx = null;
function fightAs(opponent) {
  if (!store.mine.length) { startDraw(opponent); return; }
  if (store.mine.length === 1) { startBattle(store.mine[0], opponent); return; }
  openPick('fighter', opponent);
}
function openPick(kind, fixed) {
  pickCtx = { kind, fixed };
  show('pick');
  $('pickTitle').textContent = kind === 'opponent' ? 'Pick an opponent' : 'Pick your fighter';
  const list = $('pickList'); list.textContent = '';
  const options = kind === 'opponent'
    ? [...store.challengers.map((d) => [d, 'From a link']), ...RIVALS.map((d) => [d, 'House']), ...store.mine.filter((d) => d !== fixed).map((d) => [d, 'Yours'])]
    : store.mine.map((d) => [d, d.w || d.l ? `${d.w}W ${d.l}L` : '']);
  for (const [d, tag] of options) {
    const go = () => (kind === 'opponent' ? startBattle(fixed, d) : startBattle(d, fixed));
    list.append(row(d, { tag, button: 'Pick', onButton: go, onRow: go }));
  }
}
$('pickBack').addEventListener('click', () => { sfx('tap'); renderHome(); });

// ---------- battle ----------
let B = null;
const ABORT = Symbol('abort');
let meterTick = null, meterTap = null;

function plate(el, f) {
  el.querySelector('.pname').textContent = f.d.name;
  el.querySelector('.php').textContent = `${Math.max(0, f.hp)}/${f.max}`;
  el.querySelector('em').style.width = `${clamp((f.hp / f.max) * 100, 0, 100)}%`;
  el.classList.toggle('low', f.hp / f.max < 0.3);
}

function startBattle(pd, od) {
  unlock();
  show('battle');
  $('result').hidden = true; $('actionPad').hidden = false;
  const w = wrapWidth($('arenaWrap'));
  // the arena takes whatever height the plates and the meter leave, so the page has no dead gap
  const h = Math.round(clamp(Math.min(w * 1.15, window.innerHeight - 300), 220, 560));
  arena.actors = []; arena.fx = []; arena.stains = [];
  arena.resize(w, h, 0.8);
  const P = mon(pd), O = mon(od);
  const s = arena.scaleFor([P, O], 0.37, 0.5);
  const pa = arena.add(P, -w * 0.3, P.faceSign);
  const oa = arena.add(O, w * 1.3, -O.faceSign);
  pa.s = oa.s = s;
  pa.home = w * 0.27; oa.home = w * 0.73;
  pa.st.lookX = 1; oa.st.lookX = -1;
  const b = { pd, od, P: { a: pa, mon: P, d: pd, hp: P.stats.hp, max: P.stats.hp }, O: { a: oa, mon: O, d: od, hp: O.stats.hp, max: O.stats.hp } };
  B = b;
  plate($('plateA'), b.P); plate($('plateB'), b.O);
  active = arena;
  setAction('', false);
  run(b).catch((err) => { if (err !== ABORT) console.error(err); });
}

const check = (b) => { if (B !== b) throw ABORT; };
function setAction(text, live, btn) {
  $('actionText').textContent = text;
  $('actionPad').classList.toggle('live', live);
  if (btn) $('actionBtn').textContent = btn;
}

function stamp(text, kind) {
  const el = $('stamp');
  el.textContent = text;
  el.className = 'stamp' + (kind === 'solid' ? ' solid' : kind === 'grey' ? ' grey' : '');
  void el.offsetWidth;
  el.classList.add('show');
  sfx('stamp');
}

async function run(b) {
  const { P, O } = b, w = arena.w;
  P.a.st.walk = O.a.st.walk = 1;
  setAction(`${P.d.name} vs ${O.d.name}`, false, 'Strike');
  await tween(1200, (k) => {
    const e = ease.out(k);
    P.a.st.x = lerp(-w * 0.3, P.a.home, e); O.a.st.x = lerp(w * 1.3, O.a.home, e);
    P.a.st.walk = O.a.st.walk = 1 - k * 0.6;
  });
  P.a.st.walk = O.a.st.walk = 0;
  check(b);
  cry(P.mon); hop(P.a); await wait(650); check(b);
  cry(O.mon); hop(O.a); await wait(700); check(b);
  let att = P.mon.stats.spd >= O.mon.stats.spd ? P : O;
  while (P.hp > 0 && O.hp > 0) {
    await turn(b, att, att === P ? O : P);
    check(b);
    att = att === P ? O : P;
  }
}

function meter(b, mode) {
  const spd = b.P.mon.stats.spd;
  const crit = 0.1 + (spd / 95) * 0.1, good = crit * 2.7;
  const center = 0.3 + Math.random() * 0.4;
  const zg = $('zoneGood'), zc = $('zoneCrit'), needle = $('needle');
  zg.style.left = `${(center - good / 2) * 100}%`; zg.style.width = `${good * 100}%`;
  zc.style.left = `${(center - crit / 2) * 100}%`; zc.style.width = `${crit * 100}%`;
  const speed = mode === 'strike' ? 1.15 : 1.3;
  let pos = 0, dir = 1, sweeps = 0;
  needle.style.left = '0%';
  return new Promise((res) => {
    const done = () => {
      meterTick = meterTap = null;
      const off = Math.abs(pos - center);
      const grade = off <= crit / 2 ? 'crit' : off <= good / 2 ? 'good' : 'miss';
      setAction($('actionText').textContent, false);
      res(grade);
    };
    meterTap = done;
    meterTick = (dt) => {
      if (B !== b) { meterTick = meterTap = null; return; }
      pos += dir * dt * speed;
      if (pos > 1) { pos = 2 - pos; dir = -1; sweeps++; }
      if (pos < 0) { pos = -pos; dir = 1; sweeps++; }
      needle.style.left = `${pos * 100}%`;
      if (sweeps >= 4) done();
    };
  });
}

function actionPress(e) {
  if (!meterTap) return;
  if (e) e.preventDefault();
  unlock();
  sfx('tap');
  const btn = $('actionBtn');
  btn.classList.add('pressed'); setTimeout(() => btn.classList.remove('pressed'), 110);
  meterTap();
}
$('actionPad').addEventListener('pointerdown', actionPress);
window.addEventListener('keydown', (e) => {
  if (screen === 'battle' && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); actionPress(); }
});

async function turn(b, att, def) {
  const playerAttacks = att === b.P;
  let atkMult, defMult = 1, crit = false, blocked = false;
  if (playerAttacks) {
    setAction(`Your move. Stop the needle in the red.`, true, 'Strike');
    const g = await meter(b, 'strike');
    check(b);
    atkMult = { crit: 1.5, good: 1, miss: 0.6 }[g];
    crit = g === 'crit';
    stamp({ crit: 'Crit!', good: 'Hit', miss: 'Weak' }[g], g === 'crit' ? 'solid' : g === 'miss' ? 'grey' : '');
    setAction(`${att.d.name} uses ${att.mon.moveName}`, false);
  } else {
    setAction(`${att.d.name} is winding up. Stop the needle in the red to block!`, true, 'Block');
    const windup = (k) => { att.a.st.tilt = Math.sin(performance.now() / 45) * 0.035; };
    const tick = setInterval(() => windup(), 16);
    const g = await meter(b, 'block');
    clearInterval(tick); att.a.st.tilt = 0;
    check(b);
    const r = Math.random();
    const ai = r < 0.22 ? 'crit' : r < 0.8 ? 'good' : 'miss';
    atkMult = { crit: 1.5, good: 1, miss: 0.6 }[ai];
    defMult = { crit: 0.35, good: 0.7, miss: 1 }[g];
    blocked = g !== 'miss';
    crit = ai === 'crit' && !blocked;
    stamp({ crit: 'Blocked!', good: 'Block', miss: 'Ouch' }[g], g === 'crit' ? 'solid' : g === 'miss' ? 'grey' : '');
    setAction(`${att.d.name} uses ${att.mon.moveName}`, false);
  }
  await wait(380); check(b);
  const per = att.mon.stats.pow * MOVES[att.mon.move].mult * atkMult * defMult;
  const impact = async () => {
    const dmg = Math.max(1, Math.round(per * (0.9 + Math.random() * 0.2)));
    hit(b, att, def, dmg, crit, blocked && defMult < 0.5);
    await wait(crit ? 120 : 60);
  };
  await MOVE_ANIM[att.mon.move](b, att.a, def.a, impact);
  check(b);
  if (def.hp <= 0) await ko(b, att, def);
  else await wait(250);
}

function hit(b, att, def, dmg, crit, hardBlock) {
  def.hp = Math.max(0, def.hp - dmg);
  plate($(def === b.P ? 'plateA' : 'plateB'), def);
  const dir = Math.sign(def.a.st.x - att.a.st.x) || 1;
  const da = def.a;
  da.st.flash = 1;
  const cx = da.st.x - dir * (da.mon.full.w * da.s) * 0.35, cy = da.st.gy - actorHeight(da) * 0.55;
  arena.splash(cx, cy, dir, crit ? 22 : hardBlock ? 5 : 12, crit);
  arena.number(da.st.x, actorTop(da) - 8, String(dmg), crit ? SIGNAL : INK, crit ? 38 : 28);
  arena.shake = crit ? 14 : hardBlock ? 3 : 7;
  sfx(hardBlock ? 'block' : crit ? 'crit' : 'hit', crit ? 1 : 0.8);
  if (!hardBlock) cry(def.mon, { pitch: 1.7, len: 0.28 });
  const x0 = da.st.x, push = dir * arena.w * (crit ? 0.05 : 0.03);
  tween(320, (k) => { da.st.x = x0 + push * Math.sin(Math.PI * Math.min(1, k * 1.3)) * (1 - k * 0.4); lean(da.st, -dir * 0.2 * Math.sin(Math.PI * k)); })
    .then(() => { if (!def.hp) return; da.st.x = da.home; da.st.rot = 0; });
}

async function ko(b, att, def) {
  const dir = Math.sign(def.a.st.x - att.a.st.x) || 1;
  const da = def.a;
  da.st.ko = 1;
  // lying on its side, the body's half-width is what touches the ground
  const m = da.mon, drop = (m.groundY - (m.bb.cy + m.bb.w / 2)) * da.s;
  await tween(520, (k) => { lean(da.st, dir * (Math.PI / 2) * ease.back(k) * 0.92); da.st.y = drop * ease.in(k) - Math.sin(Math.PI * k) * 18; });
  da.st.y = drop;
  sfx('land'); arena.shake = 10;
  const playerWon = att === b.P;
  sfx(playerWon ? 'win' : 'lose');
  await wait(300);
  cry(att.mon, { pitch: 1.15 });
  await hop(att.a, 1.4); await hop(att.a, 1);
  check(b);
  // records only count for your own monsters
  if (store.mine.includes(b.P.d)) { if (playerWon) b.P.d.w = (b.P.d.w || 0) + 1; else b.P.d.l = (b.P.d.l || 0) + 1; }
  if (store.mine.includes(b.O.d) && b.O.d !== b.P.d) { if (playerWon) b.O.d.l = (b.O.d.l || 0) + 1; else b.O.d.w = (b.O.d.w || 0) + 1; }
  save();
  $('actionPad').hidden = true;
  $('result').hidden = false;
  const t = $('resultTitle');
  t.textContent = `${att.d.name} wins`;
  t.className = 'result-title' + (playerWon ? ' won' : '');
  const pw = b.P.d.w || 0;
  $('resultSub').textContent = playerWon
    ? (store.mine.includes(b.P.d) ? (pw === 1 ? `First win for ${b.P.d.name}.` : `That's ${pw} wins for ${b.P.d.name}.`) : 'Nice timing.')
    : `${b.O.d.name} had ${b.O.hp} HP left. Block on the red to soak up hits.`;
}

const MOVE_ANIM = {
  async rush(b, a, d, impact) {
    const dir = Math.sign(d.st.x - a.st.x), home = a.home, w = arena.w;
    const cx = d.st.x - dir * (a.mon.full.w * a.s + d.mon.full.w * d.s) * 0.42;
    await tween(260, (k) => { a.st.x = home - dir * w * 0.04 * ease.out(k); a.st.sqx = 0.12 * k; a.st.sqy = -0.1 * k; lean(a.st, -dir * 0.16 * k); });
    sfx('whoosh');
    const x1 = a.st.x;
    await tween(150, (k) => { a.st.x = lerp(x1, cx, ease.in(k)); a.st.sqx = 0.12 - 0.22 * k; a.st.sqy = -0.1 + 0.16 * k; lean(a.st, dir * 0.24 * k); });
    await impact();
    a.st.walk = 1;
    await tween(440, (k) => { a.st.x = lerp(cx, home, ease.inOut(k)); a.st.sqx = lerp(-0.1, 0, k); a.st.sqy = lerp(0.06, 0, k); lean(a.st, dir * 0.24 * (1 - k)); });
    a.st.walk = 0; a.st.rot = 0;
  },
  async slam(b, a, d, impact) {
    const dir = Math.sign(d.st.x - a.st.x), home = a.home, h = arena.h;
    const cx = d.st.x - dir * (a.mon.full.w * a.s + d.mon.full.w * d.s) * 0.36;
    await tween(200, (k) => { a.st.sqy = -0.2 * k; a.st.sqx = 0.14 * k; });
    sfx('whoosh');
    await tween(540, (k) => {
      a.st.x = lerp(home, cx, ease.inOut(k)); a.st.y = -Math.sin(Math.PI * k) * h * 0.42;
      a.st.sqy = lerp(0.12, 0, k); a.st.sqx = lerp(-0.08, 0, k); lean(a.st, dir * 0.3 * Math.max(0, k - 0.4));
    });
    a.st.y = 0; a.st.sqy = -0.24; a.st.sqx = 0.22;
    sfx('land');
    await impact();
    await tween(160, (k) => { a.st.sqy = lerp(-0.24, 0, k); a.st.sqx = lerp(0.22, 0, k); lean(a.st, dir * 0.18 * (1 - k)); });
    await tween(460, (k) => { a.st.x = lerp(cx, home, ease.inOut(k)); a.st.y = -Math.sin(Math.PI * k) * h * 0.12; });
    a.st.y = 0; a.st.rot = 0;
  },
  async pounce(b, a, d, impact) {
    const dir = Math.sign(d.st.x - a.st.x), home = a.home, h = arena.h;
    const cx = d.st.x - dir * (a.mon.full.w * a.s + d.mon.full.w * d.s) * 0.4;
    await tween(130, (k) => { a.st.sqy = -0.16 * k; a.st.sqx = 0.1 * k; lean(a.st, dir * 0.15 * k); });
    sfx('whoosh');
    await tween(300, (k) => { a.st.x = lerp(home, cx, ease.out(k)); a.st.y = -Math.sin(Math.PI * k) * h * 0.17; a.st.sqy = lerp(0.14, 0, k); a.st.sqx = lerp(-0.1, 0, k); });
    a.st.y = 0;
    await impact();
    a.st.walk = 1.2;
    await tween(380, (k) => { a.st.x = lerp(cx, home, ease.inOut(k)); lean(a.st, dir * 0.15 * (1 - k)); });
    a.st.walk = 0; a.st.rot = 0;
  },
  async flurry(b, a, d, impact) {
    const dir = Math.sign(d.st.x - a.st.x), home = a.home, w = arena.w;
    const cx = d.st.x - dir * (a.mon.full.w * a.s + d.mon.full.w * d.s) * 0.46;
    a.st.walk = 1.6;
    await tween(240, (k) => { a.st.x = lerp(home, cx, ease.inOut(k)); });
    for (let i = 0; i < 3; i++) {
      sfx('whoosh');
      await tween(80, (k) => { a.st.x = cx + dir * w * 0.025 * k; lean(a.st, dir * 0.2 * k); });
      await impact();
      await tween(90, (k) => { a.st.x = cx + dir * w * 0.025 * (1 - k); lean(a.st, dir * 0.2 * (1 - k)); });
    }
    await tween(420, (k) => { a.st.x = lerp(cx, home, ease.inOut(k)); });
    a.st.walk = 0; a.st.rot = 0;
  },
  async roll(b, a, d, impact) {
    const dir = Math.sign(d.st.x - a.st.x), home = a.home;
    const cx = d.st.x - dir * (a.mon.full.w * a.s + d.mon.full.w * d.s) * 0.44;
    await tween(200, (k) => lean(a.st, -dir * 0.3 * k));
    sfx('whoosh');
    await tween(480, (k) => { a.st.x = lerp(home, cx, ease.in(k)); lean(a.st, -dir * 0.3 + dir * Math.PI * 2 * k); });
    await impact();
    await tween(520, (k) => { a.st.x = lerp(cx, home, ease.inOut(k)); lean(a.st, dir * Math.PI * 2 * (1 - k)); });
    a.st.rot = 0;
  },
};

$('battleQuit').addEventListener('click', () => { sfx('tap'); B = null; meterTick = meterTap = null; renderHome(); });
$('rematchBtn').addEventListener('click', () => { sfx('tap'); if (B) startBattle(B.pd, B.od); });
$('otherBtn').addEventListener('click', () => { sfx('tap'); const p = B && B.pd; B = null; if (p) openPick('opponent', p); else renderHome(); });
$('resultHome').addEventListener('click', () => { sfx('tap'); B = null; renderHome(); });

// ---------- share links ----------
let toastTimer = 0;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

// links always point at the public copy, so a monster shared from the PC or tailnet still opens for anyone
const PUBLIC_URL = 'https://elijahmanlockedin112.github.io/ink-monsters/';
async function share(d) {
  const code = await encodeMonster(d);
  const base = location.hostname.endsWith('github.io') ? `${location.origin}${location.pathname}` : PUBLIC_URL;
  const url = `${base}#m=${code}`;
  const text = `${d.name} wants a fight. Draw a monster that can beat it.`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Ink Monsters', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { window.prompt('Copy this link', url); }
}

async function readIncoming() {
  const m = location.hash.match(/^#m=([A-Za-z0-9_-]+)$/);
  if (!m) return false;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const d = await decodeMonster(m[1]);
    const seed = hashData(d);
    const known = [...store.mine, ...store.challengers].find((x) => hashData(x) === seed);
    if (known) { openReveal(known, store.mine.includes(known) ? 'mine' : 'incoming'); return true; }
    d.id = 'c' + seed.toString(36);
    d.name = d.name || monsterName(seed);
    store.challengers.unshift(d);
    save();
    openReveal(d, 'incoming');
    return true;
  } catch (e) {
    console.warn('bad monster link', e);
    toast("That link didn't have a monster in it");
    return false;
  }
}

// ---------- frame loop ----------
let last = performance.now();
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05);
  last = now;
  runTweens(now);
  if (meterTick) meterTick(dt);
  if (active === homeStage) wander(dt);
  if (active) { active.update(dt); active.draw(); }
  requestAnimationFrame(frame);
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (screen === 'draw') sizeDraw();
    else if (screen === 'home') renderHome();
  }, 150);
});

// a link pasted into a tab that already has the game open
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#m=')) { B = null; meterTick = meterTap = null; readIncoming(); } });

// iOS unlocks audio on touchend/click, not on pointerdown
for (const ev of ['touchend', 'click', 'keydown']) document.addEventListener(ev, unlock, { passive: true });

window.__ink = { store, get B() { return B; }, get screen() { return screen; }, get step() { return D.step; }, get drawing() { return D.data; }, mon };

(async () => {
  if (!(await readIncoming())) renderHome();
  requestAnimationFrame(frame);
})();
