# Ink Monsters - links

| What | Where |
|---|---|
| PC | http://localhost:47905/ |
| iPhone / iPad (Tailscale) | https://elijahman.taileb0bc0.ts.net:8491/ (shared with `tailscale serve --bg --https=8491 http://127.0.0.1:47905`) |
| Start after a reboot | double-click `C:\Users\elija\Downloads\Coding Projects\ink-monsters\start-ink-monsters.cmd` |
| Server log | `C:\Users\elija\Downloads\Coding Projects\ink-monsters\.claude\serve-47905.log` |
| Test | `node test/e2e.mjs` (server running; real touch, mouse and keyboard in headless Chrome; screenshots in `test/shots`). Add a URL to test the Tailscale copy. |
| Repo | local git only, no remote |

Share links (`#m=...`) carry the whole drawing, so they only open for people who can reach the URL. The Tailscale URL works on your own devices. To send one to E, it needs a public host (GitHub Pages works, since it's all static files).

Start command (PowerShell):

```
cd "C:\Users\elija\Downloads\Coding Projects\ink-monsters"
node server.mjs
```

## Key files
- `index.html`, `style.css` - the five screens: home, draw, monster page, pick, battle
- `js/app.js` - screens, drawing input (Pencil pressure + palm rejection), stages, battle flow, share links
- `js/monster.js` - drawing to monster: silhouette fill, stats, move, walking legs, googly eyes
- `js/audio.js` - every sound is synthesized; the cry's pitch follows the monster's top outline
- `js/codec.js` - packs a monster into a link (deflate + base64url)
- `js/rivals.js` - the four house monsters
- `server.mjs` - zero-dependency static server (127.0.0.1, `PORT`, default 47905)
