// Turns a drawing into a living monster: silhouette, stats, move, rig, and how to draw one frame of it.
import { bbox, clamp, convexHull, hashData, simplify, strokeLen } from './geom.js';

export const INK = '#1d1a17';
export const SIGNAL = '#e2401c';
export const TINTS = ['#f2d27a', '#f1b7a0', '#a8d5c6', '#b8cbe9', '#dcc0a0'];

const G = 200; // silhouette grid size

export const MOVES = {
  rush: { name: 'Rush', mult: 1.15, hits: 1 },
  slam: { name: 'Slam', mult: 1.1, hits: 1 },
  pounce: { name: 'Pounce', mult: 1.0, hits: 1 },
  flurry: { name: 'Flurry', mult: 0.42, hits: 3 },
  roll: { name: 'Roll', mult: 1.05, hits: 1 },
};

function orientLeg(leg, c) {
  const a = leg[0], b = leg[leg.length - 1];
  const da = Math.hypot(a[0] - c.cx, a[1] - c.cy), db = Math.hypot(b[0] - c.cx, b[1] - c.cy);
  return da <= db ? leg : leg.slice().reverse();
}

function silhouette(body, tint) {
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
  // flood fill the outside from the border
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
    area = 0; inside = new Uint8Array(G * G);
    for (let i = 0; i < G * G; i++) if (im2.data[i * 4 + 3] > 40 || ink[i]) { inside[i] = 1; area++; }
    paint = new Uint8Array(G * G);
    for (let i = 0; i < G * G; i++) if (im2.data[i * 4 + 3] > 40) paint[i] = 1;
  }
  // paint the wash
  const fill = g.createImageData(G, G);
  const r = parseInt(tint.slice(1, 3), 16), gg = parseInt(tint.slice(3, 5), 16), b = parseInt(tint.slice(5, 7), 16);
  for (let i = 0; i < G * G; i++) if (paint[i]) { fill.data[i * 4] = r; fill.data[i * 4 + 1] = gg; fill.data[i * 4 + 2] = b; fill.data[i * 4 + 3] = 255; }
  g.clearRect(0, 0, G, G);
  g.putImageData(fill, 0, 0);
  // top contour, left to right, as 0..1 heights (1 = tall)
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

export function makeMonster(data) {
  const tint = TINTS[(data.tint ?? 0) % TINTS.length];
  const bb = bbox(data.body);
  const legs = data.legs.map((l) => orientLeg(l, bb));
  const sil = silhouette(data.body, tint);
  const allBottom = legs.length ? Math.max(bb.y + bb.h, ...legs.flat().map((p) => p[1] + p[2] / 2)) : bb.y + bb.h;
  const full = bbox([...data.body, ...legs]);
  const size = clamp(Math.sqrt(sil.area) / 0.62, 0, 1);
  const spike = spikiness(data.body);
  const legLens = legs.map(strokeLen);
  const avgLeg = legLens.length ? legLens.reduce((a, b) => a + b, 0) / legLens.length : 0;
  const legPower = legs.length ? clamp(Math.pow(legs.length, 0.6) * (avgLeg / Math.max(bb.h, 120)) * 0.75, 0.1, 1) : 0;

  let wH = 0.25 + size * 1.2, wP = 0.25 + spike * 1.2, wS = 0.25 + legPower * 1.2;
  const sum = wH + wP + wS; wH /= sum; wP /= sum; wS /= sum;
  const stats = {
    hp: Math.round(60 + 80 * wH),
    pow: Math.round(14 + 30 * wP),
    spd: Math.round(10 + 85 * wS),
  };
  let move;
  if (!legs.length) move = 'roll';
  else if (wP >= wH && wP >= wS) move = 'rush';
  else if (wH >= wS) move = 'slam';
  else move = legs.length >= 3 ? 'flurry' : 'pounce';

  const adj = {
    rush: spike > 0.6 ? 'Thorn' : 'Jagged',
    slam: size > 0.6 ? 'Belly' : 'Heavy',
    pounce: 'Sneaky',
    flurry: legs.length >= 6 ? 'Scuttle' : 'Rapid',
    roll: 'Wobble',
  }[move];

  // the sentence follows the final numbers, so it never contradicts the bars
  const why = [];
  why.push(stats.hp >= 95 ? 'Big body, lots of HP.' : stats.hp <= 78 ? 'Small body, not much HP.' : 'Medium body, medium HP.');
  why.push(stats.pow >= 27 ? 'Spiky outline, hard hits.' : stats.pow <= 21 ? 'Smooth outline, soft hits.' : 'A few sharp corners for punch.');
  const n = legs.length, legWord = `${n} leg${n > 1 ? 's' : ''}`;
  why.push(!n ? 'No legs, so it rolls.' : stats.spd >= 45 ? `${legWord}, quick on its feet.` : stats.spd <= 30 ? `${legWord}, but short ones. Slow.` : `${legWord}, steady speed.`);

  // legs walk in alternating pairs, front to back
  const order = legs.map((l, i) => [l[0][0], i]).sort((a, b) => a[0] - b[0]);
  const legRig = legs.map((pts) => ({ pts, phase: 0 }));
  order.forEach(([, i], k) => { legRig[i].phase = (k % 2) * Math.PI + Math.floor(k / 2) * 0.7; });

  return {
    data, tint, sil, bb, full, legs: legRig, stats, move, moveName: `${adj} ${MOVES[move].name}`, why,
    size, spike, legPower, groundY: allBottom, cx: full.cx, seed: hashData(data),
  };
}

