// Turns a drawing into a living monster: silhouette, stats, moves, rig, and how to draw one frame of it.
import { bbox, clamp, convexHull, hashData, rng, simplify, strokeLen } from './geom.js';
import { ELEMENTS, LIMB_KEYS, MOVES, PATTERNS, TINTS } from './parts.js';

export const INK = '#1d1a17';
export const SIGNAL = '#e2401c';

const G = 200; // silhouette grid size (1 cell = 5 drawing units)

// fills in fields older saves and links don't have
export function normalize(d) {
  d.parts = d.parts || {};
  for (const k of LIMB_KEYS) d.parts[k] = Array.isArray(d.parts[k]) ? d.parts[k] : [];
  d.legs = d.legs || [];
  d.eyes = d.eyes || [];
  d.ink = ELEMENTS[d.ink] ? d.ink : 'neutral';
  d.pattern = PATTERNS.some((p) => p.key === d.pattern) ? d.pattern : 'plain';
  d.tint = clamp(d.tint | 0, 0, TINTS.length - 1);
  d.lvl = clamp(d.lvl | 0 || 1, 1, 99);
  d.xp = d.xp | 0;
  d.evo = d.evo | 0;
  d.w = d.w | 0; d.l = d.l | 0;
  return d;
}

function orient(stroke, c) {
  const a = stroke[0], b = stroke[stroke.length - 1];
  const da = Math.hypot(a[0] - c.cx, a[1] - c.cy), db = Math.hypot(b[0] - c.cx, b[1] - c.cy);
  return da <= db ? stroke : stroke.slice().reverse();
}

function drawPattern(g, key, seed) {
  const r = rng(seed + 11);
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = g.strokeStyle = 'rgba(29,26,23,0.16)';
  if (key === 'spots') {
    for (let i = 0; i < 46; i++) { g.beginPath(); g.arc(r() * G, r() * G, 2.5 + r() * 5, 0, Math.PI * 2); g.fill(); }
  } else if (key === 'stripes') {
    g.lineWidth = 4;
    for (let x = -G; x < G * 2; x += 13) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + G * 0.6, G); g.stroke(); }
  } else if (key === 'scales') {
    g.lineWidth = 1.6;
    for (let y = 0, row = 0; y < G + 10; y += 7, row++) {
      for (let x = (row % 2) * 6; x < G + 10; x += 12) { g.beginPath(); g.arc(x, y, 6, 0.1, Math.PI - 0.1); g.stroke(); }
    }
  } else if (key === 'stars') {
    for (let i = 0; i < 26; i++) {
      const cx = r() * G, cy = r() * G, R = 3 + r() * 3.5;
      g.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? R * 0.45 : R;
        k ? g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      g.fill();
    }
  }
  g.restore();
}

