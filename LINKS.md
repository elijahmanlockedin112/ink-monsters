# Ink Monsters - links

| What | Where |
|---|---|
| PC | http://localhost:47905/ |
| iPhone / iPad (Tailscale) | https://elijahman.taileb0bc0.ts.net:8491/ (shared with `tailscale serve --bg --https=8491 http://127.0.0.1:47905`) |
| Start after a reboot | double-click `C:\Users\elija\Downloads\Coding Projects\ink-monsters\start-ink-monsters.cmd` |
| Server log | `C:\Users\elija\Downloads\Coding Projects\ink-monsters\.claude\serve-47905.log` |
| Test | `node test/e2e.mjs` (server running; real touch, mouse and keyboard in headless Chrome; screenshots in `test/shots`). Add a URL to test another copy. `node test/simplify-check.mjs` checks stroke simplifying. |
| Balance | `node test/balance.mjs` plays the whole Adventure 30 times per skill level with the game's own monsters and prints losses per fight and minutes. `node test/foes.mjs` lists every Adventure opponent. |
| Public (anyone, E included) | https://elijahmanlockedin112.github.io/ink-monsters/ |
| Repo | https://github.com/elijahmanlockedin112/ink-monsters (public; Pages deploys from `main`) |

Share links (`#m=...`) carry the whole drawing and always point at the public URL, so they open for anyone. Each copy (PC, Tailscale, public) keeps its own saved monsters. Pushing to `main` updates the public site within a minute, so don't push half-finished work.

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
- `js/parts.js` - parts, inks (elements), moves, shop prices, level and boss numbers
- `js/gen.js` - draws monsters with code: house monsters, Adventure and Gauntlet opponents
- `js/campaign.js` - the 5 Adventure chapters, their levels and bosses
- `js/stage.js` - the paper stage, chapter scenery, effects and tweens
- `server.mjs` - zero-dependency static server (127.0.0.1, `PORT`, default 47905)
