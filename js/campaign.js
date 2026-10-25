// The Adventure: five pages of the sketchbook, four fights and a boss on each.
import { generate } from './gen.js';
import { rng } from './geom.js';
import { ELEMENT_KEYS } from './parts.js';

export const CHAPTERS = [
  { name: 'Doodle Meadow', theme: 'meadow', elements: ['neutral', 'leaf'], levels: [1, 2, 3, 4], boss: { level: 5, title: 'the Scribbler', shape: 'blob' }, ai: 0 },
  { name: 'Inkwell Caves', theme: 'caves', elements: ['water', 'neutral'], levels: [4, 5, 6, 7], boss: { level: 8, title: 'the Drip', shape: 'tall' }, ai: 1 },
  { name: 'Margin Woods', theme: 'woods', elements: ['leaf', 'water'], levels: [8, 9, 10, 11], boss: { level: 12, title: 'Old Bark', shape: 'box' }, ai: 2 },
  { name: 'Redline Volcano', theme: 'volcano', elements: ['fire', 'leaf'], levels: [12, 13, 13, 14], boss: { level: 15, title: 'the Smudge', shape: 'spiky' }, ai: 2 },
  { name: 'The Blank Page', theme: 'page', elements: ELEMENT_KEYS, levels: [16, 17, 18, 19], boss: { level: 21, title: 'the Eraser', shape: 'cloud' }, ai: 4 },
];

const cache = new Map();
export function opponent(ch, i) {
  const key = `${ch}-${i}`;
  if (cache.has(key)) return cache.get(key);
  const C = CHAPTERS[ch];
  const seed = 1000 + ch * 97 + i * 13;
  const r = rng(seed);
  const element = C.elements[Math.floor(r() * C.elements.length)];
  let d;
  if (i < 4) {
    d = generate({ seed, level: C.levels[i], element, parts: Math.min(3, Math.floor(ch * 0.6 + i * 0.4 + r() * 1.2)) });
  } else {
    d = generate({ seed, level: C.boss.level, element: ch === 4 ? 'neutral' : C.elements[0], parts: 3, boss: true, shape: C.boss.shape, eyes: 3 });
    d.name = `${d.name} ${C.boss.title}`.slice(0, 26);
    d.boss = true;
  }
  d.id = `adv-${key}`;
  cache.set(key, d);
  return d;
}

export const fightKey = (ch, i) => `${ch}-${i}`;

// a fight is open when it's the first one or the one before it has at least one star
export function isOpen(stars, ch, i) {
  if (ch === 0 && i === 0) return true;
  if (i === 0) return (stars[fightKey(ch - 1, 4)] || 0) > 0;
  return (stars[fightKey(ch, i - 1)] || 0) > 0;
}

export function nextFight(stars) {
  for (let ch = 0; ch < CHAPTERS.length; ch++) for (let i = 0; i < 5; i++) if (!stars[fightKey(ch, i)]) return { ch, i };
  return null;
}

export function starsFor(hpLeft, max) {
  const f = hpLeft / max;
  return f >= 0.6 ? 3 : f >= 0.3 ? 2 : 1;
}

export const totalStars = (stars) => Object.values(stars).reduce((a, b) => a + b, 0);