function silhouette(body, tint, pattern, seed) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = G;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const k = G / 1000;
  g.lineCap = g.lineJoin = 'round';
  g.strokeStyle = '#000';
  for (const s of body) {
    g.lineWidth = s[0][2] * k + 3; // a little fatter than the ink so small gaps close
    g.beginPath();
    g.moveTo(s[0][0] * k, s[0][1] * k);
    for (const p of s) g.lineTo(p[0] * k, p[1] * k);
    if (s.length === 1) g.lineTo(s[0][0] * k + 0.1, s[0][1] * k);
    g.stroke();
  }
  const img = g.getImageData(0, 0, G, G);
  const ink = new Uint8Array(G * G);
  let inkCount = 0;
  for (let i = 0; i < G * G; i++) if (img.data[i * 4 + 3] > 40) { ink[i] = 1; inkCount++; }
  const out = new Uint8Array(G * G);
  const q = [];
  for (let i = 0; i < G; i++) q.push(i, (G - 1) * G + i, i * G, i * G + G - 1);
  while (q.length) {
    const i = q.pop();
    if (out[i] || ink[i]) continue;
    out[i] = 1;
    const x = i % G, y = (i / G) | 0;
    if (x > 0) q.push(i - 1); if (x < G - 1) q.push(i + 1);
    if (y > 0) q.push(i - G); if (y < G - 1) q.push(i + G);
  }
  let inside = new Uint8Array(G * G), area = 0;
  for (let i = 0; i < G * G; i++) if (!out[i]) { inside[i] = 1; area++; }
  // the wash covers the enclosed holes grown 2px into the ink, so it tucks under the line instead of haloing past it
  let paint = new Uint8Array(G * G);
  for (let i = 0; i < G * G; i++) if (inside[i] && !ink[i]) paint[i] = 1;
  for (let pass = 0; pass < 2; pass++) {
    const next = paint.slice();
    for (let i = 0; i < G * G; i++) {
      if (paint[i] || !inside[i]) continue;
      const x = i % G;
      if ((x > 0 && paint[i - 1]) || (x < G - 1 && paint[i + 1]) || (i >= G && paint[i - G]) || (i < G * G - G && paint[i + G])) next[i] = 1;
    }
    paint = next;
  }
  // an open outline leaks and encloses (almost) nothing: fall back to the convex hull of the ink
  const holes = area - inkCount;
  if (holes < Math.max(150, inkCount * 0.15)) {
    const hull = convexHull(body.flat());
    g.clearRect(0, 0, G, G);
    g.fillStyle = '#000';
    g.beginPath();
    hull.forEach((p, i) => (i ? g.lineTo(p[0] * k, p[1] * k) : g.moveTo(p[0] * k, p[1] * k)));
    g.fill();
    const im2 = g.getImageData(0, 0, G, G);
    area = 0; inside = new Uint8Array(G * G); paint = new Uint8Array(G * G);
    for (let i = 0; i < G * G; i++) {
      if (im2.data[i * 4 + 3] > 40) paint[i] = 1;
      if (im2.data[i * 4 + 3] > 40 || ink[i]) { inside[i] = 1; area++; }
    }
  }
  const fill = g.createImageData(G, G);
  const r = parseInt(tint.slice(1, 3), 16), gg = parseInt(tint.slice(3, 5), 16), b = parseInt(tint.slice(5, 7), 16);
  for (let i = 0; i < G * G; i++) if (paint[i]) { fill.data[i * 4] = r; fill.data[i * 4 + 1] = gg; fill.data[i * 4 + 2] = b; fill.data[i * 4 + 3] = 255; }
  g.clearRect(0, 0, G, G);
  g.putImageData(fill, 0, 0);
  if (pattern !== 'plain') drawPattern(g, pattern, seed);
  const tops = [];
  for (let x = 0; x < G; x++) {
    for (let y = 0; y < G; y++) if (inside[y * G + x]) { tops.push(1 - y / G); break; }
  }
  return { canvas: cv, area: area / (G * G), tops };
}

function spikiness(body) {
  let sum = 0, per = 0;
  for (const s of body) {
    const p = simplify(s, 9);
    per += strokeLen(p);
    for (let i = 1; i < p.length - 1; i++) {
      const a = Math.atan2(p[i][1] - p[i - 1][1], p[i][0] - p[i - 1][0]);
      const b = Math.atan2(p[i + 1][1] - p[i][1], p[i + 1][0] - p[i][0]);
      let t = Math.abs(b - a); if (t > Math.PI) t = 2 * Math.PI - t;
      if (t > 0.87) sum += t - 0.87;
    }
  }
  return per > 0 ? clamp(sum / (per / 100) / 0.85, 0, 1) : 0;
}

// the base numbers a drawing earns before levels
function baseStats(size, spike, legPower, parts) {
  let wH = 0.25 + size * 1.2, wP = 0.25 + spike * 1.2, wS = 0.25 + legPower * 1.2;
  const sum = wH + wP + wS; wH /= sum; wP /= sum; wS /= sum;
  return {
    hp: 60 + 80 * wH,
    pow: (14 + 30 * wP) * (1 + 0.03 * Math.min(3, parts.horns.length) + 0.02 * Math.min(4, parts.arms.length)),
    spd: 10 + 85 * wS + 3 * Math.min(4, parts.wings.length),
    w: { wH, wP, wS },
  };
}

export function scaledStats(base, lvl, evo) {
  return {
    hp: Math.round(base.hp * (1 + 0.08 * (lvl - 1)) * (1 + 0.06 * evo)),
    pow: Math.round(base.pow * (1 + 0.065 * (lvl - 1)) * (1 + 0.06 * evo)),
    spd: Math.round(base.spd + 0.9 * (lvl - 1) + 2 * evo),
  };
}

