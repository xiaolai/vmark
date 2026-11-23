---
paths:
  - "package.json"
  - "src-tauri/tauri.conf.json"
  - "src-tauri/Cargo.toml"
  - "src-tauri/Cargo.lock"
  - "server/mcp/package.json"
  - "server/mcp/src/cli.ts"
  - "scripts/bump-version.sh"
  - ".github/workflows/release*.yml"
  - "CHANGELOG.md"
---

# 40 - Version Bump Procedure

Use `/bump` or `scripts/bump-version.sh <x.y.z>`. The five version sources must
change together, and `src-tauri/Cargo.lock` must be regenerated and committed
with them (`cargo update -p vmark --manifest-path src-tauri/Cargo.toml`).

The version format is **`YYYY.M.<count>`** — year, month (no leading zero), and
the cumulative release count, e.g. `2026.11.167`. It is deliberately SemVer-shaped
(`X.Y.Z`) so the Tauri updater keeps working; `YYYY` and `M` follow the calendar
and only `<count>` increments on each release. The month carries **no leading
zero**: `2026.1.168`, not `2026.01.168` — the `semver` crate (used by the
updater on `latest.json`) rejects a leading zero in the minor component.

`<count>` is the TOTAL number of releases (release tags plus one — tags are kept
forever by `cleanup-old-releases`), not the old 0.9.x patch number. The
transition was from `0.9.125` (the 166th release) to `2026.11.167`: the count
jumps once from the 0.9.x patch to the true total, then increments by one each
release.

| File | Field |
|------|-------|
| `package.json` | `"version"` (the website reads it at build time) |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version` |
| `server/mcp/package.json` | `"version"` |
| `server/mcp/src/cli.ts` | `VERSION` — declared with SINGLE quotes; a double-quote-only `sed` silently matches nothing |

Mismatches show as `Version 0.2.5 (0.3.0)` in About, or a stale MCP health-check version.

## Release notes and notices (same commit as the bump)

1. **Write the release's `CHANGELOG.md` section before bumping.** Move the
   `## [Unreleased]` entries under `## [x.y.z] - YYYY-MM-DD` (Keep a Changelog:
   Added, Changed, Fixed, Removed, Security), complete them from
   `git log vPREV..HEAD` in words a user understands, and add the `[x.y.z]:`
   link at the bottom. The section is the GitHub release body and the update
   card's "what's new" text. `release.yml` refuses a tag without one
   (`scripts/extract-changelog-section.mjs`), and the gates tier fails while
   the tree's own version has none.
2. **Refresh the bundled notices:** `node scripts/gen-third-party-licenses.mjs`
   (needs `cargo about` 0.8.2: `cargo install cargo-about --locked --version 0.8.2`)
   and commit `src-tauri/resources/generated/THIRD_PARTY_LICENSES.txt`. The
   release regenerates the file before building, so the shipped copy is exact
   either way; this keeps the tracked copy from falling behind.

`scripts/bump-version.sh` checks the first and runs the second; it exits 1
while the section is missing.

## Landing and tagging

1. **Prefer folding the bump into the feature PR** being released; a standalone
   bump PR costs a full CI cycle. Standalone is the fallback when `main` already
   has the changes.
2. `main` requires a PR (rule 60 §10): push a branch, `gh pr create --fill`,
   `gh pr checks --watch`, `gh pr merge --merge`, then
   `git checkout main && git pull`. **Merge the PR that carries the bump with
   `--merge`, even a feature PR that would normally be squashed.** The tag gate
   vouches for a commit through an ancestor with the same tree, which a merge
   commit's PR-head parent is; a squash or rebase commit has none, so its tag
   is refused.
3. `git tag vX.Y.Z && git push origin vX.Y.Z`. **Never `git push --tags`** — a
   stale tag triggers a second release that can become "Latest".
4. The pre-push tag leg (`scripts/check-tag-green.sh`) passes immediately after
   the merge. If the push dies with SIGPIPE (141) after a green gate, the SSH
   keepalive is missing: run `node scripts/setup-local-git.mjs`. Never
   `--no-verify`.

## Related failure classes

- Tauri npm package and Rust crate versions must share major/minor, or
  `tauri build` fails only at release time. `pnpm lint:tauri-versions` catches
  the skew; align the pair.
- There is no post-release cleanup step: releases build in CI and leave nothing
  locally. Disk growth is `src-tauri/target/debug`; use `pnpm clean:dev`.

## Verification

About VMark shows a single version; `vmark-mcp-server --version` and the MCP
status dialog show the same one.
