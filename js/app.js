import { clamp, ease, hashData, lerp, monsterName, simplify, strokeLen } from './geom.js';
import { INK, SIGNAL, autoEyes, drawMonster, makeMonster, moveName, normalize } from './monster.js';
import { BOSS_DMG, BOSS_HP, ELEMENTS, ELEMENT_KEYS, EVO_LEVELS, LIMB_KEYS, MAX_LEVEL, MOVES, PARTS, PART_ORDER, PATTERNS, TINTS, matchup, xpToNext } from './parts.js';
import { cry, isMuted, setMuted, sfx, unlock } from './audio.js';
import { decodeMonster, encodeMonster } from './codec.js';
import { generate, houseMonsters } from './gen.js';
import { CHAPTERS, fightKey, isOpen, nextFight, opponent, starsFor, totalStars } from './campaign.js';
import { Stage, actorHeight, actorTop, fit, hop, lean, runTweens, tween } from './stage.js';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pad3 = (n) => String(n || 0).padStart(3, '0');
const dropIcon = '<svg><use href="#i-drop"/></svg>';

// ---------- saved state ----------
const KEY = 'inkmonsters.v1';
let store = { mine: [], challengers: [], seq: 0, muted: false, drops: 0, owned: { tints: [0, 1, 2, 3, 4], patterns: ['plain'] }, stars: {}, gauntletBest: 0 };
try {
  const s = JSON.parse(localStorage.getItem(KEY));
  if (s && Array.isArray(s.mine)) store = { ...store, ...s, owned: { ...store.owned, ...(s.owned || {}) }, stars: s.stars || {} };
} catch { /* fresh start */ }
store.mine.forEach(normalize); store.challengers.forEach(normalize);
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* storage full or blocked */ } };
const HOUSE = houseMonsters();
setMuted(!!store.muted);

const cache = new Map();
function mon(d) {
  const sig = `${d.id}|${d.lvl}|${d.evo}|${d.ink}|${d.tint}|${d.pattern}|${(d.loadout || []).join(',')}|${d.body.length}|${d.legs.length}|${d.eyes.length}|${LIMB_KEYS.map((k) => (d.parts?.[k] || []).length).join('')}`;
  let m = cache.get(d.id);
  if (!m || m.data !== d || m.sig !== sig) { m = makeMonster(d); m.faceSign = faceSign(m); m.sig = sig; cache.set(d.id, m); }
  return m;
}
function faceSign(m) {
  const eyes = m.data.eyes;
  if (!eyes.length) return 1;
  const ex = eyes.reduce((a, e) => a + e.x, 0) / eyes.length;
  return ex < m.bb.cx - 8 ? -1 : 1;
}
const isMine = (d) => store.mine.includes(d);
const evoReady = (d) => EVO_LEVELS.filter((l) => d.lvl >= l).length - d.evo;
const deepCopy = (o) => JSON.parse(JSON.stringify(o));

function setDrops(n) {
  store.drops = Math.max(0, n); save();
  for (const el of document.querySelectorAll('.dropsVal')) el.textContent = store.drops;
}
setDrops(store.drops);

// ---------- screens ----------
let screen = 'home';
let active = null;
const stages = {};
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  screen = id; active = null;
  window.scrollTo(0, 0);
}
for (const id of ['homeStage', 'styleStage', 'monStage', 'arena']) stages[id] = new Stage($(id));
const homeStage = stages.homeStage, styleStage = stages.styleStage, monStage = stages.monStage, arena = stages.arena;
const wrapWidth = (el) => Math.floor(el.getBoundingClientRect().width) - 3;

let toastTimer = 0;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

function stamp(text, kind) {
  const el = $('stamp');
  el.textContent = text;
  el.className = 'stamp' + (kind === 'solid' ? ' solid' : kind === 'grey' ? ' grey' : '');
  void el.offsetWidth;
  el.classList.add('show');
  sfx('stamp');
}

function thumb(cv, d, size = 60, fill = 1) {
  const m = mon(d);
  const g = fit(cv, size, size);
  const st = { x: size / 2, gy: 0, y: 0, face: m.faceSign, sqx: 0, sqy: 0, rot: 0, tilt: 0, phase: 0, walk: 0, flash: 0, ko: 0, t: 0, blink: 0, punch: 0, mouth: 0, flap: 0, stun: 0, lookX: m.faceSign, eyes: [] };
  const s = ((size - 8) * fill) / Math.max(m.full.w, m.groundY - m.full.y);
  st.gy = size / 2 + ((m.groundY - m.full.y) * s) / 2;
  drawMonster(g, m, st, s);
}

