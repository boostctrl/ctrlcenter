---
name: visual-verify
description: Visually verify the production build in a real browser. Use after any UI, CSS, theme, scene, or widget-layout change, before committing — HTML-only smoke tests pass even when the CSS is missing. Renders pages with Playwright Chromium and fails on broken assets.
---

# Visual verify

Render the standalone production build in headless Chromium and screenshot the
affected pages. The dev server is not a substitute: standalone asset serving is
the thing that breaks, and it only exists in the production build.

## Steps

1. Build and assemble the standalone output exactly the way the Dockerfile
   ships it. `cp -r` into an existing directory nests (`static/static`), hence
   the `rm` first:

   ```bash
   npm run build
   rm -rf .next/standalone/.next/static .next/standalone/public
   cp -r .next/static .next/standalone/.next/static
   cp -r public .next/standalone/public
   ```

2. Launch on a spare port, pointing `CONFIG_PATH` at a scratch **copy** of the
   config so the check can never mutate the real dev config. **If the port is
   already taken (`EADDRINUSE`), a stale server from an earlier run is still
   up and will happily serve the OLD build** — the health check passes and the
   screenshots silently show code you didn't just build. Kill it first (see
   step 6). Run the server as a background task:

   ```bash
   cp config/config.yaml "$SCRATCH/visual-config.yaml"
   PORT=3111 HOSTNAME=127.0.0.1 CONFIG_PATH="$SCRATCH/visual-config.yaml" \
     node .next/standalone/server.js
   ```

3. Wait for readiness. `curl` is not available in the sandbox — use node:

   ```bash
   node -e "(async()=>{for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:3111/api/health')).ok)process.exit(0)}catch{}await new Promise(r=>setTimeout(r,500))}process.exit(1)})()"
   ```

4. Screenshot every page the change touches, in both color schemes:

   ```bash
   node .claude/skills/visual-verify/screenshot.mjs http://127.0.0.1:3111/ "$SCRATCH/home-light.png"
   node .claude/skills/visual-verify/screenshot.mjs http://127.0.0.1:3111/ "$SCRATCH/home-dark.png" dark
   ```

   Exit 1 means broken: same-origin 4xx/5xx or failed requests, an uncaught
   page error, or zero stylesheets. `WARN` lines are non-fatal and expected —
   off-origin noise like ipwho.is geolocation rate limits, and console chatter.

5. **Read each screenshot and actually look at it.** The script only proves the
   assets load; whether the page looks right is your judgment call. Compare
   against the intent of the change, not just "did something render".

6. Kill the server. If it's a background task of this session, stop it by task
   id. Don't reach for `pkill -f "standalone/server.js"`: the process renames
   itself to `next-server (v…)` so the pattern misses it — while matching (and
   killing) your own wrapper shell. For a stray server from an earlier session,
   find the real PID on the port and kill that:

   ```bash
   ss -tlnp | grep 3111   # → pid=… of "next-server"
   kill <pid>
   ```

Pages worth checking beyond the one you changed: `/` (the widget grid),
`/help`, `/calendar`, `/weather`, `/status`, and `/admin` for settings-UI work.

## CSP / security-header changes: test via the LAN IP, not localhost

`localhost` is a "potentially trustworthy" origin and is exempt from CSP
directives like `upgrade-insecure-requests` — a localhost render can look
perfect while a real plain-HTTP LAN deployment is completely broken. Exactly
that shipped in 0.3.0: the directive upgraded same-origin asset/API requests
to HTTPS on `http://<nas-ip>:3000`, killing styling and admin login (fixed in
0.3.1). For changes touching `proxy.ts`, `next.config.ts` headers, or anything
CSP-adjacent: bind `HOSTNAME=0.0.0.0`, get the address with `hostname -I`, and
point the screenshot script at `http://<lan-ip>:PORT`.
