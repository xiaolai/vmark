---
description: Bump version across all 5 files, land it via PR, then tag and push
argument-hint: "[version | patch | minor | major]"
---

# Version Bump

Bump the version number across all 5 required files, land the commit on `main`
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

Parse `$ARGUMENTS`:

| Input | Action |
|-------|--------|
| `0.5.0` | Use exactly as specified |
| `patch` | Increment patch: `0.4.2` → `0.4.3` |
| `minor` | Increment minor: `0.4.2` → `0.5.0` |
| `major` | Increment major: `0.4.2` → `1.0.0` |
| (empty) | Default to `patch` |

Validate the resolved version matches `^[0-9]+\.[0-9]+\.[0-9]+$`. Anything
else (e.g., `0.7.14.1`, `0.7`, `v0.7.15`) is rejected — the Tauri updater
parses `latest.json.version` with `semver` and rejects non-canonical
shapes, and any divergence between the five files breaks the build.

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
| `vmark-mcp-server/package.json` | `"version"` |
| `vmark-mcp-server/src/cli.ts` | `const VERSION` |

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

## Phase 4: Verify

Read back all 5 files, plus the lockfile, and confirm the version matches:

```bash
grep '"version"' package.json src-tauri/tauri.conf.json vmark-mcp-server/package.json
grep '^version' src-tauri/Cargo.toml
grep 'const VERSION' vmark-mcp-server/src/cli.ts
git diff --stat src-tauri/Cargo.lock     # must show 1 changed line
```

If any mismatch: fix before proceeding.

## Phase 5: Commit and land via PR

```bash
git checkout -b bump-v{version}
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml \
        src-tauri/Cargo.lock \
        vmark-mcp-server/package.json vmark-mcp-server/src/cli.ts
git commit -m "chore: bump version to {version}"
git push -u origin bump-v{version}
gh pr create --fill
gh pr checks --watch                     # frontend + rust must be green
gh pr merge --merge --delete-branch
```

Do **not** tag yet. Wait for the merge.

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

Pushing a `v*` tag still fires the local `pre-push` gate (cross-target compile
check, `cargo fmt --check`, `cargo clippy -D warnings`, then `pnpm check:all` —
~3 min) while git holds the SSH connection open. If the push dies with
**SIGPIPE (exit 141)** right after "quality gate green — push allowed", the SSH
keepalive is missing: run `node scripts/setup-local-git.mjs`, or retry once with
`GIT_SSH_COMMAND='ssh -o ServerAliveInterval=20' git push origin v{version}`.
That is a transport timeout, not a quality failure — `--no-verify` is not the
fix, and is forbidden without authorization (`60-ai-governance.md` §9).

Report done: `Bumped to {version}, merged via PR #{n}, tagged v{version}, pushed.`