function row(d, { tag = '', button = 'Fight', onButton, onRow, xp = false } = {}) {
  const m = mon(d);
  const li = document.createElement('li');
  li.className = 'row';
  const cv = document.createElement('canvas'); cv.className = 'thumb';
  const text = document.createElement('div'); text.className = 'row-text';
  const b = document.createElement('b'); b.textContent = d.name;
  const sp = document.createElement('span');
  sp.innerHTML = `LV ${d.lvl} · ${ELEMENTS[d.ink].label}` + (tag ? ` · ${tag}` : '');
  text.append(b, sp);
  if (xp) {
    const bar = document.createElement('i'); bar.className = 'xpmini';
    bar.innerHTML = `<em style="width:${Math.round((d.xp / xpToNext(d.lvl)) * 100)}%"></em>`;
    text.append(bar);
  }
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

// ---------- home ----------
let wanderers = [];
function renderHome() {
  show('home');
  const has = store.mine.length > 0;
  const nf = nextFight(store.stars);
  $('advLabel').textContent = has ? 'Adventure' : 'Draw your first monster';
  $('advSub').textContent = !has ? 'Then take it on the Adventure'
    : nf ? `${CHAPTERS[nf.ch].name} · ${nf.i === 4 ? 'boss fight' : `fight ${nf.i + 1} of 5`}` : `All clear · ${totalStars(store.stars)} of 75 stars`;
  $('gauntletSub').textContent = store.gauntletBest ? `Best run: ${store.gauntletBest} round${store.gauntletBest === 1 ? '' : 's'}` : 'Fight until you drop';
  $('mineEmpty').hidden = has;
  const ml = $('mineList'); ml.textContent = '';
  for (const d of store.mine) {
    const ready = evoReady(d) > 0;
    const li = row(d, { tag: ready ? '<span class="ready">Ready to evolve</span>' : (d.w || d.l ? `${d.w}W ${d.l}L` : ''), button: '', xp: true, onRow: () => openMon(d, 'mine') });
    ml.append(li);
  }
  for (const d of store.challengers) ml.append(row(d, { tag: 'From a link', button: 'Fight', onButton: () => chooseFighter(d, (f) => startBattle(f, d, { mode: 'quick' })), onRow: () => openMon(d, 'challenger') }));

  const w = wrapWidth($('homeStage').parentElement);
  homeStage.reset();
  homeStage.resize(w, Math.round(clamp(w * 0.5, 190, 300)));
  const cast = [...store.mine.slice(0, 3), ...HOUSE].slice(0, 3);
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
      if (a.rest <= 0) { a.target = homeStage.w * (0.12 + Math.random() * 0.76); a.rest = 1.2 + Math.random() * 2.8; }
    } else {
      const sp = 45 + a.mon.stats.spd * 0.6;
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
  a.st.mouth = 1;
  hop(a);
}
for (const st of [homeStage, styleStage, monStage]) st.cv.addEventListener('pointerdown', (e) => stageTap(st, e));

$('advBtn').addEventListener('click', () => { unlock(); sfx('tap'); store.mine.length ? openMap() : startDraw(); });
$('drawBtn').addEventListener('click', () => { unlock(); sfx('tap'); startDraw(); });
$('quickBtn').addEventListener('click', () => {
  unlock(); sfx('tap');
  if (!store.mine.length) { toast('Draw a monster first'); startDraw(); return; }
  chooseFighter(null, (f) => openPick('opponent', f));
});
$('gauntletBtn').addEventListener('click', () => {
  unlock(); sfx('tap');
  if (!store.mine.length) { toast('Draw a monster first'); startDraw(); return; }
  chooseFighter(null, (f) => startGauntlet(f), 'Who runs the Gauntlet?');
});
$('muteBtn').addEventListener('click', () => {
  unlock();
  store.muted = !isMuted(); setMuted(store.muted); save(); muteIcon(); sfx('tap');
});
function muteIcon() {
  $('muteBtn').querySelector('use').setAttribute('href', isMuted() ? '#i-mute' : '#i-sound');
  $('muteBtn').setAttribute('aria-label', isMuted() ? 'Sound off' : 'Sound on');
}
muteIcon();

// ---------- drawing (new monsters and evolutions) ----------
const D = { mode: 'new', base: null, data: null, part: 'body', cur: null, pen: false, size: 0, active: null, eyeEdit: null, preview: null, history: [], locked: null, after: null };
const dcv = $('drawCanvas');
let dg = null;
const EVO_ADDS = 3;

function emptyData() { return { body: [], legs: [], eyes: [], parts: { arms: [], horns: [], wings: [], tail: [], mouth: [] } }; }
function listFor(part) { return part === 'body' ? D.data.body : part === 'legs' ? D.data.legs : part === 'eyes' ? D.data.eyes : D.data.parts[part]; }

function startDraw(after = null) {
  D.mode = 'new'; D.base = null; D.after = after;
  D.data = emptyData(); D.data.ink = 'neutral'; D.data.tint = Math.floor(Math.random() * 5); D.data.pattern = 'plain';
  D.history = []; D.locked = null; D.cur = null; D.preview = null;
  $('drawTitle').textContent = 'New monster';
  show('draw'); sizeDraw(); setPart('body');
}

function startEvolve(d) {
  D.mode = 'evolve'; D.base = d; D.after = null;
  D.data = deepCopy({ body: d.body, legs: d.legs, eyes: d.eyes, parts: d.parts, ink: d.ink, tint: d.tint, pattern: d.pattern });
  D.locked = { body: d.body.length, legs: d.legs.length, eyes: d.eyes.length, parts: Object.fromEntries(LIMB_KEYS.map((k) => [k, d.parts[k].length])) };
  D.history = []; D.cur = null;
  show('draw'); sizeDraw(); setPart('legs');
}

function sizeDraw() {
  const w = wrapWidth($('padWrap')) + 3;
  D.size = Math.max(240, Math.floor(Math.min(w, window.innerHeight - 300, 680)));
  dg = fit(dcv, D.size, D.size);
  renderDraw();
}

function buildTools() {
  const box = $('tools'); box.textContent = '';
  const noBody = !D.data.body.length;
  for (const p of PART_ORDER) {
    const b = document.createElement('button');
    const n = listFor(p).length;
    b.innerHTML = `${PARTS[p].label}${n ? ` <i>${n}</i>` : ''}`;
    if (p === D.part) b.className = 'on';
    b.disabled = p !== 'body' && noBody;
    b.addEventListener('click', () => { sfx('select'); setPart(p); });
    box.append(b);
  }
}

function setPart(p) {
  D.part = p;
  const evoLeft = EVO_ADDS - D.history.length;
  $('drawHint').textContent = D.mode === 'evolve'
    ? `${evoLeft} new part${evoLeft === 1 ? '' : 's'} left. ${PARTS[p].hint}`
    : PARTS[p].hint;
  if (D.mode === 'evolve') $('drawTitle').textContent = `Evolve ${D.base.name}`;
  if (p !== 'body' && D.data.body.length) D.preview = makeMonster({ ...deepCopy(D.data), eyes: [], id: 'preview' });
  buildTools(); updateNext(); renderDraw();
}

function updateNext() {
  const b = $('nextBtn');
  b.textContent = 'Next: color it';
  b.disabled = D.mode === 'evolve' ? false : !(D.data.body.some((s) => strokeLen(s) > 60) || D.data.body.length >= 3);
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
  if (D.part !== 'body' && D.preview) { g.globalAlpha = 0.9; g.drawImage(D.preview.sil.canvas, 0, 0, D.size, D.size); g.globalAlpha = 1; }
  const L = D.locked;
  const col = (part, i) => (L && i < (part === 'body' ? L.body : part === 'legs' ? L.legs : L.parts[part]) ? 'rgba(29,26,23,0.4)' : INK);
  D.data.body.forEach((s, i) => strokeAll(g, s, k, col('body', i)));
  D.data.legs.forEach((s, i) => strokeAll(g, s, k, col('legs', i)));
  for (const p of LIMB_KEYS) D.data.parts[p].forEach((s, i) => strokeAll(g, s, k, col(p, i)));
  if (D.cur) strokeAll(g, D.cur, k, INK);
  for (const e of D.data.eyes) {
    g.fillStyle = '#fffdf8'; g.strokeStyle = INK; g.lineWidth = Math.max(e.r * 0.16 * k, 1.3);
    g.beginPath(); g.arc(e.x * k, e.y * k, e.r * k, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = INK;
    g.beginPath(); g.arc(e.x * k, (e.y + e.r * 0.2) * k, e.r * 0.48 * k, 0, Math.PI * 2); g.fill();
  }
}

const canAdd = () => D.mode !== 'evolve' || D.history.length < EVO_ADDS;
function evoFull() { toast(`That's ${EVO_ADDS} new parts. Undo one to swap it.`); sfx('deny'); }

dcv.addEventListener('pointerdown', (e) => {
  unlock();
  if (e.pointerType === 'pen') D.pen = true;
  if (D.pen && e.pointerType === 'touch') return; // palm on the glass while using the Pencil
  if (D.active !== null) return;
  e.preventDefault();
  const p = toUnits(e);
  if (D.part === 'eyes') {
    const idx = D.data.eyes.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) <= q.r + 6);
    const lockedEye = D.locked && idx >= 0 && idx < D.locked.eyes;
    if (idx >= 0 && !lockedEye) { D.active = e.pointerId; D.eyeEdit = { idx, remove: true, x0: p.x, y0: p.y }; return; }
    if (lockedEye) return;
    if (D.data.eyes.length >= PARTS.eyes.max) { toast('That is plenty of eyes'); return; }
    if (!canAdd()) { evoFull(); return; }
    const bb = D.preview ? D.preview.bb : { w: 400, h: 400 };
    const r = Math.round(clamp(Math.min(bb.w, bb.h) * 0.11, 22, 60));
    D.data.eyes.push({ x: Math.round(p.x), y: Math.round(p.y), r });
    D.history.push('eyes');
    D.active = e.pointerId;
    D.eyeEdit = { idx: D.data.eyes.length - 1, remove: false, x0: p.x, y0: p.y, r0: r };
    sfx('eye'); renderDraw(); buildTools(); setHintCount();
    return;
  }
  if (listFor(D.part).length >= PARTS[D.part].max) { toast(`${PARTS[D.part].label}: ${PARTS[D.part].max} is the most`); return; }
  if (!canAdd()) { evoFull(); return; }
  D.active = e.pointerId;
  try { dcv.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
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

function setHintCount() { if (D.mode === 'evolve') setPart(D.part); }

function endStroke(e) {
  if (e.pointerId !== D.active) return;
  D.active = null;
  if (D.eyeEdit) {
    if (D.eyeEdit.remove) {
      D.data.eyes.splice(D.eyeEdit.idx, 1);
      const h = D.history.lastIndexOf('eyes'); if (h >= 0) D.history.splice(h, 1);
      sfx('tap');
    }
    D.eyeEdit = null;
    renderDraw(); buildTools(); setHintCount();
    return;
  }
  const s = D.cur; D.cur = null;
  if (!s) return;
  const pts = s.length > 2 ? simplify(s, 1.2) : s;
  const minLen = D.part === 'body' ? 0 : D.part === 'mouth' ? 18 : 30;
  if (strokeLen(pts) >= minLen) {
    listFor(D.part).push(pts);
    D.history.push(D.part);
    sfx('ink');
  }
  renderDraw(); updateNext(); buildTools(); setHintCount();
}
dcv.addEventListener('pointerup', endStroke);
dcv.addEventListener('pointercancel', endStroke);

$('undoBtn').addEventListener('click', () => {
  sfx('tap');
  const p = D.history.pop();
  if (!p) { if (D.mode === 'evolve') toast('The old drawing stays. Undo only removes new parts.'); return; }
  listFor(p).pop();
  if (p !== D.part) D.part = p;
  setPart(D.part);
});
$('drawClose').addEventListener('click', () => { sfx('tap'); if (D.mode === 'evolve') openMon(D.base, 'mine'); else renderHome(); });
$('nextBtn').addEventListener('click', () => {
  unlock(); sfx('tap');
  if (D.mode === 'evolve' && !D.history.length) { toast('Add at least one new part first'); return; }
  openStyle();
});

// ---------- color it ----------
let armedBuy = null;
function openStyle() {
  show('style');
  $('lifeBtn').textContent = D.mode === 'evolve' ? 'Evolve!' : 'Bring it to life';
  const w = wrapWidth($('styleStage').parentElement);
  styleStage.reset();
  styleStage.resize(w, Math.round(clamp(w * 0.55, 190, 300)));
  buildStyle();
  active = styleStage;
}

function styleActor() {
  const draft = { ...deepCopy(D.data), id: 'draft', lvl: D.base ? D.base.lvl : 1, evo: D.base ? D.base.evo : 0 };
  if (!draft.eyes.length) draft.eyes = autoEyes(draft);
  cache.delete('draft');
  const m = mon(draft);
  styleStage.actors = [];
  const a = styleStage.add(m, styleStage.w * 0.5, m.faceSign);
  a.s = styleStage.scaleFor([m], 0.5, 0.72);
  return a;
}

function buildStyle() {
  const a = styleActor();
  const inkRow = $('inkRow'); inkRow.textContent = '';
  for (const k of ELEMENT_KEYS) {
    const b = document.createElement('button');
    b.innerHTML = `<b style="background:${ELEMENTS[k].color}"></b>${ELEMENTS[k].label}`;
    if (D.data.ink === k) b.className = 'on';
    b.addEventListener('click', () => { D.data.ink = k; sfx('select'); buildStyle(); const aa = styleStage.actors[0]; if (aa) { cry(aa.mon); hop(aa); } });
    inkRow.append(b);
  }
  $('inkBlurb').textContent = ELEMENTS[D.data.ink].blurb;
  const tr = $('tintRow'); tr.textContent = '';
  TINTS.forEach((t, i) => {
    const b = document.createElement('button');
    const owned = store.owned.tints.includes(i);
    b.style.background = t.c;
    b.setAttribute('aria-label', owned ? `Color ${i + 1}` : `Color ${i + 1}, ${t.price} drops`);
    if (!owned) b.innerHTML = '<svg><use href="#i-lock"/></svg>';
    if (i === D.data.tint) b.className = 'on';
    b.addEventListener('click', () => {
      if (!owned && !buy('tints', i, t.price)) return;
      D.data.tint = i; sfx('select'); buildStyle();
    });
    tr.append(b);
  });
  const pr = $('patRow'); pr.textContent = '';
  for (const p of PATTERNS) {
    const b = document.createElement('button');
    const owned = store.owned.patterns.includes(p.key);
    b.innerHTML = p.label + (owned ? '' : ` <span class="price">${dropIcon}${p.price}</span>`);
    if (p.key === D.data.pattern) b.className = 'on';
    b.addEventListener('click', () => {
      if (!owned && !buy('patterns', p.key, p.price)) return;
      D.data.pattern = p.key; sfx('select'); buildStyle();
    });
    pr.append(b);
  }
  return a;
}

// first tap on something locked says the price, second tap buys it
function buy(kind, key, price) {
  if (store.drops < price) { toast(`Needs ${price} ink drops. You have ${store.drops}. Win fights to earn more.`); sfx('deny'); return false; }
  if (!armedBuy || armedBuy.kind !== kind || armedBuy.key !== key) {
    armedBuy = { kind, key };
    toast(`Tap again to buy for ${price} drops`);
    setTimeout(() => { if (armedBuy && armedBuy.kind === kind && armedBuy.key === key) armedBuy = null; }, 3000);
    return false;
  }
  armedBuy = null;
  setDrops(store.drops - price);
  store.owned[kind].push(key); save();
  sfx('buy'); toast('Unlocked');
  return true;
}

$('styleBack').addEventListener('click', () => { sfx('tap'); show('draw'); sizeDraw(); setPart(D.part); });
$('lifeBtn').addEventListener('click', () => { unlock(); sfx('tap'); D.mode === 'evolve' ? finishEvolve() : finishDraw(); });

function finishDraw() {
  const d = { ...deepCopy(D.data) };
  if (!d.eyes.length) d.eyes = autoEyes(d);
  d.name = monsterName(hashData(d));
  d.id = 'm' + Date.now().toString(36);
  store.seq += 1;
  d.no = store.seq; d.w = 0; d.l = 0; d.lvl = 1; d.xp = 0; d.evo = 0;
  normalize(d);
  store.mine.unshift(d);
  save();
  const after = D.after; D.after = null;
  openMon(d, 'new', { after });
}

function finishEvolve() {
  const d = D.base;
  const old = mon(d);
  const before = { ...old.stats }, knew = old.partMoves.slice();
  const n = deepCopy(D.data);
  Object.assign(d, { body: n.body, legs: n.legs, eyes: n.eyes, parts: n.parts, ink: n.ink, tint: n.tint, pattern: n.pattern });
  d.evo += 1;
  cache.delete(d.id);
  const learned = mon(d).partMoves.filter((k) => !knew.includes(k));
  if (Array.isArray(d.loadout)) for (const k of learned) if (d.loadout.length < 3) d.loadout.push(k);
  save();
  openMon(d, 'evolved', { before, learned });
}

// ---------- monster page ----------
let shown = null, shownMode = '', shownCtx = {};
function openMon(d, mode, ctx = {}) {
  shown = d; shownMode = mode; shownCtx = ctx;
  show('mon');
  const m = mon(d);
  const own = isMine(d);
  $('monTitle').textContent = own ? `No. ${pad3(d.no)}` : mode === 'foe' ? (d.boss ? 'Boss' : `${CHAPTERS[ctx.ch].name}`) : d.house ? 'House monster' : 'Challenger';
  const kick = $('monKicker');
  const kickText = mode === 'incoming' ? 'A challenger appears'
    : mode === 'evolved' ? 'Evolved!'
    : mode === 'foe' ? (d.boss ? `Boss of ${CHAPTERS[ctx.ch].name}` : `Fight ${ctx.i + 1} of 5`)
    : '';
  kick.hidden = !kickText; kick.textContent = kickText;
  $('shareBtn').hidden = !own;
  const ni = $('nameInput');
  ni.value = d.name; ni.readOnly = !own;
  $('monEl').innerHTML = `<b style="background:${ELEMENTS[d.ink].color}"></b>${ELEMENTS[d.ink].label}`;
  $('monLvl').textContent = `LV ${d.lvl}`;
  $('monXpWrap').hidden = !own;
  const xpEl = $('monXp');
  xpEl.style.width = d.lvl >= MAX_LEVEL ? '100%' : `${Math.round((d.xp / xpToNext(d.lvl)) * 100)}%`;
  const hpShown = d.boss ? Math.round(m.stats.hp * BOSS_HP) : m.stats.hp;
  $('statHp').textContent = hpShown; $('statPow').textContent = m.stats.pow; $('statSpd').textContent = m.stats.spd;
  const maxes = { hp: Math.max(160, hpShown), pow: Math.max(60, m.stats.pow), spd: Math.max(100, m.stats.spd) };
  for (const [id, v, max] of [['barHp', hpShown, maxes.hp], ['barPow', m.stats.pow, maxes.pow], ['barSpd', m.stats.spd, maxes.spd]]) {
    const el = $(id); el.style.transition = 'none'; el.style.width = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = ''; el.style.width = `${Math.round((v / max) * 100)}%`; }));
  }
  renderMoves(d, m, own);
  let why = m.why.join(' ');
  if (mode === 'evolved' && ctx.before) {
    const s = m.stats, b = ctx.before;
    const names = (ctx.learned || []).map((k) => MOVES[k].name);
    const learnedTxt = names.length ? `Learned ${names.join(' and ')}${m.moves.some((k) => ctx.learned.includes(k)) ? '.' : '. Tap it above to equip.'} ` : '';
    why = `${learnedTxt}HP ${b.hp} → ${s.hp}, POW ${b.pow} → ${s.pow}, SPD ${b.spd} → ${s.spd}. ` + why;
  }
  $('whyText').textContent = why;
  $('recordText').textContent = own && (d.w || d.l) ? `${d.w} win${d.w === 1 ? '' : 's'}, ${d.l} loss${d.l === 1 ? '' : 'es'}` : '';
  const evoN = own ? evoReady(d) : 0;
  $('evolveBtn').hidden = evoN <= 0;
  const fb = $('fightBtn');
  fb.textContent = mode === 'foe' ? 'Choose your fighter'
    : mode === 'new' && ctx.after ? `Fight ${ctx.after.name}`
    : own ? 'Quick fight' : store.mine.length ? 'Fight it' : 'Draw one to fight it';
  fb.className = evoN > 0 ? 'btn btn-small' : 'btn btn-primary btn-big';
  const del = $('deleteBtn');
  del.hidden = !(own || store.challengers.includes(d));
  del.textContent = own ? 'Delete' : 'Remove';
  del.dataset.armed = '';

  const w = wrapWidth($('monStage').parentElement);
  monStage.reset();
  monStage.resize(w, Math.round(clamp(w * 0.72, 240, 440)), 0.84, mode === 'foe' ? CHAPTERS[ctx.ch].theme : null);
  const a = monStage.add(m, -w * 0.3, m.faceSign);
  a.s = monStage.scaleFor([m], 0.5, 0.72);
  active = monStage;
  const fresh = mode === 'new' || mode === 'incoming' || mode === 'evolved' || mode === 'foe';
  (async () => {
    a.busy = true;
    if (mode === 'evolved') {
      a.st.x = w * 0.5;
      sfx('evolve');
      await tween(1000, (k) => { a.st.tilt = Math.sin(k * 40) * 0.06 * k; a.st.flash = k > 0.8 ? 1 : 0; });
      a.st.tilt = 0;
      monStage.ring(a.st.x, monStage.gy - actorHeight(a) / 2, SIGNAL, 20, 420, 0.6);
      monStage.splash(a.st.x, monStage.gy - actorHeight(a) / 2, 1, 14, true);
      monStage.splash(a.st.x, monStage.gy - actorHeight(a) / 2, -1, 14, true);
    } else {
      a.st.walk = 1;
      await tween(fresh ? 1300 : 800, (k) => { a.st.x = lerp(-w * 0.3, w * 0.5, ease.out(k)); a.st.walk = 1 - k * 0.7; });
      a.st.walk = 0;
    }
    a.busy = false;
    if (shown !== d) return;
    cry(m); a.st.mouth = 1;
    hop(a, fresh ? 1.6 : 1);
  })();
}

