// Four house monsters, drawn with code and a shaky hand, so there is always someone to fight.
import { rng } from './geom.js';

function loop(r, cx, cy, rx, ry, { spikes = 0, depth = 0, jitter = 6, n = 90, w = 11, turns = 1.04, start = -1.6 } = {}) {
  const pts = [];
  const phase = r() * 6;
  for (let i = 0; i <= n; i++) {
    const a = start + (i / n) * Math.PI * 2 * turns;
    let k = 1;
    if (spikes) {
      const f = ((i / n) * spikes * turns) % 1;
      k = f < 0.5 ? 1 - depth + depth * 2 * f : 1 + depth - depth * 2 * f;
    }
    const wob = Math.sin(a * 3 + phase) * jitter * 0.6 + (r() - 0.5) * jitter;
    pts.push([Math.round(cx + Math.cos(a) * (rx * k + wob)), Math.round(cy + Math.sin(a) * (ry * k + wob)), w + (r() - 0.5) * 3]);
  }
  return pts;
}

function line(r, x0, y0, x1, y1, { bend = 0, n = 14, w = 10 } = {}) {
  const pts = [];
  const nx = -(y1 - y0), ny = x1 - x0, L = Math.hypot(nx, ny) || 1;
  for (let i = 0; i <= n; i++) {
    const t = i / n, b = Math.sin(t * Math.PI) * bend;
    pts.push([Math.round(x0 + (x1 - x0) * t + (nx / L) * b + (r() - 0.5) * 3), Math.round(y0 + (y1 - y0) * t + (ny / L) * b + (r() - 0.5) * 3), w + (r() - 0.5) * 2]);
  }
  return pts;
}

function spiral(r, cx, cy, R, turns, w) {
  const pts = [];
  const n = 70;
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = t * Math.PI * 2 * turns;
    pts.push([Math.round(cx + Math.cos(a) * R * t + (r() - 0.5) * 3), Math.round(cy + Math.sin(a) * R * t + (r() - 0.5) * 3), w]);
  }
  return pts;
}

export function rivals() {
  const r = rng(7);
  const blobbo = {
    id: 'rival-blobbo', rival: true, name: 'Blobbo', tint: 0,
    body: [loop(r, 500, 470, 235, 205, { jitter: 10 }), line(r, 430, 560, 560, 556, { bend: 26, n: 10, w: 9 })],
    legs: [line(r, 420, 655, 405, 800, { bend: 8 }), line(r, 585, 655, 605, 800, { bend: -8 })],
    eyes: [{ x: 440, y: 405, r: 46 }, { x: 568, y: 395, r: 38 }],
  };
  const prickle = {
    id: 'rival-prickle', rival: true, name: 'Prickle', tint: 1,
    body: [loop(r, 500, 450, 260, 230, { spikes: 11, depth: 0.32, n: 132, jitter: 4, turns: 1.0, start: -Math.PI / 2 })],
    legs: [
      line(r, 400, 610, 340, 790, { bend: 14 }), line(r, 460, 640, 450, 800, { bend: 6 }),
      line(r, 545, 640, 560, 800, { bend: -6 }), line(r, 600, 610, 665, 790, { bend: -14 }),
    ],
    eyes: [{ x: 520, y: 430, r: 64 }],
  };
  const skitter = {
    id: 'rival-skitter', rival: true, name: 'Skitter', tint: 2,
    body: [loop(r, 500, 520, 300, 115, { jitter: 7 }), line(r, 330, 470, 290, 400, { bend: 10, n: 8, w: 8 }), line(r, 380, 455, 370, 380, { bend: -8, n: 8, w: 8 })],
    legs: [270, 360, 450, 540, 630, 720].map((x, i) =>
      line(r, x, 615, x + (i % 2 ? 30 : -30), 770, { bend: i % 2 ? -16 : 16, w: 8 })),
    eyes: [{ x: 720, y: 490, r: 30 }, { x: 778, y: 505, r: 24 }],
  };
  const rollo = {
    id: 'rival-rollo', rival: true, name: 'Rollo', tint: 3,
    body: [loop(r, 500, 520, 215, 215, { jitter: 6 }), spiral(r, 470, 560, 120, 2.2, 9)],
    legs: [],
    eyes: [{ x: 560, y: 420, r: 50 }],
  };
  return [blobbo, prickle, skitter, rollo];
}
