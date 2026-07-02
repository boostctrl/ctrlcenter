# Development guide

CtrlCenter is a self-hosted homepage/dashboard (Next.js). This file is the
process contract for anyone — human or AI — working on the repo. Setup and
architecture live in [README.md](README.md#development); this file covers how
work flows from idea to release.

## Branch model

- All work lands on `develop`. Small, focused commits with imperative subject
  lines ("Add …", "Fix …", "Cap …").
- `main` is the release branch. It only ever advances by fast-forward from
  `develop` at release time — never by direct commit (a pre-commit hook in
  `.githooks/` enforces this; `npm install` wires it up via the `prepare`
  script).

## Releases

- One command cuts a release: `scripts/release.sh X.Y.Z`. It finalizes the
  changelog, bumps `package.json` **and** `package-lock.json`, commits
  `Release X.Y.Z`, fast-forwards `main`, tags `vX.Y.Z` on that commit, and
  pushes. Run it with `--dry-run` first to see the plan.
- **The `v*` tag push _is_ the release.** CI re-runs the quality gate, builds
  the multi-arch image to GHCR, and publishes the GitHub release with notes
  extracted from the matching `CHANGELOG.md` section. Never run
  `gh release create` or build/push images by hand.
- The tag must point at the `Release X.Y.Z` commit itself. Do not land
  commits between the release commit and the tag — v1.2.2 shipped three
  commits its changelog never mentioned that way. The script makes this
  structurally impossible; don't tag by hand.

## Changelog

- [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format,
  [SemVer](https://semver.org/spec/v2.0.0.html) versioning.
- Every user-visible change adds an entry under `## [Unreleased]` **in the
  same commit** that makes the change, referencing the issues it addresses
  (`(#NN)`).
- Release notes are extracted verbatim from the version's section, so write
  entries for end users, not for developers.

## Issues

- Anything discovered but not fixed in the current change gets a GitHub issue
  before moving on — findings must not live only in a conversation.
- Label every issue on creation (`bug`, `enhancement`, `security`, …).
- Before filing, search closed issues; reopen a matching one instead of
  duplicating it.
- Closing keywords apply to one issue each: write `Closes #12, Closes #34`,
  not `Closes #12, #34`.

## Verification

- Quality gate (identical to CI): `npm run lint && npm test && npm run build`.
- For visual changes, verify the real production build: copy `.next/static`
  into the standalone output and drive it with Playwright Chromium. HTML-only
  smoke tests pass even when the CSS is missing — actually render the page.

## UI conventions

- Reuse the app's canonical button recipe instead of one-off styles.
- No decorative "→" arrows on links or buttons.
- Never widen the header horizontally to fit new affordances.