// with more than 3 part moves, your own monster's list lets you choose which 3 to bring
function renderMoves(d, m, own) {
  const ml = $('monMoves'); ml.textContent = '';
  const swap = own && m.partMoves.length > 3;
  const list = swap ? [m.basic, ...m.partMoves, ...(m.moves.includes('inkup') ? ['inkup'] : [])] : m.moves;
  for (const k of list) {
    const li = document.createElement('li');
    const mv = MOVES[k];
    const isPart = m.partMoves.includes(k);
    const on = m.moves.includes(k);
    const tagTxt = swap && isPart ? (on ? 'Equipped' : 'Tap to equip')
      : mv.power ? `x${(mv.power * (mv.hits || 1)).toFixed(1)}${mv.cd ? ` · every ${mv.cd + 1}` : ''}` : `every ${mv.cd + 1}`;
    li.innerHTML = `<b></b><small class="${swap && isPart ? 'slot' : ''}">${tagTxt}</small><span></span>`;
    li.querySelector('b').textContent = moveName(m, k);
    li.querySelector('span').textContent = mv.desc;
    if (swap && isPart) {
      li.classList.add('swappable', on ? 'equipped' : 'benched');
      li.addEventListener('click', () => {
        const cur = m.equipped.slice();
        if (on) {
          if (cur.length <= 1) { toast('Keep at least one part move'); sfx('deny'); return; }
          d.loadout = cur.filter((x) => x !== k);
        } else {
          if (cur.length >= 3) { toast('3 part moves max. Tap one to take it off first.'); sfx('deny'); return; }
          d.loadout = [...cur, k];
        }
        sfx('select'); save();
        const m2 = mon(d);
        renderMoves(d, m2, own);
      });
    }
    ml.append(li);
  }
  let note = ml.nextElementSibling;
  if (!note || !note.classList.contains('moves-note')) { note = document.createElement('p'); note.className = 'moves-note'; ml.after(note); }
  note.textContent = swap ? `It knows ${m.partMoves.length} part moves and brings 3. Tap to swap. An empty slot becomes Ink Up.` : '';
  note.hidden = !swap;
}