export function makeMonster(d) {
  normalize(d);
  const seed = hashData(d);
  const tint = TINTS[d.tint].c;
  const bb = bbox(d.body);
  const legs = d.legs.map((l) => orient(l, bb));
  const parts = {};
  for (const k of LIMB_KEYS) parts[k] = d.parts[k].map((s) => orient(s, bb));
  const sil = silhouette(d.body, tint, d.pattern, seed);
  const groundY = legs.length ? Math.max(bb.y + bb.h, ...legs.flat().map((p) => p[1] + p[2] / 2)) : bb.y + bb.h;
  const full = bbox([...d.body, ...legs, ...LIMB_KEYS.flatMap((k) => parts[k])]);
  const size = clamp(Math.sqrt(sil.area) / 0.62, 0, 1);
  const spike = spikiness(d.body);
  const legLens = legs.map(strokeLen);
  const avgLeg = legLens.length ? legLens.reduce((a, b) => a + b, 0) / legLens.length : 0;
  const legPower = legs.length ? clamp(Math.pow(legs.length, 0.6) * (avgLeg / Math.max(bb.h, 120)) * 0.75, 0.1, 1) : 0;
  const base = baseStats(size, spike, legPower, parts);
  const stats = scaledStats(base, d.lvl, d.evo);
  const { wH, wP, wS } = base.w;

  let basic;
  if (!legs.length) basic = 'roll';
  else if (wP >= wH && wP >= wS) basic = 'rush';
  else if (wH >= wS) basic = 'slam';
  else basic = legs.length >= 3 ? 'flurry' : 'pounce';
  const adj = {
    rush: spike > 0.6 ? 'Thorn' : 'Jagged', slam: size > 0.6 ? 'Belly' : 'Heavy', pounce: 'Sneaky',
    flurry: legs.length >= 6 ? 'Scuttle' : 'Rapid', roll: 'Wobble',
  }[basic];

  const partMoves = [];
  if (parts.arms.length) partMoves.push(parts.arms.length >= 3 ? 'fists' : 'haymaker');
  if (parts.horns.length) partMoves.push('gore');
  if (parts.mouth.length) partMoves.push('chomp');
  if (parts.tail.length) partMoves.push('sweep');
  if (parts.wings.length) partMoves.push('fly');
  if (d.eyes.length >= 3) partMoves.push('glare');
  const moves = [basic, ...partMoves.slice(0, 3)];
  if (moves.length < 4) moves.push('inkup');

  const focus = (1 + 0.1 * Math.min(4, Math.max(0, d.eyes.length - 1))) * (d.ink === 'neutral' ? 1.25 : 1);

  const why = [];
  why.push(stats.hp >= base.hp * 1.6 ? 'Tough from all that training.' : base.hp >= 95 ? 'Big body, lots of HP.' : base.hp <= 78 ? 'Small body, not much HP.' : 'Medium body, medium HP.');
  why.push(base.pow >= 27 ? 'Spiky, so it hits hard.' : base.pow <= 21 ? 'Smooth outline, soft hits.' : 'A few sharp corners for punch.');
  const n = legs.length, legWord = `${n} leg${n > 1 ? 's' : ''}`;
  why.push(!n ? 'No legs, so it rolls.' : base.spd >= 45 ? `${legWord}, quick on its feet.` : base.spd <= 30 ? `${legWord}, but short ones. Slow.` : `${legWord}, steady speed.`);
  if (d.eyes.length >= 2) why.push(`${d.eyes.length} eyes make crits easier.`);
  if (partMoves.length > 3) why.push('Only 3 part moves fit, the rest still add stats.');

  // limbs swing in alternating pairs, front to back
  const rig = (list, spread) => {
    const order = list.map((l, i) => [l[0][0], i]).sort((a, b) => a[0] - b[0]);
    const out = list.map((pts) => ({ pts, phase: 0 }));
    order.forEach(([, i], k) => { out[i].phase = (k % 2) * Math.PI + Math.floor(k / 2) * spread; });
    return out;
  };
  const mouthBox = parts.mouth.length ? bbox(parts.mouth) : null;

  return {
    data: d, tint, ink: ELEMENTS[d.ink].color, element: d.ink, sil, bb, full, groundY, cx: full.cx, seed,
    legs: rig(legs, 0.7), arms: rig(parts.arms, 0.9), wings: rig(parts.wings, 0.4), tail: rig(parts.tail, 1.1),
    horns: parts.horns, mouth: parts.mouth, mouthBox,
    stats, base, moves, basic, basicName: `${adj} ${MOVES[basic].name}`, focus, why,
    size, spike, legPower,
  };
}

export const moveName = (m, key) => (key === m.basic ? m.basicName : MOVES[key].name);

