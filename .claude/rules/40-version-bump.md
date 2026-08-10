# 40 - Version Bump Procedure

When bumping the version number, **all five source files must be updated
together**, and the derived `src-tauri/Cargo.lock` must be regenerated and
committed with them — a stale lockfile leaves `origin/main` dirty and breaks
any `cargo build --locked` / `--frozen` (release + CI).

## Files to Update

| File | Field | Source |
|------|-------|--------|
| `package.json` | `"version"` | Frontend/npm |
| `src-tauri/tauri.conf.json` | `"version"` | Bundle (CFBundleShortVersionString) |
| `src-tauri/Cargo.toml` | `version` | Rust (`env!("CARGO_PKG_VERSION")`) |
| `server/mcp/package.json` | `"version"` | MCP sidecar npm |
| `server/mcp/src/cli.ts` | `VERSION` | MCP sidecar health check |

## Why All Five Matter

**App version (first 3 files):**
- macOS About dialog displays version from Cargo.toml and tauri.conf.json
- If they differ, macOS shows: `Version 0.2.5 (0.3.0)` (confusing)

**MCP server version (last 2 files):**
- `--version` and `--health-check` CLI flags report version from cli.ts
- Settings panel and status dialog show version from useMcpHealthCheck.ts (reads from MCP_VERSION constant)
- Must match main app to avoid user confusion

**Website version (automatic):**
- The website reads version from `package.json` at build time via `__VMARK_VERSION__` (defined in `website/.vitepress/config/shared.ts`)
- Displayed in the navbar beta badge (`BetaBadge.vue`)
- No extra file to update — just rebuild/deploy the website after bumping

## Bump Procedure

1. **Update all five files** with the new version:
   ```bash
   # Example: bumping to 0.4.0
   VERSION="0.4.0"

   # Main app files
   sed -i '' 's/"version": "[^"]*"/"version": "'$VERSION'"/' package.json
   sed -i '' 's/"version": "[^"]*"/"version": "'$VERSION'"/' src-tauri/tauri.conf.json
   sed -i '' 's/^version = "[^"]*"/version = "'$VERSION'"/' src-tauri/Cargo.toml

   # MCP server files
   sed -i '' 's/"version": "[^"]*"/"version": "'$VERSION'"/' server/mcp/package.json
   # NOTE the quote class: cli.ts declares VERSION with SINGLE quotes. A
   # double-quote-only pattern matches nothing, exits 0, and leaves the sidecar
   # reporting the old version — the "forgot the MCP files" mistake below,
   # produced by the fix for it. Hit live on the 0.9.33 bump.
   sed -i '' "s/const VERSION = ['\"][^'\"]*['\"]/const VERSION = '$VERSION'/" server/mcp/src/cli.ts

   # Sync the derived lockfile so src-tauri/Cargo.lock's `vmark` entry matches
   # Cargo.toml. Locks 0 other packages; any cargo invocation against the
   # manifest (e.g. `cargo check`) syncs it too.
   cargo update -p vmark --manifest-path src-tauri/Cargo.toml
   ```

2. **Verify all match**:
   ```bash
   grep '"version"' package.json src-tauri/tauri.conf.json server/mcp/package.json
   grep '^version' src-tauri/Cargo.toml
   grep 'const VERSION' server/mcp/src/cli.ts
   ```

3. **Commit together**:
   ```bash
   git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml \
           src-tauri/Cargo.lock \
           server/mcp/package.json server/mcp/src/cli.ts
   git commit -m "chore: bump version to 0.4.0"
   ```

4. **Prefer folding the bump into the feature PR.** A standalone bump PR pays a
   FULL CI cycle — frontend-run ~22 min, the 3-OS Rust matrix, bench, webkit,
   ~57 runner-minutes — to change five version strings and one lockfile line.
   On the v0.9.28 release that was the single largest waste of the whole
   release. When the change being released is still in flight, commit the bump
   onto that branch and let one PR carry both; the release notes do not care
   which commit moved the number.

   A standalone bump PR is the fallback for when `main` already carries the
   changes being released. It is not the default.