$('nameInput').addEventListener('input', (e) => {
  if (!shown || e.target.readOnly) return;
  shown.name = e.target.value.trim().slice(0, 16) || shown.name;
  save();
});
$('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('monBack').addEventListener('click', () => { sfx('tap'); shownMode === 'foe' ? openMap() : renderHome(); });
$('shareBtn').addEventListener('click', () => { unlock(); sfx('tap'); share(shown); });
$('evolveBtn').addEventListener('click', () => { unlock(); sfx('tap'); startEvolve(shown); });
$('fightBtn').addEventListener('click', () => {
  unlock(); sfx('tap');
  const d = shown;
  if (shownMode === 'foe') { chooseFighter(d, (f) => startBattle(f, d, { mode: 'adv', ch: shownCtx.ch, i: shownCtx.i })); return; }
  if (shownMode === 'new' && shownCtx.after) { const o = shownCtx.after; startBattle(d, o, { mode: 'quick' }); return; }
  if (isMine(d)) openPick('opponent', d);
  else chooseFighter(d, (f) => startBattle(f, d, { mode: 'quick' }));
});
$('deleteBtn').addEventListener('click', (e) => {
  const b = e.currentTarget;
  if (!b.dataset.armed) {
    b.dataset.armed = '1'; b.textContent = 'Tap again to delete';
    setTimeout(() => { if (b.dataset.armed) { b.dataset.armed = ''; b.textContent = isMine(shown) ? 'Delete' : 'Remove'; } }, 3000);
    return;
  }
  store.mine = store.mine.filter((d) => d !== shown);
  store.challengers = store.challengers.filter((d) => d !== shown);
  cache.delete(shown.id);
  save();
  renderHome();
});

// ---------- adventure map ----------
function openMap() {
  show('map');
  $('starsTotal').textContent = totalStars(store.stars);
  const box = $('chapters'); box.textContent = '';
  const nf = nextFight(store.stars);
  CHAPTERS.forEach((C, ch) => {
    const sec = document.createElement('section');
    const open = isOpen(store.stars, ch, 0);
    sec.className = 'chapter' + (open ? '' : ' locked');
    let got = 0; for (let i = 0; i < 5; i++) got += store.stars[fightKey(ch, i)] || 0;
    sec.innerHTML = `<header><h2></h2><span>${got}/15</span></header><div class="path"></div>`;
    sec.querySelector('h2').textContent = `${ch + 1}. ${C.name}`;
    const path = sec.querySelector('.path');
    for (let i = 0; i < 5; i++) {
      const st = store.stars[fightKey(ch, i)] || 0;
      const can = isOpen(store.stars, ch, i);
      const foe = opponent(ch, i);
      const n = document.createElement('button');
      n.className = 'node' + (i === 4 ? ' boss' : '') + (nf && nf.ch === ch && nf.i === i ? ' next' : '');
      n.disabled = !can;
      n.setAttribute('aria-label', can ? `${foe.name}, level ${foe.lvl}` : 'Locked');
      n.innerHTML = `<span class="disc"></span><span class="lv">${can ? `LV ${foe.lvl}` : i === 4 ? 'Boss' : '&nbsp;'}</span><span class="nstars">${[0, 1, 2].map((k) => `<svg class="${k < st ? 'got' : ''}"><use href="#i-star"/></svg>`).join('')}</span>`;
      const disc = n.querySelector('.disc');
      if (can) { const cv = document.createElement('canvas'); disc.append(cv); thumb(cv, foe, window.innerWidth >= 900 ? 72 : 56, 0.78); }
      else disc.innerHTML = '<svg><use href="#i-lock"/></svg>';
      n.addEventListener('click', () => { unlock(); sfx('tap'); openMon(foe, 'foe', { ch, i }); });
      path.append(n);
    }
    if (!open) {
      const p = document.createElement('p'); p.className = 'chapter-note';
      p.textContent = `Beat ${opponent(ch - 1, 4).name} to open this page.`;
      sec.append(p);
    }
    box.append(sec);
  });
  const nxt = box.querySelector('.node.next');
  if (nxt) setTimeout(() => nxt.scrollIntoView({ block: 'center' }), 50);
}
$('mapBack').addEventListener('click', () => { sfx('tap'); renderHome(); });

// ---------- picking ----------
let pickCtx = null;
function matchWord(d, foe) {
  if (!foe) return '';
  const m = matchup(d.ink, foe.ink);
  return m > 1 ? '<span class="ready">strong matchup</span>' : m < 1 ? 'weak matchup' : '';
}
// calls go(fighter) right away if there is only one monster
function chooseFighter(foe, go, title) {
  if (!store.mine.length) { startDraw(foe && !foe.gen ? foe : null); return; }
  if (store.mine.length === 1) { go(store.mine[0]); return; }
  pickCtx = { kind: 'fighter', foe, go };
  show('pick');
  $('pickTitle').textContent = title || 'Pick your fighter';
  const note = $('pickNote');
  note.hidden = !foe;
  if (foe) note.textContent = `Against ${foe.name}, LV ${foe.lvl}, ${ELEMENTS[foe.ink].label}.`;
  const list = $('pickList'); list.textContent = '';
  const sorted = store.mine.slice().sort((a, b) => b.lvl - a.lvl);
  for (const d of sorted) list.append(row(d, { tag: matchWord(d, foe), button: 'Pick', onButton: () => go(d), onRow: () => go(d) }));
}
function openPick(kind, fighter) {
  pickCtx = { kind, fighter };
  show('pick');
  $('pickTitle').textContent = 'Pick an opponent';
  $('pickNote').hidden = true;
  const list = $('pickList'); list.textContent = '';
  const house = HOUSE.map((d) => ({ ...d, lvl: Math.max(1, fighter.lvl), id: `${d.id}-${fighter.lvl}` }));
  const opts = [...store.challengers.map((d) => [d, 'From a link']), ...house.map((d) => [d, 'House']), ...store.mine.filter((d) => d !== fighter).map((d) => [d, 'Yours'])];
  for (const [d, tag] of opts) {
    const go = () => startBattle(fighter, d, { mode: 'quick' });
    list.append(row(d, { tag: [tag, matchWord(fighter, d)].filter(Boolean).join(' · '), button: 'Pick', onButton: go, onRow: go }));
  }
}
$('pickBack').addEventListener('click', () => { sfx('tap'); renderHome(); });

// ---------- battle ----------
let B = null;
const ABORT = Symbol('abort');
let meterTick = null, meterTap = null, movePick = null;
const check = (b) => { if (B !== b) throw ABORT; };

function plate(el, f) {
  const nm = el.querySelector('.pname');
  nm.innerHTML = `<b class="dot" style="background:${ELEMENTS[f.d.ink].color}"></b><span></span>`;
  nm.querySelector('span').textContent = f.d.name;
  el.querySelector('.php').textContent = `LV ${f.d.lvl} · ${Math.max(0, f.hp)}/${f.max}`;
  el.querySelector('em').style.width = `${clamp((f.hp / f.max) * 100, 0, 100)}%`;
  el.classList.toggle('low', f.hp / f.max < 0.3);
  const tags = [];
  if (f.bleed > 0) tags.push(`<span class="t-bleed">Bleed ${f.bleed}</span>`);
  if (f.stun > 0) tags.push('<span class="t-stun">Stunned</span>');
  if (f.weak > 0) tags.push(`<span class="t-weak">Weak ${f.weak}</span>`);
  if (f.fly) tags.push('<span class="t-fly">Flying</span>');
  el.querySelector('.ptags').innerHTML = tags.join('');
}
const plates = (b) => { plate($('plateA'), b.P); plate($('plateB'), b.O); };

function setAction(text, live, btn) {
  $('actionText').textContent = text;
  $('actionPad').classList.toggle('live', live);
  if (btn) $('actionBtn').textContent = btn;
}

const THEMES = ['meadow', 'caves', 'woods', 'volcano', 'page'];

// opts: { mode: 'quick' | 'adv' | 'gauntlet', ch, i, run }
function startBattle(pd, od, opts) {
  unlock();
  show('battle');
  $('result').hidden = true; $('actionPad').hidden = false;
  $('moveGrid').hidden = true; $('meterWrap').hidden = false;
  const tag = $('roundTag');
  tag.hidden = opts.mode === 'quick';
  tag.textContent = opts.mode === 'adv' ? `${CHAPTERS[opts.ch].name} · ${opts.i === 4 ? 'Boss' : `fight ${opts.i + 1} of 5`}` : opts.mode === 'gauntlet' ? `Gauntlet · round ${opts.run.round}` : '';
  const w = wrapWidth($('arenaWrap'));
  const h = Math.round(clamp(Math.min(w * 1.4, window.innerHeight - 385), 220, 520));
  const theme = opts.mode === 'adv' ? CHAPTERS[opts.ch].theme : opts.theme || THEMES[Math.floor(Math.random() * THEMES.length)];
  arena.reset();
  arena.resize(w, h, 0.8, theme);
  const P = mon(pd), O = mon(od);
  const s = arena.scaleFor([P, O], 0.42, 0.58);
  const pa = arena.add(P, -w * 0.3, P.faceSign);
  const oa = arena.add(O, w * 1.3, -O.faceSign);
  pa.s = oa.s = s;
  pa.home = w * 0.27; oa.home = w * 0.73;
  pa.st.lookX = 1; oa.st.lookX = -1;
  const fighter = (d, a, m, hp) => {
    const max = Math.round(m.stats.hp * (d.boss ? BOSS_HP : 1));
    return { d, a, mon: m, max, hp: hp ?? max, cd: {}, bleed: 0, stun: 0, weak: 0, fly: false, boost: false };
  };
  const b = { pd, od, opts, P: fighter(pd, pa, P, opts.run ? opts.run.hp : undefined), O: fighter(od, oa, O) };
  b.ai = opts.mode === 'adv' ? CHAPTERS[opts.ch].ai : Math.min(4, Math.floor(od.lvl / 5));
  B = b;
  plates(b);
  active = arena;
  setAction('', false, 'Strike');
  run(b).catch((err) => { if (err !== ABORT) console.error(err); });
}

async function run(b) {
  const { P, O } = b, w = arena.w;
  P.a.st.walk = O.a.st.walk = 1;
  setAction(`${P.d.name} vs ${O.d.name}`, false);
  await tween(1200, (k) => {
    const e = ease.out(k);
    P.a.st.x = lerp(-w * 0.3, P.a.home, e); O.a.st.x = lerp(w * 1.3, O.a.home, e);
    P.a.st.walk = O.a.st.walk = 1 - k * 0.6;
  });
  P.a.st.walk = O.a.st.walk = 0;
  check(b);
  cry(P.mon); P.a.st.mouth = 1; hop(P.a); await wait(650); check(b);
  cry(O.mon); O.a.st.mouth = 1; hop(O.a); await wait(650); check(b);
  const el = matchup(P.d.ink, O.d.ink);
  if (el !== 1) { setAction(el > 1 ? `${ELEMENTS[P.d.ink].label} beats ${ELEMENTS[O.d.ink].label}. Your hits land harder.` : `${ELEMENTS[O.d.ink].label} beats ${ELEMENTS[P.d.ink].label}. Careful.`, false); await wait(1300); check(b); }
  let att = P.mon.stats.spd >= O.mon.stats.spd ? P : O;
  while (P.hp > 0 && O.hp > 0) {
    await turn(b, att, att === P ? O : P);
    check(b);
    if (P.hp <= 0 || O.hp <= 0) break;
    att = att === P ? O : P;
  }
}

function meter(b, mode, focus) {
  const spd = b.P.mon.stats.spd;
  const crit = clamp((0.09 + (spd / 100) * 0.08) * focus, 0.06, 0.3), good = crit * 2.6;
  const center = 0.3 + Math.random() * 0.4;
  const zg = $('zoneGood'), zc = $('zoneCrit'), needle = $('needle');
  zg.style.left = `${(center - good / 2) * 100}%`; zg.style.width = `${good * 100}%`;
  zc.style.left = `${(center - crit / 2) * 100}%`; zc.style.width = `${crit * 100}%`;
  const speed = mode === 'block' ? 1.3 + b.ai * 0.06 : 1.15;
  let pos = 0, dir = 1, sweeps = 0;
  needle.style.left = '0%';
  $('moveGrid').hidden = true; $('meterWrap').hidden = false;
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
  unlock(); sfx('tap');
  const btn = $('actionBtn');
  btn.classList.add('pressed'); setTimeout(() => btn.classList.remove('pressed'), 110);
  meterTap();
}
$('meterWrap').addEventListener('pointerdown', actionPress);
window.addEventListener('keydown', (e) => {
  if (screen !== 'battle') return;
  if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); actionPress(); }
  const n = parseInt(e.key, 10);
  if (movePick && n >= 1 && n <= 4) { const btn = $('moveGrid').children[n - 1]; if (btn && !btn.disabled) btn.click(); }
});

