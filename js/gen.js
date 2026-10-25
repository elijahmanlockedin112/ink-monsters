// Draws monsters with code and a shaky hand: the house monsters, every Adventure opponent, and Gauntlet rounds.
import { clamp, monsterName, rng } from './geom.js';
import { ELEMENT_KEYS, TINTS } from './parts.js';

const CX = 500, CY = 460;

// a closed outline; shape decides how the radius changes around the loop
function outline(r, rx, ry, shape, { jitter = 7, w = 11, n = 110 } = {}) {
  const spikes = 8 + Math.floor(r() * 7), depth = 0.22 + r() * 0.16, bumps = 6 + Math.floor(r() * 5);
  const phase = r() * 6, start = -1.6;
  const pts = [];
  for (let i = 0; i <= n + 3; i++) {
    const a = start + (i / n) * Math.PI * 2;
    let k = 1;
    if (shape === 'spiky') { const f = ((i / n) * spikes) % 1; k = f < 0.5 ? 1 - depth + depth * 2 * f : 1 + depth - depth * 2 * f; }
    else if (shape === 'cloud') k = 1 - depth * 0.6 + depth * 0.6 * Math.abs(Math.sin((a * bumps) / 2));
    else if (shape === 'box') k = 1 / Math.pow(Math.pow(Math.abs(Math.cos(a)), 4) + Math.pow(Math.abs(Math.sin(a)), 4), 0.25);
    else if (shape === 'pear') k = Math.sin(a) < 0 ? 0.78 + 0.22 * (1 - Math.abs(Math.sin(a))) : 1;
    const wob = Math.sin(a * 3 + phase) * jitter * 0.6 + (r() - 0.5) * jitter;
    pts.push([Math.round(CX + Math.cos(a) * (rx * k + wob)), Math.round(CY + Math.sin(a) * (ry * k + wob)), w + (r() - 0.5) * 3]);
  }
  return pts;
}

// a hand-drawn quadratic curve
function quad(r, x0, y0, x1, y1, x2, y2, { n = 14, w = 10 } = {}) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push([
      Math.round(u * u * x0 + 2 * u * t * x1 + t * t * x2 + (r() - 0.5) * 3),
      Math.round(u * u * y0 + 2 * u * t * y1 + t * t * y2 + (r() - 0.5) * 3),
      w + (r() - 0.5) * 2,
    ]);
  }
  return pts;
}

const clampPts = (s) => s.map(([x, y, w]) => [clamp(x, 0, 1000), clamp(y, 0, 1000), w]);

const SHAPES = ['blob', 'spiky', 'bean', 'tall', 'cloud', 'box', 'pear'];

