---
name: release
description: Cut and publish a release. Use when asked to release, ship, publish, or tag a new version. Wraps scripts/release.sh and the tag-driven pipeline — never tag or create GitHub releases by hand.
---

# Cut a release

`scripts/release.sh` does the mechanical work; this checklist is the judgment
around it.

## Before

1. Everything intended for the release is committed and pushed to `develop`,
   and CI is green (`gh run list --branch develop --limit 1`).
2. `CHANGELOG.md` has a complete `## [Unreleased]` section: every user-visible
   change since the last release, written for end users, with issue refs.
   Cross-check against `git log v<last>..develop --oneline` — anything
   user-visible missing from the changelog gets added *before* releasing.
3. Pick the version from the Unreleased content (SemVer): breaking → major,
   any new feature → minor, fixes/tweaks only → patch.

## Cut

```bash
scripts/release.sh X.Y.Z --dry-run   # review the plan and the notes it will ship
scripts/release.sh X.Y.Z             # the real thing
```

The script validates preconditions, runs the quality gate, finalizes the
changelog, bumps `package.json` + `package-lock.json` together, commits
`Release X.Y.Z`, fast-forwards `main`, tags that exact commit, and pushes.

## After — hands off

The `v*` tag push runs the Release workflow: re-test → multi-arch image to
`ghcr.io/boostctrl/ctrlcenter` → GitHub release with notes extracted from the
changelog. **Do not** run `gh release create`/`gh release edit` or push images
manually — the 0.9.9 release went red exactly because a release was created by
hand while the workflow raced it.

Watch it land, then confirm:

```bash
gh run list --workflow Release --limit 1
gh run watch <id> --exit-status
gh release view vX.Y.Z
```

If the workflow fails **before** the image is published, fix on `develop` and
cut the next patch version — don't force-move or delete tags; a pushed tag may
already have been fetched.