function chooseMove(b, f) {
  return new Promise((res) => {
    const grid = $('moveGrid'); grid.textContent = '';
    for (const k of f.mon.moves) {
      const mv = MOVES[k];
      const btn = document.createElement('button');
      const wait2 = f.cd[k] || 0;
      btn.className = k === f.mon.basic ? 'basic' : '';
      btn.disabled = wait2 > 0;
      const sub = wait2 > 0 ? `Ready in ${wait2} turn${wait2 > 1 ? 's' : ''}` : mv.desc;
      btn.innerHTML = '<b></b><small></small>';
      btn.querySelector('b').textContent = moveName(f.mon, k);
      btn.querySelector('small').textContent = sub;
      btn.addEventListener('click', () => { if (!movePick) return; movePick = null; unlock(); sfx('select'); res(k); });
      grid.append(btn);
    }
    $('meterWrap').hidden = true; grid.hidden = false;
    setAction('Your move', true);
    movePick = res;
  });
}

function aiChoose(b, f, foe) {
  const avail = f.mon.moves.filter((k) => !(f.cd[k] > 0));
  const has = (k) => avail.includes(k);
  const r = Math.random();
  if (has('inkup') && f.hp < f.max * 0.4 && r < 0.75) return 'inkup';
  if (has('fly') && !f.fly && r < 0.3) return 'fly';
  if (has('glare') && !foe.weak && r < 0.35) return 'glare';
  const attacks = avail.filter((k) => MOVES[k].power > 0);
  if (has('gore') && !foe.bleed && Math.random() < 0.6) return 'gore';
  attacks.sort((x, y) => MOVES[y].power * (MOVES[y].hits || 1) - MOVES[x].power * (MOVES[x].hits || 1));
  if (Math.random() < 0.55 + b.ai * 0.08) return attacks[0];
  return attacks[Math.floor(Math.random() * attacks.length)] || f.mon.basic;
}
function aiGrade(b) {
  const r = Math.random(), critP = 0.16 + b.ai * 0.05, missP = 0.24 - b.ai * 0.04;
  return r < critP ? 'crit' : r < 1 - missP ? 'good' : 'miss';
}

function healFx(f, amount, quiet) {
  f.hp = Math.min(f.max, f.hp + amount);
  arena.pluses(f.a, ELEMENTS[f.d.ink].color, quiet ? 4 : 10);
  arena.number(f.a.st.x, actorTop(f.a) - 8, `+${amount}`, '#2f7a3b', quiet ? 20 : 28);
  if (!quiet) sfx('heal');
}

