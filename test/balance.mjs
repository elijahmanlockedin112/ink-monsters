// Plays the whole Adventure many times in a real page with the game's own monsters and damage rules,
// for a few player skill levels, and prints wins, retries, levels and estimated play time per chapter.
// Usage: node test/balance.mjs [baseUrl]
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:47905/';
const PORT = 9343;
const PROFILE = join(process.env.TEMP || '.', 'inkm-bal');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
rmSync(PROFILE, { recursive: true, force: true });
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--mute-audio', 'about:blank'], { stdio: 'ignore' });

let ws, id = 0; const pending = new Map();
for (let i = 0; i < 60 && !ws; i++) {
  try {
    const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener('open', r, { once: true })); }
  } catch { await sleep(250); }
}
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const js = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };

await send('Page.navigate', { url: BASE });
for (let i = 0; i < 40; i++) { await sleep(150); if (await js('!!window.__ink')) break; }

const out = await js(`(async () => {
  const P = await import('./js/parts.js');
  const G = await import('./js/gen.js');
  const C = await import('./js/campaign.js');
  const { MOVES, matchup, xpToNext, MAX_LEVEL } = P;
  const mon = window.__ink.mon;
  const grade = (p) => { const r = Math.random(); return r < p.crit ? 'crit' : r < 1 - p.miss ? 'good' : 'miss'; };
  const SK = { casual: { crit: 0.18, miss: 0.3 }, decent: { crit: 0.32, miss: 0.18 }, sharp: { crit: 0.5, miss: 0.08 } };

  function fighter(d) { const m = mon(d); const max = Math.round(m.stats.hp * (d.boss ? P.BOSS_HP : 1)); return { d, m, max, hp: max, cd: {}, bleed: 0, stun: 0, weak: 0, fly: false, boost: false }; }
  function pick(f, foe) {
    const avail = f.m.moves.filter((k) => !(f.cd[k] > 0));
    if (avail.includes('inkup') && f.hp < f.max * 0.4) return 'inkup';
    if (avail.includes('fly') && !f.fly && Math.random() < 0.3) return 'fly';
    if (avail.includes('glare') && !foe.weak && Math.random() < 0.35) return 'glare';
    if (avail.includes('gore') && !foe.bleed) return 'gore';
    const at = avail.filter((k) => MOVES[k].power > 0).sort((x, y) => MOVES[y].power * (MOVES[y].hits || 1) - MOVES[x].power * (MOVES[x].hits || 1));
    return at[0] || f.m.basic;
  }
  function battle(pd, od, skill, ai) {
    const p = fighter(pd), o = fighter(od);
    const aiSk = { crit: 0.16 + ai * 0.05, miss: 0.24 - ai * 0.04 };
    let att = p.m.stats.spd >= o.m.stats.spd ? p : o, turns = 0;
    while (p.hp > 0 && o.hp > 0 && turns < 80) {
      turns++;
      const def = att === p ? o : p, isP = att === p;
      for (const k in att.cd) if (att.cd[k] > 0) att.cd[k]--;
      if (att.d.ink === 'water') att.hp = Math.min(att.max, att.hp + Math.max(1, Math.round(att.max * 0.04)));
      if (att.bleed > 0) { att.bleed--; att.hp -= Math.max(1, Math.round(att.max * 0.06)); if (att.hp <= 0) break; }
      if (att.stun > 0) { att.stun--; att = def; continue; }
      const k = pick(att, def), mv = MOVES[k];
      if (mv.cd) att.cd[k] = mv.cd + 1;
      if (k === 'fly') { att.fly = true; att.boost = true; }
      else if (k === 'glare') def.weak = 2 + (att.d.ink === 'leaf' ? 1 : 0);
      else if (k === 'inkup') { const g = isP ? grade(SK[skill]) : grade(aiSk); att.hp = Math.min(att.max, att.hp + Math.round(att.max * { crit: 0.25, good: 0.18, miss: 0.1 }[g])); }
      else {
        const ga = isP ? grade(SK[skill]) : grade(aiSk);
        const gb = isP ? 'none' : grade(SK[skill]);
        const atk = { crit: 1.5, good: 1, miss: 0.6 }[ga];
        const dm = isP ? 1 : { crit: 0.35, good: 0.7, miss: 1 }[gb];
        const per = att.m.stats.pow * mv.power * atk * dm * matchup(att.d.ink, def.d.ink) * (att.d.ink === 'fire' ? 1.1 : 1) * (att.weak > 0 ? 0.7 : 1) * (att.boost ? 1.3 : 1) * (att.d.boss ? P.BOSS_DMG : 1);
        att.boost = false;
        if (def.fly) def.fly = false;
        else {
          for (let h = 0; h < (mv.hits || 1); h++) { const dmg = Math.max(1, Math.round(per * (0.9 + Math.random() * 0.2))); def.hp -= dmg; if (mv.effect === 'drain') att.hp = Math.min(att.max, att.hp + Math.round(dmg * 0.5)); }
          if (def.hp > 0 && mv.effect === 'bleed') def.bleed = 3 + (att.d.ink === 'leaf' ? 1 : 0);
          if (def.hp > 0 && k === 'sweep') { const s = isP ? (ga === 'crit' || (ga === 'good' && Math.random() < 0.5)) : (gb === 'miss' ? Math.random() < 0.65 : gb === 'good' && Math.random() < 0.25); if (s) def.stun = 1; }
        }
      }
      if (att.weak > 0) att.weak--;
      att = def;
    }
    return { won: p.hp > 0 && o.hp <= 0, hpLeft: Math.max(0, p.hp), max: p.max, turns };
  }
  function gain(d, xp) { d.xp += xp; while (d.lvl < MAX_LEVEL && d.xp >= xpToNext(d.lvl)) { d.xp -= xpToNext(d.lvl); d.lvl++; } }

  const result = {};
  for (const skill of ['casual', 'decent', 'sharp']) {
    const per = [];
    const RUNS = 30;
    const agg = C.CHAPTERS.map(() => ({ fights: 0, losses: 0, turns: 0, endLvl: 0, stuck: 0 }));
    for (let run = 0; run < RUNS; run++) {
      const pd = G.generate({ seed: 5000 + run, level: 1, parts: 2 });
      pd.id = 'sim' + run + skill; pd.lvl = 1; pd.xp = 0; pd.evo = 0;
      const stars = {};
      let stuck = false;
      for (let ch = 0; ch < 5 && !stuck; ch++) {
        for (let i = 0; i < 5 && !stuck; i++) {
          const od = C.opponent(ch, i);
          let tries = 0;
          for (;;) {
            tries++;
            pd.evo = P.EVO_LEVELS.filter((l) => pd.lvl >= l).length;
            const r = battle(pd, od, skill, C.CHAPTERS[ch].ai);
            agg[ch].fights++; agg[ch].turns += r.turns;
            const first = !stars[ch + '-' + i];
            if (r.won) { let xp = 16 + 7 * od.lvl + 6 * Math.max(0, od.lvl - pd.lvl); if (first) xp = Math.round(xp * 1.5); gain(pd, xp); stars[ch + '-' + i] = 1; break; }
            agg[ch].losses++;
            agg[ch].byFight = agg[ch].byFight || [0, 0, 0, 0, 0]; agg[ch].byFight[i]++;
            gain(pd, 4 + 2 * od.lvl);
            // after 3 losses in a row a player grinds the Gauntlet: about 3 wins at their own level
            if (tries % 3 === 0) { for (let g = 0; g < 3; g++) { const gd = G.generate({ seed: Math.random() * 1e9, level: pd.lvl }); const rr = battle(pd, gd, skill, Math.min(4, Math.floor(gd.lvl / 5))); agg[ch].fights++; agg[ch].turns += rr.turns; gain(pd, rr.won ? 16 + 7 * gd.lvl : 4 + 2 * gd.lvl); } }
            if (tries > 30) { stuck = true; agg[ch].stuck++; break; }
          }
        }
        if (!stuck) agg[ch].endLvl += pd.lvl; else agg[ch].endLvl += NaN;
      }
    }
    result[skill] = agg.map((a, ch) => ({ ch: ch + 1, fightsPerRun: +(a.fights / RUNS).toFixed(1), lossRate: +(a.losses / Math.max(1, a.fights)).toFixed(2), avgTurns: +(a.turns / Math.max(1, a.fights)).toFixed(1), endLvl: +(a.endLvl / RUNS).toFixed(1), stuckRuns: a.stuck, lossesByFight: (a.byFight || []).map((n) => +(n / RUNS).toFixed(1)).join('/') }));
  }
  return result;
})()`);

for (const [skill, rows] of Object.entries(out)) {
  console.log(`\n${skill}`);
  let total = 0;
  for (const r of rows) {
    const mins = (r.fightsPerRun * (r.avgTurns * 4.5 + 12)) / 60; // ~4.5 s per turn with animations, ~12 s around each fight
    total += mins;
    console.log(`  ch${r.ch}: ${r.fightsPerRun} fights, loss rate ${r.lossRate}, ${r.avgTurns} turns/fight, ends LV ${r.endLvl}, stuck ${r.stuckRuns}, losses per run by fight ${r.lossesByFight}, ~${mins.toFixed(0)} min`);
  }
  console.log(`  total ~${total.toFixed(0)} min of fighting for one monster`);
}
ws.close(); chrome.kill(); await sleep(300); rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
