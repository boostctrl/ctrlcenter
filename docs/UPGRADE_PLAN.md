# CtrlCenter upgrade plan

_Analysis of `develop` @ `99f4111` (v2.9.0), 2026-10-07. All four phases
landed on `develop` the same day and ship in 2.10.0; each phase below opens
with its status._

## Where things stand

- **Healthy core.** Lint and typecheck are clean. 695 of 696 tests pass; the one
  failure is environmental (see 2.3). The build passes. The release pipeline,
  changelog discipline and shared service layer (`lib/services/http.ts`) are
  solid.
- **No commits for ~10 weeks, so dependencies have drifted.** `npm audit` reports
  18 advisories (1 critical, 13 high, 4 moderate). The critical one is in
  Next 16.2.9 and needs patching now, because of how this app does auth (see 1.1).
- **About 47k lines.** 81 of 94 components are client components, and four files
  run 1,000–2,300 lines (`SettingsManager`, `PrefsProvider`, `ThemeBuilder`,
  `Dashboard`). The app uses none of the React 19 / Next 16 data APIs yet.
- **Tests cover `lib/` helpers only.** There are no route, component or end-to-end
  tests, and test files are excluded from typecheck; 54 type errors hide there.

### Dependency drift

| Package | Current | Target | Notes |
| --- | --- | --- | --- |
| next / eslint-config-next | 16.2.9 | **16.4.0** | Critical + 11 other advisories; also pulls patched postcss/sharp |
| react / react-dom (+types) | 19.2.4 | 19.3.0 | |
| sharp | 0.35.2 | 0.35.5 | libvips/libheif/librsvg CVEs (#209) |
| nodemailer | 9.0.3 | 10.0.15 | 7 advisories (major bump) |
| js-yaml | 4.3.0 | 4.3.2 | CPU-DoS advisories; 5.x is a separate evaluation |
| jose, zod, tailwind, vitest | patch/minor | latest 4.x / 6.x | |
| Node (Docker, CI) | 22 (maintenance LTS) | 24 (active LTS) | `@types/node` is still `^20` |
| eslint | 9 | 10 | Major; evaluate separately |
| vitest | 4 | 5 | Major; evaluate separately |
| typescript | 5.9 | 7.0 | Native compiler; evaluate last |

**Trial result:** applying every in-range/target bump above, except the
"evaluate separately" majors, in a scratch worktree passed lint (1 new
warning), typecheck, tests and build unchanged. `npm audit` dropped from 18
advisories to 5, all of them the dev-only `braces` chain under
`eslint-config-next` (#224).
**Gotcha:** npm 10.9.4 (bundled with Node 22) crashes updating this lockfile
(`Cannot read properties of null (reading 'edgesOut')`). npm 11 works. Use
`npx npm@11` or move to Node 24.

---

## Phase 0: Security patch (do first)

> **Status: landed on `develop`** in `d0c3859`, `4d46660` and `0e40da3`
> (closes #248, #209, #224), shipping in 2.10.0. Follow-ups found while doing it:
> #249 (IPv6 test), #250 (dev-only `braces` advisory), #251 (visual-verify
> script vs. Next 16.4 prefetch).

**1.1 Upgrade Next to 16.4.0 and add route-level auth (critical).**
Next ≤16.3.5 has a proxy/middleware bypass (GHSA-6gpp-xcg3-4w24) for Turbopack
builds, which is the default build here. This app authorizes several admin
endpoints **only** in `proxy.ts`; the handlers themselves don't check the
session:

- `/api/config` GET/POST: full config export **including integration, SMTP and
  CalDAV credentials**, and whole-config import.
- `/api/settings` GET/PUT, `/api/apps[/id]`, `/api/bookmarks[/id|/category]`,
  `/api/themes`, `/api/password` (that one still requires the current password).
- The `/admin*` pages, where `app/admin/page.tsx` passes full settings, secrets
  included, to the client.

I haven't confirmed whether the advisory's "single locale" condition matches
this setup (there's no i18n config). If it does, a bypass means anyone can steal
credentials and take over the config without logging in. Fix both layers either
way:

- Bump `next` and `eslint-config-next` to 16.4.0.
- Add a `requireAdmin()` helper and call it in every handler above, plus an
  `app/admin/layout.tsx` guard. Keep the proxy check as the outer layer.
- Add a test that walks `app/api/**/route.ts` and fails if a route outside an
  explicit public allowlist (health, login, logout, hooks, icons, status) lacks
  the check.
- This also closes the gap where the proxy matcher skips any path ending in
  `.ext`, e.g. `PUT /api/apps/x.y`.

**1.2 Turn off the image optimizer.** `next/image` isn't used, but
`/_next/image` is live and has had RCE/DoS advisories. Set
`images: { unoptimized: true }` and confirm `/_next/image` returns 4xx.

**1.3 Apply the in-range dependency bumps** from the table above (sharp,
nodemailer 10, js-yaml 4.3.2, jose, zod, tailwind, vitest 4.1.11) and run
`npm audit fix`. Verify a real SMTP alert send, since nodemailer is a major
bump. Closes #209.

**1.4 Keep local config out of images.** `.dockerignore` doesn't exclude
`config/`, and Next's file tracing copies the whole project into
`.next/standalone`, including `config/` and every source file. A local
`docker build` from a dev checkout can therefore ship `config/config.yaml`
(password hash, integration keys). Fix:

- Add `config/` to `.dockerignore`.
- Add `outputFileTracingExcludes`, or a `turbopackIgnore` hint on the
  `process.cwd()` joins in `lib/config.ts` and `lib/status-history.ts` (these
  cause the "whole project traced" build warnings).

## Phase 1: Hardening

> **Status: done** — #252 (same-origin checks), #253 (env secrets only to
> saved URLs), #254 (persisted session secret), #255 (single-use 2FA codes,
> atomic recovery codes), #256 (email links), #258 (container). Not fixable
> in a route handler: the login throttle can't identify clients without a
> reverse proxy (#257, needs a custom server entry). The compose example
> keeps binding all interfaces — `127.0.0.1` would break LAN access.


| # | Finding | Fix |
| --- | --- | --- |
| 1 | No CSRF/Origin check; the cookie is `SameSite=Lax` and `request.json()` accepts `text/plain` | Reject unsafe methods whose `Origin`/`Sec-Fetch-Site` isn't same-origin, and require a JSON content type |
| 2 | "Test connection" (`/api/monitor/test`, `/api/calendar/test`) falls back to env-held secrets for a caller-supplied URL, so the secret can be sent anywhere | Use stored/env secrets only when the URL matches the saved one |
| 3 | Session key falls back to `ADMIN_PASSWORD` (one SHA-256 of it); 7-day JWTs can't be revoked | Generate and persist a `SESSION_SECRET` on first start; add a session epoch so logout-all is possible |
| 4 | Login throttle: with hops=1 and direct exposure, a spoofed `X-Forwarded-For` gets a fresh bucket each time; with hops=0, everyone shares one bucket, so 5 bad tries lock the admin out | Use the socket address when hops=0; the compose example should bind `127.0.0.1:3000` |
| 5 | TOTP codes are replayable for about 90 seconds; recovery-code use isn't atomic | Remember the last accepted step; consume codes inside the config write queue |
| 6 | Webhook payload `url` goes into email `href` without a scheme check | Allow only `http(s):` |
| 7 | Container | `node:24-alpine@sha256:…`, a Dockerfile `HEALTHCHECK`, compose `cap_drop: [ALL]`, `no-new-privileges`, `read_only` + tmpfs, and a pinned image tag in the docs |

## Phase 2: Toolchain and quality gate

> **Status: done** — Node 24 + digest-pinned image (#258), tests typechecked
> (#259), IPv6 test (#249), Dependabot, browser smoke test in CI (#251),
> Vitest 5, js-yaml 5 (tolerant parsing kept), TypeScript 6.0. Blocked
> upstream: ESLint 10 and TypeScript 7 (#260).


1. **Node 24 everywhere:** Dockerfile, both workflows, `engines`,
   `@types/node@^24`, `tsconfig` `target: ES2022`.
2. **Typecheck tests.** Fix the 54 fixture errors (mostly `config.test.ts`),
   then either drop `**/*.test.ts` from the tsconfig exclude or add a
   `tsconfig.test.json` step to the gate. Same blind spot as #135.
3. **IPv6 test (#249):** `lib/status-check.test.ts` "bracketed IPv6 literal" hangs
   without IPv6 (`listen EAFNOSUPPORT ::1`, no error handler on `listen`).
   Probe for IPv6 once and use `it.skipIf`, and reject on `listen` errors.
4. **Majors, one commit each, gate after each:** ESLint 10 (wait until
   `eslint-config-next` supports it), Vitest 5, js-yaml 5, and TypeScript 7 last
   (optionally keep `tsc` 5.9 in CI until the Next plugin supports it).
5. **Stop the drift:** add `.github/dependabot.yml` (weekly npm, Actions and
   Docker updates; minor/patch updates grouped) so a critical advisory never
   waits 10 weeks again.
6. **Smoke tests in CI:** promote `.claude/skills/visual-verify` into a
   Playwright job that renders `/`, `/status`, `/admin/login` from the
   standalone build. Add route-handler tests for auth and the settings merge.

## Phase 3: Data and runtime robustness

> **Status: done** — parsed-config cache + `schemaVersion` (#263), settings
> autosave sends only changed keys (#261; same-key races between two tabs
> would still need revisions/409), history pruning, logged flush failures,
> shared history load, bounded/deduped status checks (#262). Deliberately
> not done: serving `/api/status` from poller results (dots would be up to
> one poll interval stale).


- **Config reads:** every request re-reads, migrates and Zod-parses
  `config.yaml`, several times per page render. Memoize on mtime, or wrap reads
  in React `cache()`.
- **Lost updates:** five client surfaces PUT the whole settings object, so a
  stale tab silently reverts layout/theme changes. Add a `revision` field and
  return 409 on mismatch.
- **Add a `schemaVersion`** to the config so future migrations aren't heuristic
  (`config-migrate.ts:161`).
- **Status history:**
  - Prune ids of deleted apps (currently kept forever).
  - Log flush failures instead of swallowing them.
  - Consider SQLite if app counts grow, since the whole JSON file is rewritten
    every poll.
- **Poller:**
  - Await `loadHistory()`.
  - Cap check concurrency.
  - Have `/api/status` serve the poller's results instead of re-pinging every
    app on its own.

## Phase 4: Code structure (incremental, alongside features)

> **Status: done, with judgment calls** — SettingsManager split (markup
> verified identical), schema split (exports verified equivalent),
> PrefsProvider/ThemeBuilder split, shared fetch-timeout / status-error /
> singleton helpers, React Compiler on, not-found/error pages (#264).
> Instead of a component-per-widget registry (blockFor reads ~30 dashboard
> closures), the widget switches are exhaustive so typecheck enforces every
> touchpoint. Not done on purpose: deriving update schemas (zod 4 `.partial()`
> fills defaults; most differ intentionally), a shared session cache (saves
> ~15 lines per service), Server Actions (route handlers already centralize
> auth and CSRF; actions would need a parallel guard).


- **Widget registry** (`widgets/<id>.tsx` exporting render, empty reason and
  label). This replaces the parallel `switch(id)` blocks in `Dashboard.tsx` and
  the label lists in `SettingsManager`, and removes most touchpoints the
  `new-widget` skill has to walk.
- **Split the big files:**
  - `SettingsManager` → one file per section, plus a `useSettingsDraft` hook.
  - `PrefsProvider` → theme-apply lib, location hook, saved-themes hook, and
    2–3 contexts.
  - `ThemeBuilder` → one file per tab.
  - `schema.ts` → per-domain files that derive the update schemas
    (`.partial()`/`.pick()`) instead of duplicating them.
- **Shared helpers:**
  - `fetchWithTimeout` (`AbortSignal.timeout`) to replace 6 hand-rolled copies.
  - `throwForStatus` for the repeated 401/403 mapping.
  - `createSessionCache` for qBittorrent/UniFi.
  - A single `globalThis` singleton helper (~25 copies today).
  - A shared `settingsApi` client.
- **React Compiler** (`reactCompiler: true`) once the providers are split.
- **Server Actions / `useActionState` / `useOptimistic`** for mutations, **only
  after** `requireAdmin()` exists, because actions POST to page URLs the proxy
  doesn't gate. Also add `loading.tsx`, `error.tsx`, `not-found.tsx`.

## Existing open issues

- #209 (sharp CVEs) and #224 (brace-expansion): closed by Phase 0.
- #250 (`braces`, dev-only): remains until `eslint-config-next` drops the chain.
- #230 and #205: feature work, unaffected by this plan.