async function turn(b, att, def) {
  const isP = att === b.P;
  for (const k in att.cd) if (att.cd[k] > 0) att.cd[k]--;
  if (att.d.ink === 'water' && att.hp < att.max) { healFx(att, Math.max(1, Math.round(att.max * 0.04)), true); plates(b); await wait(350); check(b); }
  if (att.bleed > 0) {
    const dmg = Math.max(1, Math.round(att.max * 0.06));
    att.bleed--; att.a.bleed = att.bleed > 0;
    att.hp = Math.max(0, att.hp - dmg);
    arena.number(att.a.st.x, actorTop(att.a) - 8, String(dmg), SIGNAL, 24);
    arena.splash(att.a.st.x, arena.gy - actorHeight(att.a) * 0.5, isP ? -1 : 1, 6, false, SIGNAL);
    att.a.st.flash = 1; sfx('bleed');
    plates(b);
    setAction(`${att.d.name} bleeds`, false);
    await wait(700); check(b);
    if (att.hp <= 0) { await ko(b, def, att); return; }
  }
  if (att.stun > 0) {
    att.stun--; plates(b);
    setAction(`${att.d.name} is stunned and can't move`, false);
    stamp('Stunned', 'grey'); sfx('stun');
    await wait(1100); check(b);
    att.a.st.stun = 0; plates(b);
    return;
  }

  const key = isP ? await chooseMove(b, att) : aiChoose(b, att, def);
  check(b);
  $('moveGrid').hidden = true; $('meterWrap').hidden = false;
  const mv = MOVES[key];
  if (mv.cd) att.cd[key] = mv.cd + 1; // ticks down at the start of its next turn
  const name = moveName(att.mon, key);

  if (key === 'fly') {
    setAction(`${att.d.name} flies up`, false);
    sfx('fly'); att.a.st.flap = 1;
    att.fly = true; att.boost = true;
    att.a.hover = -actorHeight(att.a) * 0.35;
    plates(b); await wait(900); check(b);
    endTurn(att); return;
  }
  if (key === 'glare') {
    setAction(`${att.d.name} glares`, false);
    sfx('glare');
    for (let i = 0; i < 3; i++) setTimeout(() => arena.ring(att.a.st.x, arena.gy - actorHeight(att.a) * 0.6, INK, 10, 300, 0.5), i * 160);
    await tween(700, (k) => { def.a.st.tilt = Math.sin(k * 50) * 0.05 * (1 - k); });
    def.a.st.tilt = 0;
    def.weak = 2 + (att.d.ink === 'leaf' ? 1 : 0);
    stamp('Weakened', ''); plates(b);
    await wait(500); check(b);
    endTurn(att); return;
  }
  if (key === 'inkup') {
    let grade;
    if (isP) { setAction('Stop the needle in the red to heal more', true, 'Heal'); grade = await meter(b, 'heal', att.mon.focus); }
    else { setAction(`${att.d.name} uses Ink Up`, false); await wait(500); grade = aiGrade(b); }
    check(b);
    const amount = Math.round(att.max * { crit: 0.25, good: 0.18, miss: 0.1 }[grade]);
    healFx(att, amount, false);
    att.a.st.mouth = 1; hop(att.a);
    plates(b); await wait(900); check(b);
    endTurn(att); return;
  }

  // an attack
  let atkMult, defMult = 1, crit = false, hardBlock = false, grade;
  if (isP) {
    setAction(`${name}: stop the needle in the red`, true, 'Strike');
    grade = await meter(b, 'strike', att.mon.focus);
    check(b);
    atkMult = { crit: 1.5, good: 1, miss: 0.6 }[grade];
    crit = grade === 'crit';
    stamp({ crit: 'Crit!', good: 'Hit', miss: 'Weak' }[grade], grade === 'crit' ? 'solid' : grade === 'miss' ? 'grey' : '');
  } else {
    setAction(`${att.d.name} winds up ${name}. Stop the needle in the red to block!`, true, 'Block');
    const wob = setInterval(() => { att.a.st.tilt = Math.sin(performance.now() / 45) * 0.035; }, 16);
    grade = await meter(b, 'block', def.mon.focus);
    clearInterval(wob); att.a.st.tilt = 0;
    check(b);
    const ai = aiGrade(b);
    atkMult = { crit: 1.5, good: 1, miss: 0.6 }[ai];
    defMult = { crit: 0.35, good: 0.7, miss: 1 }[grade];
    hardBlock = grade === 'crit';
    crit = ai === 'crit' && grade === 'miss';
    stamp({ crit: 'Blocked!', good: 'Block', miss: 'Ouch' }[grade], grade === 'crit' ? 'solid' : grade === 'miss' ? 'grey' : '');
  }
  setAction(`${att.d.name} uses ${name}`, false);
  await wait(380); check(b);

  const el = matchup(att.d.ink, def.d.ink);
  const per = att.mon.stats.pow * mv.power * atkMult * defMult * el
    * (att.d.ink === 'fire' ? 1.1 : 1) * (att.weak > 0 ? 0.7 : 1) * (att.boost ? 1.3 : 1) * (att.d.boss ? BOSS_DMG : 1);
  att.boost = false;
  const dodge = def.fly;
  // stun lands on strong timing: your crit always, a good hit half the time; their hits when you fail to block
  const stunHit = key === 'sweep' && !dodge && (isP ? grade === 'crit' || (grade === 'good' && Math.random() < 0.5) : grade === 'miss' ? Math.random() < 0.65 : grade === 'good' && Math.random() < 0.25);
  let shown = false;
  const impact = async () => {
    if (dodge) {
      arena.number(def.a.st.x, actorTop(def.a) - 8, 'Miss', INK, 26);
      sfx('miss');
      if (!shown) { shown = true; stamp('Dodged', 'grey'); }
      return;
    }
    const dmg = Math.max(1, Math.round(per * (0.9 + Math.random() * 0.2)));
    hit(b, att, def, dmg, crit, hardBlock);
    if (mv.effect === 'drain') healFx(att, Math.max(1, Math.round(dmg * 0.5)), true);
    if (!shown && el !== 1) { shown = true; setAction(el > 1 ? 'Super effective!' : 'Not very effective', false); }
    plates(b);
    await wait(crit ? 120 : 60);
  };
  if (att.fly) { att.a.hover = undefined; }
  await ANIM[mv.anim](b, att.a, def.a, impact, mv.hits || 1);
  check(b);
  if (att.fly) att.a.hover = -actorHeight(att.a) * 0.35;
  if (dodge) { def.fly = false; def.a.hover = 0; def.a.st.flap = 0; setTimeout(() => { if (def.a.hover === 0) def.a.hover = undefined; }, 600); }
  if (!dodge && def.hp > 0) {
    if (mv.effect === 'bleed') { def.bleed = 3 + (att.d.ink === 'leaf' ? 1 : 0); def.a.bleed = true; stamp('Bleeding', ''); sfx('bleed'); }
    if (stunHit) { def.stun = 1; def.a.st.stun = 1; stamp('Stunned', 'solid'); sfx('stun'); }
  }
  plates(b);
  if (def.hp <= 0) { await ko(b, att, def); return; }
  endTurn(att);
  await wait(300);
}

function endTurn(f) {
  if (f.weak > 0) f.weak--;
  if (B) plates(B);
}

function hit(b, att, def, dmg, crit, hardBlock) {
  def.hp = Math.max(0, def.hp - dmg);
  const dir = Math.sign(def.a.st.x - att.a.st.x) || 1;
  const da = def.a;
  da.st.flash = 1;
  const cx = da.st.x - dir * (da.mon.full.w * da.s) * 0.35, cy = da.st.gy + da.st.y - actorHeight(da) * 0.55;
  arena.splash(cx, cy, dir, crit ? 22 : hardBlock ? 5 : 12, crit, def.mon.ink);
  arena.number(da.st.x, actorTop(da) - 8, String(dmg), crit ? SIGNAL : INK, crit ? 38 : 28);
  arena.shake = crit ? 14 : hardBlock ? 3 : 7;
  sfx(hardBlock ? 'block' : crit ? 'crit' : 'hit', crit ? 1 : 0.8);
  if (!hardBlock) cry(def.mon, { pitch: 1.7, len: 0.28 });
  const x0 = da.home, push = dir * arena.w * (crit ? 0.05 : 0.03);
  tween(320, (k) => { da.st.x = x0 + push * Math.sin(Math.PI * Math.min(1, k * 1.3)) * (1 - k * 0.4); lean(da.st, -dir * 0.2 * Math.sin(Math.PI * k)); })
    .then(() => { if (!def.hp) return; da.st.x = da.home; da.st.rot = 0; });
}

