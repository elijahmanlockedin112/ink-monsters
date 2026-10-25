// Small geometry and randomness helpers. Strokes are arrays of [x, y, w] in a 1000x1000 drawing space.

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = {
  out: (t) => 1 - (1 - t) * (1 - t),
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  in: (t) => t * t * t,
  back: (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2),
};

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function hashData(d) {
  let h = 2166136261;
  const mix = (v) => { h ^= v & 0xffff; h = Math.imul(h, 16777619); };
  for (const s of [...d.body, ...d.legs]) for (const p of s) { mix(p[0]); mix(p[1] * 7); }
  for (const e of d.eyes) { mix(e.x); mix(e.y); }
  return h >>> 0;
}

export function strokeLen(p) {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return L;
}

export function bbox(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const [x, y, w] of s) {
    const r = w / 2;
    if (x - r < x0) x0 = x - r; if (y - r < y0) y0 = y - r;
    if (x + r > x1) x1 = x + r; if (y + r > y1) y1 = y + r;
  }
  if (x0 === Infinity) return { x: 400, y: 400, w: 200, h: 200, cx: 500, cy: 500 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

// Ramer-Douglas-Peucker on [x, y, w] points.
export function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export function convexHull(points) {
  const p = points.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

const STARTS = ['Gr', 'Sn', 'Bl', 'Fl', 'Sk', 'Wr', 'Pl', 'Cr', 'Gl', 'Zl', 'Br', 'Sl', 'Kr', 'Th', 'Squ', 'M', 'B', 'D', 'Z', 'P'];
const VOWELS = ['o', 'a', 'u', 'i', 'oo', 'ee', 'au', 'e'];
const ENDS = ['rk', 'mp', 'bble', 'x', 'zz', 'nk', 'g', 'b', 'rp', 'mbo', 'nch', 'ff', 'ggle', 'p', 'sh', 'ldo', 'nkus', 'rgle'];

export function monsterName(seed) {
  const r = rng(seed * 2654435761);
  const pick = (a) => a[Math.floor(r() * a.length)];
  let n = pick(STARTS) + pick(VOWELS) + pick(ENDS);
  if (n.length < 6 && r() < 0.6) n += pick(['o', 'y', 'ix', 'er', 'us', 'a']);
  return n;
}