export function newState(mon, x, gy, face = 1) {
  return {
    x, gy, y: 0, face, sqx: 0, sqy: 0, rot: 0, tilt: 0, phase: 0, walk: 0, flash: 0, ko: 0, t: Math.random() * 10,
    blink: 0, nextBlink: 1 + Math.random() * 3, lookX: face, lookY: 0,
    eyes: mon.data.eyes.map(() => ({ ox: 0, oy: 0, vx: 0, vy: 0 })), px: x, py: 0, vx: 0, vy: 0,
  };
}

export function updateState(st, dt) {
  st.t += dt;
  if (st.walk > 0) st.phase += dt * 11 * st.walk;
  st.flash = Math.max(0, st.flash - dt * 3.5);
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

// Draws the monster with its ground point at (st.x, st.gy + st.y), s pixels per drawing unit.
export function drawMonster(ctx, mon, st, s, opts = {}) {
  const minW = 1.3 / s;
  const ink = st.flash > 0.05 ? SIGNAL : INK;
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

  // legs, rotated about their roots with a bend toward the foot
  for (const leg of mon.legs) {
    const ang = st.ko ? 0.5 * Math.sin(st.t * 9 + leg.phase) * st.ko : Math.sin(st.phase + leg.phase) * 0.5 * st.walk;
    const [rx, ry] = leg.pts[0];
    const n = leg.pts.length;
    const pts = leg.pts.map((p, j) => {
      const f = n > 1 ? j / (n - 1) : 0;
      const a = ang * (0.4 + 0.6 * f);
      const dx = p[0] - rx, dy = p[1] - ry;
      return [rx + dx * Math.cos(a) - dy * Math.sin(a), ry + bob * 0.4 + dx * Math.sin(a) + dy * Math.cos(a), p[2]];
    });
    inkStroke(ctx, pts, minW, ink);
  }

  ctx.translate(0, bob);
  ctx.globalAlpha = 0.92;
  ctx.drawImage(mon.sil.canvas, 0, 0, 1000, 1000);
  ctx.globalAlpha = 1;
  for (const s2 of mon.data.body) inkStroke(ctx, s2, minW, ink);

  // googly eyes
  mon.data.eyes.forEach((e, i) => {
    const pe = st.eyes[i] || { ox: 0, oy: 0 };
    ctx.fillStyle = '#fffdf8';
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(e.r * 0.16, minW);
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (st.ko > 0.5) {
      const k = e.r * 0.45;
      ctx.lineWidth = Math.max(e.r * 0.2, minW);
      ctx.beginPath(); ctx.moveTo(e.x - k, e.y - k); ctx.lineTo(e.x + k, e.y + k); ctx.moveTo(e.x + k, e.y - k); ctx.lineTo(e.x - k, e.y + k); ctx.stroke();
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

// Places one eye if the artist skipped the eye step.
export function autoEyes(data) {
  const bb = bbox(data.body);
  const r = clamp(Math.min(bb.w, bb.h) * 0.13, 22, 56);
  return [{ x: Math.round(bb.x + bb.w * 0.62), y: Math.round(bb.y + bb.h * 0.34), r: Math.round(r) }];
}
