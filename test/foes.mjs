// Prints every Adventure opponent's level, element, stats and moves.
// Usage: node test/foes.mjs [baseUrl]
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:47905/';
const PORT = 9344;
const PROFILE = join(process.env.TEMP || '.', 'inkm-foes');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
rmSync(PROFILE, { recursive: true, force: true });
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map();
for (let i = 0; i < 60 && !ws; i++) {
  try {
    const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener('open', r, { once: true })); }
  } catch { await sleep(250); }
}
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const js = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result.value;
await send('Page.navigate', { url: BASE });
for (let i = 0; i < 40; i++) { await sleep(150); if (await js('!!window.__ink')) break; }
const rows = await js(`(async () => {
  const out = [];
  for (let ch = 0; ch < 5; ch++) for (let i = 0; i < 5; i++) {
    const d = window.__ink.opponent(ch, i), m = window.__ink.mon(d);
    out.push(\`ch\${ch + 1}-\${i + 1} LV \${d.lvl} evo \${d.evo} \${d.ink.padEnd(7)} hp \${Math.round(m.stats.hp * (d.boss ? 1.12 : 1))} pow \${m.stats.pow} spd \${m.stats.spd} | \${m.moves.join(', ')}\`);
  }
  return out;
})()`);
console.log(rows.join('\n'));
ws.close(); chrome.kill(); await sleep(300); rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