async function ko(b, winner, loser) {
  const dir = Math.sign(loser.a.st.x - winner.a.st.x) || 1;
  const la = loser.a;
  la.hover = undefined; la.bleed = false; la.st.stun = 0;
  la.st.ko = 1;
  const m = la.mon, drop = (m.groundY - (m.bb.cy + m.bb.w / 2)) * la.s;
  const y0 = la.st.y;
  await tween(520, (k) => { lean(la.st, dir * (Math.PI / 2) * ease.back(k) * 0.92); la.st.y = lerp(y0, drop, ease.in(k)) - Math.sin(Math.PI * k) * 18; });
  la.st.y = drop;
  sfx('land'); arena.shake = 10;
  const won = winner === b.P;
  sfx(won ? 'win' : 'lose');
  await wait(300);
  cry(winner.mon, { pitch: 1.15 }); winner.a.st.mouth = 1;
  winner.a.hover = undefined;
  await hop(winner.a, 1.4); await hop(winner.a, 1);
  check(b);
  await finish(b, won);
}

// ---------- results and progression ----------
function gainXp(d, amount) {
  const start = { lvl: d.lvl, xp: d.xp };
  let ups = 0;
  d.xp += amount;
  while (d.lvl < MAX_LEVEL && d.xp >= xpToNext(d.lvl)) { d.xp -= xpToNext(d.lvl); d.lvl++; ups++; }
  if (d.lvl >= MAX_LEVEL) d.xp = 0;
  return { start, ups };
}

async function finish(b, won) {
  const { P, O, opts } = b;
  const mine = isMine(P.d);
  let xp = 0, drops = 0, stars = 0, first = false;
  if (mine) {
    xp = won ? 16 + 7 * O.d.lvl + 6 * Math.max(0, O.d.lvl - P.d.lvl) : 4 + 2 * O.d.lvl;
    if (won) P.d.w++; else P.d.l++;
  }
  if (opts.mode === 'adv' && won) {
    const k = fightKey(opts.ch, opts.i);
    stars = starsFor(P.hp, P.max);
    first = !store.stars[k];
    store.stars[k] = Math.max(store.stars[k] || 0, stars);
    drops = 6 + 2 * O.d.lvl + stars * 2 + (first ? 15 : 0) + (first && opts.i === 4 ? 40 : 0);
    if (first) xp = Math.round(xp * 1.5);
  } else if (opts.mode === 'gauntlet' && won) {
    drops = 5 + opts.run.round * 2;
  } else if (won) drops = 4;
  if (isMine(O.d) && O.d !== P.d) { if (won) O.d.l++; else O.d.w++; }
  const lv = mine ? gainXp(P.d, xp) : null;
  if (drops) setDrops(store.drops + drops);
  if (opts.mode === 'gauntlet') {
    const cleared = opts.run.round - (won ? 0 : 1);
    if (cleared > store.gauntletBest) store.gauntletBest = cleared;
  }
  cache.delete(P.d.id);
  save();

  $('actionPad').hidden = true;
  $('result').hidden = false;
  const t = $('resultTitle');
  t.textContent = won ? (opts.mode === 'gauntlet' ? `Round ${opts.run.round} cleared` : `${P.d.name} wins`) : `${O.d.name} wins`;
  t.className = 'result-title' + (won ? ' won' : '');
  const rs = $('resultStars');
  rs.hidden = opts.mode !== 'adv' || !won;
  rs.innerHTML = [0, 1, 2].map((k) => `<svg class="${k < stars ? 'got' : ''}" style="animation-delay:${k * 160}ms"><use href="#i-star"/></svg>`).join('');
  let sub = '';
  if (opts.mode === 'adv') {
    sub = won ? (stars < 3 ? `Win with ${stars === 2 ? 'over 60%' : 'over 30%'} HP left for ${stars === 2 ? '3 stars' : 'more stars'}.` : 'Perfect page.')
      : `${O.d.name} had ${O.hp} HP left. ${P.d.lvl < O.d.lvl ? `It's LV ${O.d.lvl}, yours is LV ${P.d.lvl}. Level up in the Gauntlet, or try a different ink.` : 'Block on the red to soak up hits.'}`;
  } else if (opts.mode === 'gauntlet') {
    sub = won ? `${P.d.name} keeps ${P.hp} HP and heals 30% before the next round.` : `The run ends after ${opts.run.round - 1} round${opts.run.round === 2 ? '' : 's'}. Best: ${store.gauntletBest}.`;
  } else {
    sub = won ? 'Nice timing.' : `${O.d.name} had ${O.hp} HP left. Block on the red to soak up hits.`;
  }
  const evoNow = mine && evoReady(P.d) > 0 && lv && lv.ups > 0 && EVO_LEVELS.some((l) => l > lv.start.lvl && l <= P.d.lvl);
  if (evoNow) sub += ` ${P.d.name} can evolve!`;
  $('resultSub').textContent = sub;

  const xl = $('xpLine');
  xl.hidden = !mine;
  if (mine) {
    const em = $('resXp');
    $('resLvl').textContent = `LV ${lv.start.lvl}`;
    $('resXpText').textContent = `+${xp} XP`;
    em.style.transition = 'none'; em.style.width = `${Math.round((lv.start.xp / xpToNext(lv.start.lvl)) * 100)}%`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      em.style.transition = '';
      if (lv.ups) {
        em.style.width = '100%';
        setTimeout(() => {
          if (B !== b) return;
          $('resLvl').textContent = `LV ${P.d.lvl}`;
          em.style.transition = 'none'; em.style.width = '0%';
          stamp(`Level ${P.d.lvl}!`, 'solid'); sfx('levelup');
          requestAnimationFrame(() => requestAnimationFrame(() => { em.style.transition = ''; em.style.width = `${Math.round((P.d.xp / xpToNext(P.d.lvl)) * 100)}%`; }));
        }, 950);
      } else em.style.width = `${Math.round((P.d.xp / xpToNext(P.d.lvl)) * 100)}%`;
    }));
  }
  $('resDrops').innerHTML = drops ? `+${drops} ink drops${first ? ' · first clear bonus' : ''}` : '';
  if (drops) setTimeout(() => sfx('drop'), 500);

  // buttons per mode
  const pri = $('resPrimary'), sec = $('resSecondary'), home = $('resHome');
  let onPri, onSec;
  const onHome = () => { B = null; opts.mode === 'adv' ? openMap() : renderHome(); };
  home.textContent = opts.mode === 'adv' ? 'Map' : 'Done';
  if (evoNow) {
    pri.textContent = `Evolve ${P.d.name}`; onPri = () => { B = null; startEvolve(P.d); };
    sec.textContent = 'Later'; onSec = onHome;
  } else if (opts.mode === 'adv') {
    const nk = opts.i < 4 ? { ch: opts.ch, i: opts.i + 1 } : opts.ch < CHAPTERS.length - 1 ? { ch: opts.ch + 1, i: 0 } : null;
    if (won && nk) { pri.textContent = 'Next fight'; onPri = () => { B = null; openMon(opponent(nk.ch, nk.i), 'foe', nk); }; }
    else if (won) { pri.textContent = 'Back to the map'; onPri = onHome; }
    else { pri.textContent = 'Try again'; onPri = () => startBattle(P.d, O.d, opts); }
    sec.textContent = won ? 'Replay' : 'Other fighter'; onSec = won ? () => startBattle(P.d, O.d, opts) : () => { B = null; chooseFighter(O.d, (f) => startBattle(f, O.d, opts)); };
  } else if (opts.mode === 'gauntlet') {
    if (won) {
      pri.textContent = `Round ${opts.run.round + 1}`;
      onPri = () => nextRound(P.d, { round: opts.run.round + 1, hp: Math.min(P.max, P.hp + Math.round(P.max * 0.3)) });
      sec.textContent = 'Cash out'; onSec = onHome;
    } else {
      pri.textContent = 'New run'; onPri = () => startGauntlet(P.d);
      sec.textContent = 'Other fighter'; onSec = () => { B = null; chooseFighter(null, (f) => startGauntlet(f), 'Who runs the Gauntlet?'); };
    }
  } else {
    pri.textContent = 'Rematch'; onPri = () => startBattle(P.d, O.d, opts);
    sec.textContent = 'New opponent'; onSec = () => { B = null; openPick('opponent', P.d); };
  }
  pri.onclick = () => { sfx('tap'); onPri(); };
  sec.onclick = () => { sfx('tap'); onSec(); };
  home.onclick = () => { sfx('tap'); onHome(); };
}

// ---------- gauntlet ----------
function gauntletFoe(f, round) {
  const seed = (Date.now() + round * 7919) >>> 0;
  return generate({ seed, level: Math.max(1, f.lvl - 1 + Math.floor(round / 2)), parts: Math.min(3, Math.floor(round / 3) + (Math.random() < 0.5 ? 1 : 0)), boss: round % 5 === 0 });
}
function startGauntlet(f) { nextRound(f, { round: 1, hp: undefined }); }
function nextRound(f, run) {
  const foe = gauntletFoe(f, run.round);
  if (foe.boss) foe.name = `${foe.name} the Big`;
  startBattle(f, foe, { mode: 'gauntlet', run, theme: THEMES[(run.round - 1) % THEMES.length] });
}