5. **Open a PR, then tag** (`main` requires one since 2026-07-27 — see
   `60-ai-governance.md` §10; a direct push of a new commit is rejected because
   the required checks cannot have run on it yet):
   ```bash
   git checkout -b bump-v0.4.0        # from the bump commit
   git push origin bump-v0.4.0
   gh pr create --fill
   gh pr checks --watch               # frontend + rust must be green
   gh pr merge --merge                # or --squash
   git checkout main && git pull
   git tag v0.4.0
   git push origin v0.4.0             # tags are NOT gated by branch protection
   ```

   **CRITICAL: Never use `git push --tags`** — it pushes ALL local tags, including
   stale ones. Each `v*` tag triggers a release workflow. If a stale tag (e.g., v0.3.0)
   is pushed alongside v0.4.0, both trigger releases, and the stale one can finish
   last and become "Latest" — causing users to receive an old version.

   Always push the **specific tag only**: `git push origin v0.4.0`

   **Pushing a `v*` tag triggers the local `pre-push` tag leg**: a seconds-fast
   `gh api` verification (`scripts/check-tag-green.sh`) that CI's required
   checks (`frontend`, `rust`) are green on the tagged commit — or, since CI is
   `pull_request`-only, on an ancestor with an IDENTICAL TREE, which is where a
   merge commit's checks actually live. Either way it passes immediately after
   the PR merge; there is no waiting for a second CI run. (Before 2026-08-05
   this blocked releases for ~22 min while `main`'s duplicate run re-verified
   bytes the PR had already passed — see `60-ai-governance.md` §10.) It refuses (fail closed) if a check is pending, red,
   missing, or `gh` is unreachable; `VMARK_OFFLINE_GATE=1` runs the full
   legacy local gate instead (minutes — see the `.githooks/pre-push` header
   for the authoritative timing) while git holds the SSH connection open.
   The `prepare` script
   (`scripts/setup-local-git.mjs`) sets an SSH keepalive (`core.sshCommand`) so
   an idle connection survives a long gate. If a push ever dies with **SIGPIPE
   (exit 141)** right after the gate reports green, the keepalive is
   missing: run `node scripts/setup-local-git.mjs`, or push once with
   `GIT_SSH_COMMAND='ssh -o ServerAliveInterval=20' git push origin v0.4.0`.
   The gate is green — this is a transport timeout, not a quality failure, so
   `--no-verify` is **not** the fix (and is forbidden without authorization).

## Common Mistakes

- Forgetting Cargo.toml (causes dual version display in About dialog)
- Forgetting to regenerate `src-tauri/Cargo.lock` (leaves `origin/main` dirty;
  `cargo build --locked`/`--frozen` then fails)
- Forgetting MCP server files (causes version mismatch in health check)
- Tagging before all files are updated
- Using different versions across files
- **Using `git push --tags`** (pushes stale tags, triggers duplicate releases)

## Tauri npm/crate version sync (release-only failure class)

`tauri build` refuses to build when a Tauri package's npm and Rust crate
versions are on different major/minor releases — and that check runs **only at
`tauri build` (release) time**. `pnpm check:all` runs `vite build`, not
`tauri build`, so a dependabot bump of a `tauri-plugin-*` crate (or the npm
side) without its counterpart passes every PR gate and only breaks mid-release.
The v0.9.0 release hit this: `tauri-plugin-log` crate 2.9.0 (dependabot #1123)
vs `@tauri-apps/plugin-log` npm 2.8.0 aborted all four platform builds.

`scripts/check-tauri-versions.mjs` (`pnpm lint:tauri-versions`, wired into
`check:all`) now runs the same comparison standalone, so CI's `frontend` check
and the pre-push gate catch the skew **before** a tag ever ships. When it fires,
align the flagged pair on the same major/minor: bump the npm package in
`package.json` (then `pnpm install`) or the crate in `src-tauri/Cargo.toml`
(then `cargo update`).

## There is deliberately no "clean up build artifacts" step here

A release leaves **nothing** on the developer's machine, so a post-release
cleanup step would clean something the release never made. There is no
`tauri build` script in this repo at all; `release.yml` builds every platform
via `tauri-apps/tauri-action`, which is also the only way the Linux `.deb` /
`.rpm` / `.AppImage` and the Windows `.msi` could exist. Measured 2026-08-07:
after ~30 releases, neither this repo nor its sibling Tauri project had a
`src-tauri/target/release/bundle/` directory at all.

Disk pressure is real, but it comes from somewhere else. `src-tauri/target` had
reached 149 GB, of which:

| Subtree | Size | Share | Produced by |
|---|---:|---:|---|
| `debug/` | 137 GB | **92%** | `tauri dev`, `cargo test`, `cargo clippy` |
| `x86_64-pc-windows-gnu/` | 9.5 GB | 6% | `scripts/check-cross-target.sh` |
| `release/` | 2.0 GB | 1.3% | occasional local release-profile build |

The mechanism is that **Cargo has no garbage collector**: artifacts from
superseded dependency versions are never reclaimed, so the tree grows with time
and Dependabot churn, not with releases. A cleanup tied to releases would fire
on the wrong signal at the wrong cadence, reclaim ~1–8%, and make every release
cost a cold rebuild.

What exists instead:

- **`pnpm clean:dev`** (`scripts/clean-dev.sh`) — tiered cleanup. Tier 1 is
  project-local; tier 2 adds the machine-wide Cargo caches (keeping the registry
  index); tier 3 adds `pnpm store prune`. It **refuses** when
  `target/release/bundle/` exists unless given `--include-bundle`, because
  `cargo clean` cannot spare a subdirectory and a signed-but-unuploaded artifact
  costs a re-notarization to recreate.
- **An advisory in `pnpm tauri:dev`** (`scripts/dev-disk.mjs`) — prints the size
  of `src-tauri/target` once it passes 40 GiB. Strictly non-blocking, and
  deliberately **not** in `check:all`: the number is meaningless on an ephemeral
  CI runner, and `check-scripts-parity.test.mjs` requires every `check:all` gate
  to be reachable from a CI job.

## Verification

1. Check About VMark dialog shows single version number
2. Run `vmark-mcp-server --version` shows same version
3. MCP Status dialog in Settings shows same version