// opts: seed, level, element, parts (how many limb kinds), boss, shape, name, tint
export function generate(opts) {
  const seed = opts.seed >>> 0;
  const r = rng(seed * 7919 + 13);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const shape = opts.shape || pick(SHAPES);
  const big = opts.boss ? 1.12 : 1;
  let rx = (170 + r() * 80) * big, ry = (150 + r() * 70) * big;
  if (shape === 'bean') { rx = 270 * big; ry = 105 + r() * 25; }
  if (shape === 'tall') { rx = 130 + r() * 30; ry = 220 * big; }
  const w = opts.boss ? 13 : 11;
  const body = [outline(r, rx, ry, shape === 'bean' || shape === 'tall' ? 'blob' : shape, { w })];
  const edge = (a, inset = 8) => [CX + Math.cos(a) * (rx - inset), CY + Math.sin(a) * (ry - inset)];
  const bottom = CY + ry;

  // a detail line or two inside the body
  if (r() < 0.6) {
    const y = CY + ry * (0.15 + r() * 0.3), x0 = CX - rx * 0.45, x1 = CX + rx * 0.2;
    body.push(quad(r, x0, y, (x0 + x1) / 2, y + 20 + r() * 25, x1, y - 5, { n: 10, w: 8 }));
  }

  const legs = [];
  const legKinds = opts.legs ?? (shape === 'cloud' && r() < 0.4 ? 0 : pick([2, 2, 2, 3, 4, 4, 6]));
  const legLen = 110 + r() * 90;
  for (let i = 0; i < legKinds; i++) {
    const t = legKinds === 1 ? 0.5 : i / (legKinds - 1);
    const a = Math.PI / 2 + (t - 0.5) * 1.3;
    const [x0, y0] = edge(a, 14);
    const spread = (t - 0.5) * 70;
    const bend = (r() - 0.5) * 40;
    legs.push(quad(r, x0, y0, x0 + spread * 0.5 + bend, y0 + legLen * 0.5, x0 + spread, bottom + legLen - (bottom - y0) * 0.6, { w: w - 2 }));
  }

  const kinds = [];
  const want = opts.parts ?? Math.floor(r() * 3);
  const pool = opts.only || ['arms', 'horns', 'wings', 'tail', 'mouth'];
  while (kinds.length < Math.min(want, pool.length)) { const k = pick(pool); if (!kinds.includes(k)) kinds.push(k); }
  const parts = { arms: [], horns: [], wings: [], tail: [], mouth: [] };
  for (const k of kinds) {
    if (k === 'arms') {
      const n = r() < 0.25 ? 4 : 2;
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? -1 : 1, a = (side > 0 ? 0.25 : Math.PI - 0.25) + (i >= 2 ? 0.45 * side : 0);
        const [x0, y0] = edge(a, 6);
        const out = 90 + r() * 60;
        parts.arms.push(quad(r, x0, y0, x0 + side * out, y0 - 10, x0 + side * (out + 25), y0 + 70 + r() * 40, { w: w - 2 }));
      }
    } else if (k === 'horns') {
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (n === 1 ? 0 : (i / (n - 1) - 0.5) * 1.0);
        const [x0, y0] = edge(a, 4);
        const L = 70 + r() * 70, nx = Math.cos(a), ny = Math.sin(a);
        parts.horns.push(quad(r, x0, y0, x0 + nx * L * 0.6 + 20, y0 + ny * L * 0.6, x0 + nx * L + 30, y0 + ny * L, { n: 8, w: w - 1 }));
      }
    } else if (k === 'wings') {
      const n = r() < 0.3 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 - 0.55 - i * 0.35;
        const [x0, y0] = edge(a, 10);
        const S = 150 + r() * 80;
        const tipx = x0 - S * 0.8, tipy = y0 - S * 0.75;
        parts.wings.push([...quad(r, x0, y0, x0 - S * 0.2, y0 - S, tipx, tipy, { n: 10, w: w - 2 }), ...quad(r, tipx, tipy, x0 - S * 0.9, y0 - S * 0.1, x0 - 6, y0 + 6, { n: 10, w: w - 2 }).slice(1)]);
      }
    } else if (k === 'tail') {
      const [x0, y0] = edge(Math.PI - 0.25, 6);
      const L = 150 + r() * 110;
      parts.tail.push(quad(r, x0, y0, x0 - L * 0.7, y0 + 40, x0 - L, y0 - L * 0.55, { n: 16, w: w - 2 }));
    } else if (k === 'mouth') {
      const mx = CX + rx * 0.38, my = CY + ry * 0.22, mw = 40 + r() * 45;
      parts.mouth.push(quad(r, mx - mw, my - 6, mx, my + 22 + r() * 18, mx + mw * 0.8, my - 10, { n: 10, w: w - 2 }));
    }
  }

  const eyes = [];
  const nEyes = opts.eyes ?? pick([1, 1, 2, 2, 2, 3]);
  for (let i = 0; i < nEyes; i++) {
    const er = Math.round((nEyes === 1 ? 44 : nEyes === 2 ? 34 : 26) * (0.85 + r() * 0.35) * big);
    eyes.push({ x: Math.round(CX + rx * (0.2 + i * 0.24)), y: Math.round(CY - ry * (0.28 - (i % 2) * 0.1)), r: er });
  }

  const element = opts.element || pick(ELEMENT_KEYS);
  return {
    id: opts.id || 'g' + seed.toString(36),
    name: opts.name || monsterName(seed),
    gen: true,
    body: body.map(clampPts), legs: legs.map(clampPts),
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.map(clampPts)])),
    eyes,
    ink: element,
    tint: opts.tint ?? Math.floor(r() * 9),
    pattern: opts.pattern || (opts.boss ? pick(['stripes', 'scales', 'spots']) : r() < 0.2 ? pick(['spots', 'stripes']) : 'plain'),
    lvl: opts.level || 1,
    evo: opts.boss ? 1 + Math.floor((opts.level || 1) / 8) : Math.floor((opts.level || 1) / 7),
  };
}

// the four always-there sparring partners for Quick fight
export function houseMonsters() {
  return [
    generate({ seed: 101, id: 'rival-blobbo', name: 'Blobbo', shape: 'blob', legs: 2, parts: 1, only: ['mouth'], eyes: 2, element: 'neutral', tint: 0, pattern: 'plain', level: 1 }),
    generate({ seed: 202, id: 'rival-prickle', name: 'Prickle', shape: 'spiky', legs: 4, parts: 1, only: ['horns'], eyes: 1, element: 'fire', tint: 1, pattern: 'plain', level: 1 }),
    generate({ seed: 303, id: 'rival-skitter', name: 'Skitter', shape: 'bean', legs: 6, parts: 1, only: ['tail'], eyes: 2, element: 'leaf', tint: 2, pattern: 'plain', level: 1 }),
    generate({ seed: 404, id: 'rival-rollo', name: 'Rollo', shape: 'cloud', legs: 0, parts: 1, only: ['wings'], eyes: 1, element: 'water', tint: 3, pattern: 'plain', level: 1 }),
  ].map((d) => ({ ...d, house: true }));
}

export { TINTS };
