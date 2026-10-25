// What you can draw, what each part does in a fight, and the ink elements.

export const PART_ORDER = ['body', 'legs', 'arms', 'horns', 'wings', 'tail', 'mouth', 'eyes'];
export const LIMB_KEYS = ['arms', 'horns', 'wings', 'tail', 'mouth'];

export const PARTS = {
  body: { label: 'Body', max: 80, hint: 'Draw the body. Close the outline and it fills with color. Details inside are fine.' },
  legs: { label: 'Legs', max: 8, hint: 'Legs: one line each, from the body down. More and longer legs make it faster.' },
  arms: { label: 'Arms', max: 4, hint: 'Arms: draw from the body outward. Unlocks Haymaker, or Fist Flurry with 3 or more.' },
  horns: { label: 'Horns', max: 6, hint: 'Horns on top. Unlocks Gore, which leaves the other monster bleeding.' },
  wings: { label: 'Wings', max: 4, hint: 'Wings: start at the body. Unlocks Fly Up, which dodges the next hit.' },
  tail: { label: 'Tail', max: 2, hint: 'A tail off the back. Unlocks Tail Sweep, which can stun.' },
  mouth: { label: 'Mouth', max: 1, hint: 'Draw a mouth. Unlocks Chomp, which heals you by half the damage.' },
  eyes: { label: 'Eyes', max: 8, hint: 'Tap to stick on googly eyes, drag to size, tap again to remove. 3 or more unlock Glare.' },
};

export const ELEMENTS = {
  neutral: { label: 'Ink', color: '#1d1a17', blurb: 'Plain black ink. The red zone is wider, so crits come easier.' },
  fire: { label: 'Fire', color: '#b3261e', blurb: 'Hits 10% harder. Beats Leaf, loses to Water.' },
  water: { label: 'Water', color: '#1f5fa8', blurb: 'Heals a little every turn. Beats Fire, loses to Leaf.' },
  leaf: { label: 'Leaf', color: '#2f7a3b', blurb: 'Bleed and Glare last a turn longer. Beats Water, loses to Fire.' },
};
export const ELEMENT_KEYS = ['neutral', 'fire', 'water', 'leaf'];

const BEATS = { fire: 'leaf', leaf: 'water', water: 'fire' };
export function matchup(att, def) {
  if (BEATS[att] === def) return 1.25;
  if (BEATS[def] === att) return 0.8;
  return 1;
}

// basic moves come from the body; the rest from parts
export const MOVES = {
  rush: { name: 'Rush', power: 1.15, hits: 1, cd: 0, anim: 'rush', desc: 'Charge straight in.' },
  slam: { name: 'Slam', power: 1.1, hits: 1, cd: 0, anim: 'slam', desc: 'Jump and land on it.' },
  pounce: { name: 'Pounce', power: 1.0, hits: 1, cd: 0, anim: 'pounce', desc: 'A quick low leap.' },
  flurry: { name: 'Flurry', power: 0.42, hits: 3, cd: 0, anim: 'flurry', desc: 'Three fast hits.' },
  roll: { name: 'Roll', power: 1.05, hits: 1, cd: 0, anim: 'roll', desc: 'Roll into it.' },
  haymaker: { name: 'Haymaker', power: 1.6, hits: 1, cd: 2, anim: 'punch', desc: 'One huge punch.' },
  fists: { name: 'Fist Flurry', power: 0.48, hits: 4, cd: 2, anim: 'punch', desc: 'Four punches.' },
  gore: { name: 'Gore', power: 1.2, hits: 1, cd: 2, anim: 'gore', effect: 'bleed', desc: 'Horns first. It bleeds for 3 turns.' },
  chomp: { name: 'Chomp', power: 1.05, hits: 1, cd: 2, anim: 'chomp', effect: 'drain', desc: 'Bite and heal half the damage.' },
  sweep: { name: 'Tail Sweep', power: 0.9, hits: 1, cd: 3, anim: 'sweep', effect: 'stun', desc: 'Strong timing stuns it for a turn.' },
  fly: { name: 'Fly Up', power: 0, cd: 3, anim: 'fly', effect: 'fly', self: true, desc: 'Dodge the next hit. Next attack hits 30% harder.' },
  glare: { name: 'Glare', power: 0, cd: 3, anim: 'glare', effect: 'weak', self: true, desc: 'It hits 30% softer for 2 turns.' },
  inkup: { name: 'Ink Up', power: 0, cd: 3, anim: 'heal', effect: 'heal', self: true, meter: true, desc: 'Heal up to a quarter of your HP.' },
};

export const TINTS = [
  { c: '#f2d27a', price: 0 }, { c: '#f1b7a0', price: 0 }, { c: '#a8d5c6', price: 0 }, { c: '#b8cbe9', price: 0 }, { c: '#dcc0a0', price: 0 },
  { c: '#e9a3b8', price: 30 }, { c: '#c9df8f', price: 30 }, { c: '#f0a35e', price: 40 }, { c: '#c4b8dc', price: 40 },
  { c: '#9fb8b0', price: 50 }, { c: '#fffdf8', price: 60 }, { c: '#8e8a82', price: 80 },
];
export const PATTERNS = [
  { key: 'plain', label: 'Plain', price: 0 },
  { key: 'spots', label: 'Spots', price: 50 },
  { key: 'stripes', label: 'Stripes', price: 70 },
  { key: 'scales', label: 'Scales', price: 90 },
  { key: 'stars', label: 'Stars', price: 120 },
];

// bosses get a little extra on top of their bigger drawing (tuned with test/balance.mjs)
export const BOSS_HP = 1.12;
export const BOSS_DMG = 1.04;

// levels at which a monster may evolve (draw new parts onto itself)
export const EVO_LEVELS = [3, 6, 10, 15];
export const MAX_LEVEL = 25;
export const xpToNext = (lvl) => 30 + lvl * 22;
