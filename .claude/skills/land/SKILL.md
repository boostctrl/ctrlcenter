---
name: land
description: Finishing checklist for committing a completed change to develop. Use when a change is done and about to be committed — bundles the changelog, issue-hygiene, and verification steps that are easy to drop when a task ran long.
---

# Land a change

Run this top to bottom when a change is finished. Its whole purpose is to catch
the steps that get dropped at the end of a long, complex task.

1. **Branch.** You're on `develop`. Never commit to `main` — it only advances
   by fast-forward at release time.
2. **Quality gate.** `npm run lint && npm test && npm run build` — identical to
   CI, so a local pass means a green push.
3. **Visual check.** If the change touches anything rendered (components,
   styles, scenes, layout, help copy), run the **visual-verify** skill. An
   HTML-that-loads smoke test is not verification.
4. **Changelog.** Every user-visible change gets an entry under
   `## [Unreleased]` in `CHANGELOG.md`, written for end users, referencing its
   issues (`(#NN)`) — in the **same commit** as the change.
5. **Deferred findings.** Anything you noticed but didn't fix — bugs, follow-up
   ideas, cleanups — becomes a GitHub issue *now*, before it evaporates with
   the conversation. Search closed issues first and reopen a match instead of
   filing a duplicate; label every issue (`bug`, `enhancement`, `security`, …).
6. **Commit.** Imperative subject line ("Add …", "Fix …"). Closing keywords
   bind to one issue each: `Closes #12, Closes #34` — `Closes #12, #34` only
   closes the first.
7. **Push and confirm.** Push `develop`, then check CI:
   `gh run list --branch develop --limit 1` (and `gh run watch <id>
   --exit-status` if in doubt). A push isn't landed until CI is green.