export function newState(mon, x, gy, face = 1) {
  return {
    x, gy, y: 0, face, sqx: 0, sqy: 0, rot: 0, tilt: 0, phase: 0, walk: 0, flash: 0, ko: 0, t: Math.random() * 10,
    blink: 0, nextBlink: 1 + Math.random() * 3, lookX: face, lookY: 0, punch: 0, mouth: 0, flap: 0, stun: 0,
    eyes: mon.data.eyes.map(() => ({ ox: 0, oy: 0, vx: 0, vy: 0 })), px: x, py: 0, vx: 0, vy: 0,
  };
}

export function updateState(st, dt) {
  st.t += dt;
  if (st.walk > 0) st.phase += dt * 11 * st.walk;
  st.flash = Math.max(0, st.flash - dt * 3.5);
  st.mouth = Math.max(0, st.mouth - dt * 2.2);
  st.nextBlink -= dt;
  if (st.nextBlink <= 0) { st.blink = 0.14; st.nextBlink = 2 + Math.random() * 4; }
  st.blink = Math.max(0, st.blink - dt);
  // googly pupils: springs pulled toward the look direction, shoved by body acceleration
  const nvx = (st.x - st.px) / Math.max(dt, 1e-3), nvy = (st.y - st.py) / Math.max(dt, 1e-3);
  const ax = (nvx - st.vx), ay = (nvy - st.vy);
  st.vx = nvx; st.vy = nvy; st.px = st.x; st.py = st.y;
  for (const e of st.eyes) {
    const tx = st.lookX * st.face * 0.55, ty = st.lookY * 0.55 + 0.25;
    e.vx += ((tx - e.ox) * 90 - e.vx * 9) * dt - clamp(ax * st.face, -4000, 4000) * 0.0009;
    e.vy += ((ty - e.oy) * 90 - e.vy * 9) * dt - clamp(ay, -4000, 4000) * 0.0009;
    e.ox += e.vx * dt; e.oy += e.vy * dt;
    const m = Math.hypot(e.ox, e.oy);
    if (m > 1) { e.ox /= m; e.oy /= m; e.vx *= -0.4; e.vy *= -0.4; }
  }
}

function inkStroke(ctx, pts, minW, color) {
  ctx.strokeStyle = color;
  if (pts.length === 1) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], Math.max(pts[0][2], minW) / 2, 0, Math.PI * 2); ctx.fill();
    return;
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    ctx.lineWidth = Math.max((a[2] + b[2]) / 2, minW);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
}

// rotates a limb about its root; bend > 0 curls the far end more than the near end
function swing(pts, ang, bend, dy = 0) {
  const [rx, ry] = pts[0];
  const n = pts.length;
  return pts.map((p, j) => {
    const f = n > 1 ? j / (n - 1) : 0;
    const a = ang * (1 - bend + bend * f);
    const dx = p[0] - rx, dyy = p[1] - ry;
    return [rx + dx * Math.cos(a) - dyy * Math.sin(a), ry + dy + dx * Math.sin(a) + dyy * Math.cos(a), p[2]];
  });
}

