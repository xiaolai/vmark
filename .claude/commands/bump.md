---
description: Bump version across all 5 files, write the release notes, land it via PR, then tag and push
argument-hint: "[version | patch | minor | major]"
---

# Version Bump

Bump the version number across all 5 required files, write the release notes in
`CHANGELOG.md`, land the commit on `main`
through a pull request, then tag and push.

**`main` cannot be pushed directly** (since 2026-07-27 — `enforce_admins: true`
on the `frontend` + `rust` checks, see `.claude/rules/60-ai-governance.md` §10).
A direct push of the bump commit is rejected, because the required checks cannot
have run on a commit the remote has never seen. Tag pushes are **not** gated, so
the release trigger is unchanged.

## Input

```text
$ARGUMENTS
```

## Phase 1: Determine New Version

Read current version from `package.json`.

Version format is `YYYY.M.<count>` — year, month (no leading zero), and the
cumulative release count, e.g. `2026.11.167`. It is deliberately SemVer-shaped
so the Tauri updater keeps working; `YYYY` and `M` follow the calendar and only
`<count>` increments, and the month has **no leading zero** (`2026.1.168`, not
`2026.01.168` — the `semver` crate rejects a leading zero in the minor).

`<count>` is the TOTAL number of releases, not the old 0.9.x patch. Compute it
as the number of release tags plus one (tags are never deleted —
`cleanup-old-releases` prunes GitHub release pages, not git tags):

```
count=$(( $(git tag | grep -cE '^v[0-9]+\.[0-9]+\.[0-9]+$') + 1 ))
```

At the transition 166 tags exist (v0.6.14 → v0.9.125), so the next release is
`2026.11.167`.

Parse `$ARGUMENTS`:

| Input | Action |
|-------|--------|
| `X.Y.Z` | Use exactly as specified |
| `patch` | `$(date +%Y).$((10#$(date +%m))).$count` — today's year and month, `$count` as computed above |
| (empty) | Same as `patch` |

`minor` and `major` no longer apply: the year and month come from the calendar,
not from a bump choice. To set a version by hand, pass the explicit `X.Y.Z`.

Validate the resolved version matches `^[0-9]+\.[0-9]+\.[0-9]+$`. Anything
else (e.g., `0.7.14.1`, `0.7`, `v0.7.15`, `2026.01.168`) is rejected — the
Tauri updater parses `latest.json.version` with `semver` and rejects
non-canonical shapes, and any divergence between the five files breaks the
build.

Display: `Current: {old} → New: {new}` and ask user to confirm.

## Phase 2: Quality Gate

Run `pnpm check:all` before touching any version file. Abort the bump
on any failure — tagging a broken build creates a public tag that the
release workflow then fails on, and the tag stays in the repo until
manually deleted.

## Phase 3: Update All 5 Files

All five files must be updated — see `.claude/rules/40-version-bump.md`.

| File | Field |
|------|-------|
| `package.json` | `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version` |
| `server/mcp/package.json` | `"version"` |
| `server/mcp/src/cli.ts` | `const VERSION` |

Use the Edit tool for each file — not sed.

Then sync the **derived** lockfile, which is a sixth file in the commit even
though nothing edits it by hand:

```bash
cargo update -p vmark --manifest-path src-tauri/Cargo.toml
```

`src-tauri/Cargo.lock` carries the `vmark` package's own version. Skip this and
it stays behind, leaving `origin/main` dirty and breaking any
`cargo build --locked` / `--frozen` — which is what the release workflow and CI
run.

## Phase 3b: Release notes and notices

The release notes are the new version's `CHANGELOG.md` section; `release.yml`
refuses to release a tag without one, and it becomes both the GitHub release
body and the in-app update card's "what's new" text.

1. Read `git log v{old}..HEAD --no-merges` and the `## [Unreleased]` entries.
2. Move them under `## [{version}] - YYYY-MM-DD` (today's date), grouped as
   Added / Changed / Fixed / Removed / Security, written for users — what
   changed for them, not commit subjects. Leave an empty `## [Unreleased]`.
3. Add `[{version}]: https://github.com/xiaolai/vmark/releases/tag/v{version}`
   to the links at the bottom and point `[Unreleased]` at `v{version}...HEAD`.
4. Refresh the bundled notices: `node scripts/gen-third-party-licenses.mjs`
   (needs `cargo about` 0.8.2).

## Phase 4: Verify

Read back all 5 files, plus the lockfile, and confirm the version matches:

```bash
grep '"version"' package.json src-tauri/tauri.conf.json server/mcp/package.json
grep '^version' src-tauri/Cargo.toml
grep 'const VERSION' server/mcp/src/cli.ts
git diff --stat src-tauri/Cargo.lock     # must show 1 changed line
node scripts/extract-changelog-section.mjs {version} --plain   # the update card's text; exit 1 = no section
```

If any mismatch: fix before proceeding.

## Phase 5: Commit and land via PR

```bash
git checkout -b bump-v{version}
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml \
        src-tauri/Cargo.lock \
        server/mcp/package.json server/mcp/src/cli.ts \
        CHANGELOG.md src-tauri/resources/generated/THIRD_PARTY_LICENSES.txt
git commit -m "chore: bump version to {version}"
git push -u origin bump-v{version}
gh pr create --fill
gh pr checks --watch                     # frontend + rust must be green
gh pr merge --merge --delete-branch
```

Do **not** tag yet. Wait for the merge.

Use `--merge`, never `--squash` or `--rebase`, including when the bump rides in
a feature PR. CI runs only on the PR, so the tag gate vouches for the merged
commit through an ancestor with the same tree: a merge commit's PR-head parent.
A squash or rebase commit has no such ancestor, and its tag is refused.

## Phase 6: Tag the merged commit and push

Tag `main` *after* pulling the merge, so the tag names a commit that is on
`main` and whose checks actually passed:

```bash
git checkout main && git pull origin main
git tag v{version}
git push origin v{version}
```

**Never use `git push --tags`** — it re-pushes stale local tags that the
release workflow's `cleanup-old-releases` step has already deleted from
origin, each one re-triggering a release run. Push the single new tag
only. See `.claude/rules/40-version-bump.md` for the full incident
context.

Pushing a `v*` tag fires the local `pre-push` tag leg: a seconds-fast `gh api`
verification (`scripts/check-tag-green.sh`) that the required checks
(`frontend`, `rust`) are green on the tagged commit — it passes immediately
here because the tag names the just-merged, fully-checked commit. It refuses
(fail closed) on a pending/red/missing check or an unreachable `gh`;
`VMARK_OFFLINE_GATE=1` runs the full legacy local gate instead (minutes — the
authoritative timing lives in the `.githooks/pre-push` header) while git holds
the SSH connection open. If the push dies with
**SIGPIPE (exit 141)** right after the gate reports green, the SSH
keepalive is missing: run `node scripts/setup-local-git.mjs`, or retry once with
`GIT_SSH_COMMAND='ssh -o ServerAliveInterval=20' git push origin v{version}`.
That is a transport timeout, not a quality failure — `--no-verify` is not the
fix, and is forbidden without authorization (`60-ai-governance.md` §9).

Report done: `Bumped to {version}, merged via PR #{n}, tagged v{version}, pushed.`
