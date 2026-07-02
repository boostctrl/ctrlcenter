#!/usr/bin/env bash
# Cut a release in one command.
#
#   scripts/release.sh X.Y.Z [--dry-run] [--no-push]
#
# From `develop`, this finalizes the CHANGELOG (Unreleased -> [X.Y.Z] - date,
# with refreshed compare links), bumps package.json + package-lock.json in
# lockstep, commits "Release X.Y.Z", fast-forwards `main`, tags vX.Y.Z on that
# exact commit, and pushes develop + main + the tag. The tag push triggers the
# Release workflow (re-test, multi-arch image, GitHub release).
#
#   --dry-run   validate everything and print the plan; change nothing
#   --no-push   do everything locally but stop before pushing
set -euo pipefail

REPO_URL="https://github.com/boostctrl/ctrlcenter"

die() { echo "✋ $*" >&2; exit 1; }

version="" dry_run=0 no_push=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    --no-push) no_push=1 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "Unknown flag: $arg" ;;
    *) [ -z "$version" ] || die "Unexpected argument: $arg"; version="$arg" ;;
  esac
done

[ -n "$version" ] || die "Usage: scripts/release.sh X.Y.Z [--dry-run] [--no-push]"
echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' \
  || die "'$version' is not a semver version (expected X.Y.Z, no leading v)."
tag="v$version"

cd "$(git rev-parse --show-toplevel)"

# --- Preconditions ----------------------------------------------------------

branch=$(git symbolic-ref --short HEAD)
[ "$branch" = "develop" ] || die "Releases are cut from 'develop' (on '$branch')."

[ -z "$(git status --porcelain)" ] || die "Working tree is not clean."

git fetch origin --quiet
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/develop)" ] \
  || die "'develop' is not in sync with origin/develop — pull/push first."

! git rev-parse -q --verify "refs/tags/$tag" >/dev/null || die "Tag $tag already exists."

current=$(node -p "require('./package.json').version")
[ "$version" != "$current" ] || die "package.json is already at $version."

# main must be an ancestor of develop or the fast-forward will fail later.
git merge-base --is-ancestor main HEAD \
  || die "'main' has commits not on 'develop' — reconcile before releasing."

unreleased=$(awk '/^## \[Unreleased\]/{flag=1;next} flag && /^## /{exit} flag{print}' CHANGELOG.md)
echo "$unreleased" | grep -q '[^[:space:]]' \
  || die "CHANGELOG.md has no entries under [Unreleased] — nothing to release."

prev=$(sed -n 's#^\[Unreleased\]: .*/compare/v\(.*\)\.\.\.HEAD$#\1#p' CHANGELOG.md)
[ -n "$prev" ] || die "Couldn't parse the [Unreleased] compare link in CHANGELOG.md."

today=$(date +%Y-%m-%d)

echo "Release plan:"
echo "  $current -> $version (tag $tag, previous release v$prev)"
echo "  CHANGELOG [Unreleased] -> [$version] - $today:"
echo "$unreleased" | sed 's/^/  | /'
echo "  Then: commit 'Release $version' on develop, ff main, tag, push."

if [ "$dry_run" = 1 ]; then
  echo "Dry run — no changes made."
  exit 0
fi

# --- Quality gate (same as CI) ----------------------------------------------

npm run lint
npm test
npm run build

# --- Finalize the changelog and bump versions -------------------------------

sed -i "s|^## \[Unreleased\]$|## [Unreleased]\n\n## [$version] - $today|" CHANGELOG.md
sed -i "s|^\[Unreleased\]: .*$|[Unreleased]: $REPO_URL/compare/$tag...HEAD\n[$version]: $REPO_URL/compare/v$prev...$tag|" CHANGELOG.md

# npm version bumps package.json and package-lock.json together, so the two
# can't drift the way they did in 1.3.0.
npm version --no-git-tag-version "$version" >/dev/null

git add CHANGELOG.md package.json package-lock.json
git commit -m "Release $version"

# --- Fast-forward main and tag the release commit ---------------------------

git checkout main
git merge --ff-only develop
git tag "$tag"
git checkout develop

if [ "$no_push" = 1 ]; then
  echo "Done locally (--no-push). To publish:  git push origin develop main $tag"
  exit 0
fi

if [ -t 0 ]; then
  printf "Push develop, main and %s to origin (this publishes the release)? [y/N] " "$tag"
  read -r answer
  case "$answer" in y|Y|yes|YES) ;; *) \
    echo "Not pushed. To publish:  git push origin develop main $tag"; exit 0 ;; esac
fi

git push origin develop main "$tag"
echo "✅ $tag pushed — the Release workflow takes it from here:"
echo "   $REPO_URL/actions"