// ---------- move animations (attacker a, defender d) ----------
const contact = (a, d, k) => d.st.x - Math.sign(d.st.x - a.st.x) * (a.mon.full.w * a.s + d.mon.full.w * d.s) * k;
const ANIM = {
  async rush(b, a, d, impact) {
    const dir = Math.sign(d.st.x - a.st.x), home = a.home, w = arena.w, cx = contact(a, d, 0.42);
    await tween(260, (k) => { a.st.x = home - dir * w * 0.04 * ease.out(k); a.st.sqx = 0.12 * k; a.st.sqy = -0.1 * k; lean(a.st, -dir * 0.16 * k); });
    sfx('whoosh');
    const x1 = a.st.x;
    await tween(150, (k) => { a.st.x = lerp(x1, cx, ease.in(k)); a.st.sqx = 0.12 - 0.22 * k; a.st.sqy = -0.1 + 0.16 * k; lean(a.st, dir * 0.24 * k); });
    await impact();
    a.st.walk = 1;
    await tween(440, (k) => { a.st.x = lerp(cx, home, ease.inOut(k)); a.st.sqx = lerp(-0.1, 0, k); a.st.sqy = lerp(0.06, 0, k); lean(a.st, dir * 0.24 * (1 - k)); });
    a.st.walk = 0; a.st.rot = 0;
  },
  async gore(b, a, d, impact) {
    const dir = Math.sign(d.st.x - a.st.x), home = a.home, w = arena.w, cx = contact(a, d, 0.4);
    await tween(300, (k) => { a.st.x = home - dir * w * 0.05 * ease.out(k); lean(a.st, dir * 0.35 * k); a.st.sqy = -0.12 * k; });
    sfx('whoosh');
    const x1 = a.st.x;
    await tween(140, (k) => { a.st.x = lerp(x1, cx, ease.in(k)); });
    await impact();
    a.st.walk = 1;
    await tween(440, (k) => { a.st.x = lerp(cx, home, ease.inOut(k)); lean(a.st, dir * 0.35 * (1 - k)); a.st.sqy = -0.12 * (1 - k); });
    a.st.walk = 0; a.st.rot = 0;
  },
  async slam(b, a, d, impact) {
    const dir = Math.sign(d.st.x - a.st.x), home = a.home, h = arena.h, cx = contact(a, d, 0.36);
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
    const dir = Math.sign(d.st.x - a.st.x), home = a.home, h = arena.h, cx = contact(a, d, 0.4);
    await tween(130, (k) => { a.st.sqy = -0.16 * k; a.st.sqx = 0.1 * k; lean(a.st, dir * 0.15 * k); });
    sfx('whoosh');
    await tween(300, (k) => { a.st.x = lerp(home, cx, ease.out(k)); a.st.y = -Math.sin(Math.PI * k) * h * 0.17; a.st.sqy = lerp(0.14, 0, k); a.st.sqx = lerp(-0.1, 0, k); });
    a.st.y = 0;
    await impact();
    a.st.walk = 1.2;
    await tween(380, (k) => { a.st.x = lerp(cx, home, ease.inOut(k)); lean(a.st, dir * 0.15 * (1 - k)); });
    a.st.walk = 0; a.st.rot = 0;
  },
  async chomp(b, a, d, impact) {
    const dir = Math.sign(d.st.x - a.st.x), home = a.home, h = arena.h, cx = contact(a, d, 0.38);
    await tween(160, (k) => { a.st.sqy = -0.16 * k; a.st.mouth = k; });
    sfx('whoosh');
    await tween(300, (k) => { a.st.x = lerp(home, cx, ease.out(k)); a.st.y = -Math.sin(Math.PI * k) * h * 0.14; a.st.mouth = 1; a.st.sqy = lerp(0.1, 0, k); });
    a.st.y = 0; a.st.mouth = 0.1;
    await impact();
    await tween(120, (k) => { a.st.mouth = 1 - k; });
    a.st.walk = 1.2;
    await tween(380, (k) => { a.st.x = lerp(cx, home, ease.inOut(k)); });
    a.st.walk = 0; a.st.rot = 0;
  },
  async flurry(b, a, d, impact, hits) {
    const dir = Math.sign(d.st.x - a.st.x), home = a.home, w = arena.w, cx = contact(a, d, 0.46);
    a.st.walk = 1.6;
    await tween(240, (k) => { a.st.x = lerp(home, cx, ease.inOut(k)); });
    for (let i = 0; i < hits; i++) {
      sfx('whoosh');
      await tween(80, (k) => { a.st.x = cx + dir * w * 0.025 * k; lean(a.st, dir * 0.2 * k); });
      await impact();
      await tween(90, (k) => { a.st.x = cx + dir * w * 0.025 * (1 - k); lean(a.st, dir * 0.2 * (1 - k)); });
    }
    await tween(420, (k) => { a.st.x = lerp(cx, home, ease.inOut(k)); });
    a.st.walk = 0; a.st.rot = 0;
  },
  async punch(b, a, d, impact, hits) {
    const home = a.home, cx = contact(a, d, 0.5);
    a.st.walk = 1.4;
    await tween(260, (k) => { a.st.x = lerp(home, cx, ease.inOut(k)); });
    a.st.walk = 0;
    for (let i = 0; i < hits; i++) {
      await tween(hits > 1 ? 90 : 220, (k) => { a.st.punch = -0.4 * k; });
      sfx('whoosh');
      await tween(hits > 1 ? 70 : 110, (k) => { a.st.punch = lerp(-0.4, 1, ease.in(k)); });
      await impact();
      await tween(hits > 1 ? 80 : 200, (k) => { a.st.punch = 1 - k; });
    }
    a.st.punch = 0; a.st.walk = 1;
    await tween(400, (k) => { a.st.x = lerp(cx, home, ease.inOut(k)); });
    a.st.walk = 0;
  },
  async sweep(b, a, d, impact) {
    const dir = Math.sign(d.st.x - a.st.x), home = a.home, cx = contact(a, d, 0.48);
    a.st.walk = 1.4;
    await tween(260, (k) => { a.st.x = lerp(home, cx, ease.inOut(k)); });
    a.st.walk = 0;
    sfx('whoosh');
    let hitDone = false;
    await tween(420, (k) => {
      lean(a.st, -dir * Math.PI * 2 * ease.inOut(k));
      if (!hitDone && k > 0.55) { hitDone = true; impact(); }
    });
    a.st.rot = 0;
    await wait(120);
    a.st.walk = 1;
    await tween(380, (k) => { a.st.x = lerp(cx, home, ease.inOut(k)); });
    a.st.walk = 0;
  },
  async roll(b, a, d, impact) {
    const dir = Math.sign(d.st.x - a.st.x), home = a.home, cx = contact(a, d, 0.44);
    await tween(200, (k) => lean(a.st, -dir * 0.3 * k));
    sfx('whoosh');
    await tween(480, (k) => { a.st.x = lerp(home, cx, ease.in(k)); lean(a.st, -dir * 0.3 + dir * Math.PI * 2 * k); });
    await impact();
    await tween(520, (k) => { a.st.x = lerp(cx, home, ease.inOut(k)); lean(a.st, dir * Math.PI * 2 * (1 - k)); });
    a.st.rot = 0;
  },
};

$('battleQuit').addEventListener('click', () => {
  sfx('tap');
  const mode = B && B.opts.mode;
  B = null; meterTick = meterTap = null; movePick = null;
  mode === 'adv' ? openMap() : renderHome();
});

// ---------- share links ----------
// links always point at the public copy, so a monster shared from the PC or tailnet still opens for anyone
const PUBLIC_URL = 'https://elijahmanlockedin112.github.io/ink-monsters/';
async function share(d) {
  const code = await encodeMonster(d);
  const base = location.hostname.endsWith('github.io') ? `${location.origin}${location.pathname}` : PUBLIC_URL;
  const url = `${base}#m=${code}`;
  const text = `${d.name} (LV ${d.lvl}) wants a fight. Draw a monster that can beat it.`;
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
    const d = normalize(await decodeMonster(m[1]));
    const seed = hashData(d);
    const known = [...store.mine, ...store.challengers].find((x) => hashData(x) === seed);
    if (known) { openMon(known, isMine(known) ? 'mine' : 'incoming'); return true; }
    d.id = 'c' + seed.toString(36);
    d.name = d.name || monsterName(seed);
    store.challengers.unshift(d);
    save();
    openMon(d, 'incoming');
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
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#m=')) { B = null; meterTick = meterTap = null; readIncoming(); } });
// iOS unlocks audio on touchend/click, not on pointerdown
for (const ev of ['touchend', 'click', 'keydown']) document.addEventListener(ev, unlock, { passive: true });

window.__ink = {
  store, mon, opponent, get B() { return B; }, get screen() { return screen; }, get part() { return D.part; }, get drawing() { return D.data; }, get drawState() { return { active: D.active, cur: D.cur && D.cur.length, history: D.history.slice() }; },
  grant(n) { setDrops(store.drops + n); },
};

(async () => {
  if (!(await readIncoming())) renderHome();
  requestAnimationFrame(frame);
})();
