// A strip of paper with a ground line where monsters live, plus the tween runner that animates them.
import { clamp, lerp, rng } from './geom.js';
import { INK, SIGNAL, drawMonster, newState, updateState } from './monster.js';

const DPR = () => Math.min(window.devicePixelRatio || 1, 2.5);
export const DISPLAY_FONT = getComputedStyle(document.documentElement).getPropertyValue('--display').trim() || 'sans-serif';

const tweens = [];
export function tween(ms, fn) {
  return new Promise((res) => tweens.push({ t0: performance.now(), ms, fn, res }));
}
export function runTweens(now) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    const k = clamp((now - tw.t0) / tw.ms, 0, 1);
    tw.fn(k);
    if (k >= 1) { tweens.splice(i, 1); tw.res(); }
  }
}

export function fit(cv, w, h) {
  const d = DPR();
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  cv.width = Math.round(w * d); cv.height = Math.round(h * d);
  const g = cv.getContext('2d');
  g.setTransform(d, 0, 0, d, 0, 0);
  return g;
}

// faint sketched scenery behind each Adventure chapter
function drawTheme(g, theme, w, h, gy, seed) {
  if (!theme) return;
  const r = rng(seed);
  g.save();
  g.strokeStyle = 'rgba(29,26,23,0.2)'; g.fillStyle = 'rgba(29,26,23,0.2)';
  g.lineWidth = 1.6; g.lineCap = g.lineJoin = 'round';
  const wob = (v) => v + (r() - 0.5) * 3;
  if (theme === 'meadow') {
    for (let k = 0; k < 2; k++) {
      g.beginPath();
      const base = gy - 30 - k * 40, amp = 22 + k * 10;
      for (let x = -10; x <= w + 10; x += 12) { const y = base - Math.sin(x / (90 + k * 50) + k * 2) * amp; x < 0 ? g.moveTo(x, y) : g.lineTo(x, wob(y)); }
      g.stroke();
    }
    for (let i = 0; i < 9; i++) {
      const x = r() * w, y = gy - 4 - r() * 18;
      g.beginPath(); g.moveTo(x, gy); g.lineTo(x + 2, y); g.stroke();
      g.beginPath(); g.arc(x + 2, y - 3, 3.2, 0, Math.PI * 2); g.stroke();
    }
    g.beginPath(); g.arc(w * 0.82, h * 0.16, Math.min(w, h) * 0.06, 0, Math.PI * 2); g.stroke();
  } else if (theme === 'caves') {
    for (let x = 0; x < w; x += 22 + r() * 30) {
      const L = 20 + r() * h * 0.22;
      g.beginPath(); g.moveTo(x - 9, 0); g.lineTo(wob(x), L); g.lineTo(x + 9, 0); g.stroke();
      if (r() < 0.3) { g.beginPath(); g.arc(x, L + 10 + r() * 30, 2.4, 0, Math.PI * 2); g.fill(); }
    }
    for (let i = 0; i < 4; i++) {
      const x = r() * w, H = 14 + r() * 26;
      g.beginPath(); g.moveTo(x - 10, gy); g.lineTo(x, gy - H); g.lineTo(x + 10, gy); g.stroke();
    }
  } else if (theme === 'woods') {
    for (let i = 0; i < 5; i++) {
      const x = (i + 0.3 + r() * 0.4) * (w / 5), top = gy - h * (0.42 + r() * 0.2);
      g.beginPath(); g.moveTo(x - 6, gy); g.lineTo(wob(x - 4), top + 30); g.moveTo(x + 6, gy); g.lineTo(wob(x + 4), top + 30); g.stroke();
      g.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.35) {
        const rr = 34 + Math.sin(a * 5 + i) * 7 + r() * 4;
        const px = x + Math.cos(a) * rr * 1.1, py = top + Math.sin(a) * rr * 0.8;
        a ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.stroke();
    }
  } else if (theme === 'volcano') {
    const cx = w * 0.68, top = gy - h * 0.5;
    g.beginPath(); g.moveTo(cx - w * 0.36, gy); g.lineTo(wob(cx - 34), top); g.lineTo(wob(cx + 34), top); g.lineTo(cx + w * 0.36, gy); g.stroke();
    g.strokeStyle = 'rgba(226,64,28,0.35)';
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      for (let y = 0; y < 60; y += 5) { const px = cx - 10 + k * 10 + Math.sin(y / 9 + k) * 8, py = top - 8 - y; y ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.stroke();
    }
    g.beginPath(); g.moveTo(cx - 20, top + 6); g.lineTo(cx - 34, top + 50); g.moveTo(cx + 14, top + 6); g.lineTo(cx + 26, top + 70); g.stroke();
  } else if (theme === 'page') {
    g.strokeStyle = 'rgba(31,95,168,0.16)'; g.lineWidth = 1;
    for (let y = 26; y < gy; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = 'rgba(226,64,28,0.3)';
    g.beginPath(); g.moveTo(34, 0); g.lineTo(34, h); g.stroke();
  }
  g.restore();
}

export class Stage {
  constructor(cv) { this.cv = cv; this.actors = []; this.fx = []; this.stains = []; this.shake = 0; this.w = 0; this.h = 0; this.theme = null; }
  resize(w, h, groundFrac = 0.84, theme = null) {
    this.g = fit(this.cv, w, h); this.w = w; this.h = h; this.gy = Math.round(h * groundFrac); this.theme = theme;
    const r = Math.random;
    this.ground = [];
    for (let x = -4; x <= w + 8; x += 14) this.ground.push([x, this.gy + (r() - 0.5) * 1.6]);
    this.ticks = [];
    for (let x = 10; x < w; x += 18 + r() * 26) this.ticks.push([x, this.gy + 7 + r() * 10, 5 + r() * 9]);
    for (const a of this.actors) a.st.gy = this.gy;
    this.bg = null;
    if (theme) {
      this.bg = document.createElement('canvas');
      const bg = fit(this.bg, w, h);
      this.bg.style.cssText = '';
      drawTheme(bg, theme, w, h, this.gy, (w * 7 + h) | 0);
    }
  }
  reset() { this.actors = []; this.fx = []; this.stains = []; this.shake = 0; }
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
    for (const a of this.actors) {
      updateState(a.st, dt);
      if (a.hover !== undefined) a.st.y += ((a.hover || 0) - a.st.y) * Math.min(1, dt * 6);
      if (a.bleed && Math.random() < dt * 3) {
        this.fx.push({ kind: 'drop', x: a.st.x + (Math.random() - 0.5) * a.mon.full.w * a.s * 0.5, y: this.gy - actorHeight(a) * (0.3 + Math.random() * 0.4), vx: (Math.random() - 0.5) * 40, vy: 0, r: 1.5 + Math.random() * 2, c: SIGNAL, life: 3 });
      }
    }
    this.shake *= Math.pow(0.0008, dt);
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life -= dt;
      if (f.kind === 'drop') {
        f.vy += 1300 * dt; f.x += f.vx * dt; f.y += f.vy * dt;
        if (f.y >= this.gy + 2) {
          if (this.stains.length > 160) this.stains.shift();
          this.stains.push({ x: f.x, y: this.gy + 3 + Math.random() * 6, r: f.r * 1.4, c: f.c });
          this.fx.splice(i, 1); continue;
        }
      } else if (f.kind === 'num') { f.y -= 46 * dt; }
      else if (f.kind === 'ring') { f.r += f.vr * dt; }
      else if (f.kind === 'plus') { f.y -= 60 * dt; f.x += Math.sin(f.life * 8 + f.seed) * 0.4; }
      if (f.life <= 0) this.fx.splice(i, 1);
    }
  }
  draw() {
    const g = this.g, w = this.w, h = this.h;
    g.clearRect(0, 0, w, h);
    if (this.bg) g.drawImage(this.bg, 0, 0, w, h);
    g.save();
    if (this.shake > 0.3) g.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
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
      } else if (f.kind === 'ring') {
        g.globalAlpha = clamp(f.life / f.max, 0, 1);
        g.strokeStyle = f.c; g.lineWidth = 2.5;
        g.beginPath(); g.arc(f.x, f.y, f.r, 0, Math.PI * 2); g.stroke();
        g.globalAlpha = 1;
      } else if (f.kind === 'plus') {
        g.globalAlpha = clamp(f.life / 0.5, 0, 1);
        g.strokeStyle = f.c; g.lineWidth = 2.4;
        g.beginPath(); g.moveTo(f.x - 5, f.y); g.lineTo(f.x + 5, f.y); g.moveTo(f.x, f.y - 5); g.lineTo(f.x, f.y + 5); g.stroke();
        g.globalAlpha = 1;
      }
    }
    g.restore();
  }
  hitTest(x, y) {
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const a = this.actors[i], m = a.mon;
      const hw = (m.full.w * a.s) / 2, top = (m.groundY - m.full.y) * a.s;
      if (x > a.st.x - hw - 10 && x < a.st.x + hw + 10 && y > this.gy + a.st.y - top - 10 && y < this.gy + a.st.y + 10) return a;
    }
    return null;
  }
  splash(x, y, dir, n, crit, color = INK) {
    for (let i = 0; i < n; i++) {
      this.fx.push({
        kind: 'drop', x, y, r: 1.5 + Math.random() * 3.5,
        vx: dir * (80 + Math.random() * 320) + (Math.random() - 0.5) * 160, vy: -150 - Math.random() * 420,
        c: crit && i % 2 ? SIGNAL : color, life: 3,
      });
    }
  }
  number(x, y, text, c, size) { this.fx.push({ kind: 'num', x, y, text, c, size, life: 1 }); }
  ring(x, y, c, r0 = 10, vr = 260, life = 0.45) { this.fx.push({ kind: 'ring', x, y, r: r0, vr, c, life, max: life }); }
  pluses(a, c, n = 8) {
    for (let i = 0; i < n; i++) {
      this.fx.push({ kind: 'plus', x: a.st.x + (Math.random() - 0.5) * a.mon.full.w * a.s * 0.7, y: this.gy - actorHeight(a) * Math.random() * 0.8, c, life: 0.5 + Math.random() * 0.6, seed: Math.random() * 9 });
    }
  }
}

export const actorHeight = (a) => (a.mon.groundY - a.mon.full.y) * a.s;
export const actorTop = (a) => a.st.gy + a.st.y - actorHeight(a);
export const lean = (st, worldAngle) => { st.rot = worldAngle * st.face; };

export async function hop(a, big = 1) {
  if (a.busy) return;
  a.busy = true;
  const h = actorHeight(a) * 0.22 * big;
  const y0 = a.st.y;
  await tween(90, (k) => { a.st.sqy = -0.14 * k; a.st.sqx = 0.1 * k; });
  await tween(380, (k) => { a.st.y = y0 - Math.sin(Math.PI * k) * h; a.st.sqy = lerp(0.1, 0, k); a.st.sqx = lerp(-0.06, 0, k); });
  a.st.y = y0;
  await tween(120, (k) => { a.st.sqy = -0.1 * Math.sin(Math.PI * k); a.st.sqx = 0.08 * Math.sin(Math.PI * k); });
  a.busy = false;
}