// Draws the monster with its ground point at (st.x, st.gy + st.y), s pixels per drawing unit.
export function drawMonster(ctx, mon, st, s) {
  const minW = 1.3 / s;
  const ink = st.flash > 0.05 ? (mon.element === 'fire' ? INK : SIGNAL) : mon.ink;
  const fwd = mon.faceSign || 1; // which way the drawing faces in its own space
  ctx.save();
  ctx.translate(st.x, st.gy + st.y);
  ctx.scale(st.face * s * (1 + st.sqx), s * (1 + st.sqy));
  ctx.translate(-mon.cx, -mon.groundY);
  const bc = mon.bb;
  if (st.rot || st.tilt) {
    ctx.translate(bc.cx, bc.cy); ctx.rotate(st.rot + st.tilt); ctx.translate(-bc.cx, -bc.cy);
  }
  ctx.lineCap = ctx.lineJoin = 'round';
  const idle = st.walk < 0.05;
  const bob = idle ? Math.sin(st.t * 2.6) * 6 : -Math.abs(Math.sin(st.phase)) * 22 * st.walk;
  const ko = st.ko > 0.5;

  // behind the body: wings, tail, legs
  mon.wings.forEach((w, i) => {
    const speed = st.flap > 0 ? 17 : 3.2;
    const amp = st.flap > 0 ? 0.55 : 0.13 + st.walk * 0.15;
    const ang = ko ? 0.6 : Math.sin(st.t * speed + i * 0.8) * amp;
    inkStroke(ctx, swing(w.pts, ang * (i % 2 ? -1 : 1), 0, bob), minW, ink);
  });
  mon.tail.forEach((tl) => {
    const ang = ko ? 0.3 : Math.sin(st.t * 5 + tl.phase) * 0.22 + Math.sin(st.phase) * 0.2 * st.walk;
    inkStroke(ctx, swing(tl.pts, ang, 0.7, bob * 0.7), minW, ink);
  });
  for (const leg of mon.legs) {
    const ang = ko ? 0.5 * Math.sin(st.t * 9 + leg.phase) : Math.sin(st.phase + leg.phase) * 0.5 * st.walk;
    inkStroke(ctx, swing(leg.pts, ang, 0.6, bob * 0.4), minW, ink);
  }

  ctx.translate(0, bob);
  ctx.globalAlpha = 0.92;
  ctx.drawImage(mon.sil.canvas, 0, 0, 1000, 1000);
  ctx.globalAlpha = 1;
  for (const s2 of mon.data.body) inkStroke(ctx, s2, minW, ink);
  for (const h of mon.horns) inkStroke(ctx, h, minW, ink);

  // mouth: a second copy of the line drops down and the gap fills dark when it opens
  for (const m of mon.mouth) {
    if (st.mouth > 0.02 && mon.mouthBox) {
      const drop = st.mouth * Math.max(36, mon.mouthBox.w * 0.4);
      ctx.fillStyle = ink;
      ctx.beginPath();
      m.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      for (let i = m.length - 1; i >= 0; i--) ctx.lineTo(m[i][0], m[i][1] + drop);
      ctx.closePath(); ctx.fill();
      inkStroke(ctx, m.map((p) => [p[0], p[1] + drop, p[2]]), minW, ink);
    }
    inkStroke(ctx, m, minW, ink);
  }

  // arms in front: sway, swing with the walk, and throw forward on a punch
  mon.arms.forEach((arm, i) => {
    const ang = ko ? 0.4 : Math.sin(st.t * 2.2 + i) * 0.08 + Math.sin(st.phase + Math.PI + arm.phase) * 0.35 * st.walk - st.punch * 1.25 * fwd;
    inkStroke(ctx, swing(arm.pts, ang, 0.5), minW, ink);
  });

  // googly eyes
  mon.data.eyes.forEach((e, i) => {
    const pe = st.eyes[i] || { ox: 0, oy: 0 };
    ctx.fillStyle = '#fffdf8';
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(e.r * 0.16, minW);
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (ko) {
      const k = e.r * 0.45;
      ctx.lineWidth = Math.max(e.r * 0.2, minW);
      ctx.beginPath(); ctx.moveTo(e.x - k, e.y - k); ctx.lineTo(e.x + k, e.y + k); ctx.moveTo(e.x + k, e.y - k); ctx.lineTo(e.x - k, e.y + k); ctx.stroke();
      return;
    }
    if (st.stun > 0) {
      ctx.lineWidth = Math.max(e.r * 0.13, minW);
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 5; a += 0.3) {
        const rr = (a / (Math.PI * 5)) * e.r * 0.75, aa = a + st.t * 8;
        a ? ctx.lineTo(e.x + Math.cos(aa) * rr, e.y + Math.sin(aa) * rr) : ctx.moveTo(e.x, e.y);
      }
      ctx.stroke();
      return;
    }
    const pr = e.r * 0.48, reach = e.r - pr - e.r * 0.06;
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.arc(e.x + pe.ox * reach, e.y + pe.oy * reach, pr, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fffdf8';
    ctx.beginPath(); ctx.arc(e.x + pe.ox * reach - pr * 0.35, e.y + pe.oy * reach - pr * 0.35, pr * 0.28, 0, Math.PI * 2); ctx.fill();
    if (st.blink > 0) {
      ctx.fillStyle = mon.tint;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = Math.max(e.r * 0.16, minW);
      ctx.beginPath(); ctx.moveTo(e.x - e.r, e.y); ctx.lineTo(e.x + e.r, e.y); ctx.stroke();
    }
  });
  ctx.restore();
}

// Places one eye if the artist skipped eyes.
export function autoEyes(d) {
  const bb = bbox(d.body);
  const r = clamp(Math.min(bb.w, bb.h) * 0.13, 22, 56);
  return [{ x: Math.round(bb.x + bb.w * 0.62), y: Math.round(bb.y + bb.h * 0.34), r: Math.round(r) }];
}
