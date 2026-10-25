// Packs a monster into a short URL-safe string (deflated when the browser can) and back.
import { ELEMENT_KEYS, LIMB_KEYS, PATTERNS } from './parts.js';

const MAX_STROKES = 200, MAX_POINTS = 8000;

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

async function pipe(bytes, Stream) {
  const out = new Blob([bytes]).stream().pipeThrough(new Stream('deflate-raw'));
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeMonster(d) {
  const out = [];
  const u8 = (v) => out.push(v & 255);
  const u16 = (v) => { v = Math.max(0, Math.min(65535, Math.round(v))); out.push(v >> 8, v & 255); };
  const name = new TextEncoder().encode((d.name || '').slice(0, 26));
  u8(2); u8(name.length); name.forEach(u8); u8(d.tint || 0);
  u8(Math.max(0, ELEMENT_KEYS.indexOf(d.ink)));
  u8(Math.max(0, PATTERNS.findIndex((p) => p.key === d.pattern)));
  u8(Math.min(99, d.lvl || 1)); u8(Math.min(9, d.evo || 0));
  u8(d.eyes.length); for (const e of d.eyes) { u16(e.x); u16(e.y); u8(e.r); }
  const lists = [d.body, d.legs, ...LIMB_KEYS.map((k) => (d.parts && d.parts[k]) || [])];
  for (const list of lists) {
    u8(list.length);
    for (const s of list) { u16(s.length); for (const p of s) { u16(p[0]); u16(p[1]); u8(Math.round(p[2] * 4)); } }
  }
  const raw = new Uint8Array(out);
  if (typeof CompressionStream !== 'undefined') {
    try { return 'z' + b64url(await pipe(raw, CompressionStream)); } catch { /* fall through */ }
  }
  return 'r' + b64url(raw);
}

export async function decodeMonster(code) {
  let bytes = unb64url(code.slice(1));
  if (code[0] === 'z') bytes = await pipe(bytes, DecompressionStream);
  else if (code[0] !== 'r') throw new Error('bad code');
  let i = 0;
  const need = (n) => { if (i + n > bytes.length) throw new Error('short'); };
  const u8 = () => { need(1); return bytes[i++]; };
  const u16 = () => { need(2); const v = (bytes[i] << 8) | bytes[i + 1]; i += 2; return v; };
  const ver = u8();
  if (ver !== 1 && ver !== 2) throw new Error('version');
  const nl = u8(); need(nl);
  const name = new TextDecoder().decode(bytes.slice(i, i + nl)); i += nl;
  const tint = u8();
  let ink = 'neutral', pattern = 'plain', lvl = 1, evo = 0;
  if (ver === 2) {
    ink = ELEMENT_KEYS[u8()] || 'neutral';
    pattern = (PATTERNS[u8()] || PATTERNS[0]).key;
    lvl = Math.max(1, u8()); evo = u8();
  }
  const eyes = [];
  for (let n = u8(); n > 0; n--) eyes.push({ x: u16(), y: u16(), r: u8() });
  let points = 0;
  const lists = [];
  const nLists = ver === 2 ? 2 + LIMB_KEYS.length : 2;
  for (let k = 0; k < nLists; k++) {
    const list = [];
    const ns = u8();
    if (ns > MAX_STROKES) throw new Error('too many strokes');
    for (let s = 0; s < ns; s++) {
      const np = u16();
      points += np;
      if (points > MAX_POINTS || np === 0) throw new Error('too many points');
      const st = [];
      for (let p = 0; p < np; p++) st.push([Math.min(u16(), 1000), Math.min(u16(), 1000), Math.max(1, u8() / 4)]);
      list.push(st);
    }
    lists.push(list);
  }
  if (!lists[0].length) throw new Error('no body');
  const parts = {};
  LIMB_KEYS.forEach((k, j) => { parts[k] = (lists[2 + j] || []).slice(0, 8); });
  return { name, tint, ink, pattern, lvl: Math.min(lvl, 25), evo: Math.min(evo, 4), eyes: eyes.slice(0, 8), body: lists[0], legs: lists[1].slice(0, 8), parts };
}
