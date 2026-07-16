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
| `vmark-mcp-server/package.json` | `"version"` | MCP sidecar npm |
| `vmark-mcp-server/src/cli.ts` | `VERSION` | MCP sidecar health check |

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
   sed -i '' 's/"version": "[^"]*"/"version": "'$VERSION'"/' vmark-mcp-server/package.json
   sed -i '' 's/const VERSION = "[^"]*"/const VERSION = "'$VERSION'"/' vmark-mcp-server/src/cli.ts

   # Sync the derived lockfile so src-tauri/Cargo.lock's `vmark` entry matches
   # Cargo.toml. Locks 0 other packages; any cargo invocation against the
   # manifest (e.g. `cargo check`) syncs it too.
   cargo update -p vmark --manifest-path src-tauri/Cargo.toml
   ```

2. **Verify all match**:
   ```bash
   grep '"version"' package.json src-tauri/tauri.conf.json vmark-mcp-server/package.json
   grep '^version' src-tauri/Cargo.toml
   grep 'const VERSION' vmark-mcp-server/src/cli.ts
   ```

3. **Commit together**:
   ```bash
   git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml \
           src-tauri/Cargo.lock \
           vmark-mcp-server/package.json vmark-mcp-server/src/cli.ts
   git commit -m "chore: bump version to 0.4.0"
   ```

4. **Tag and push**:
   ```bash
   git tag v0.4.0
   git push origin main v0.4.0
   ```

   **CRITICAL: Never use `git push --tags`** — it pushes ALL local tags, including
   stale ones. Each `v*` tag triggers a release workflow. If a stale tag (e.g., v0.3.0)
   is pushed alongside v0.4.0, both trigger releases, and the stale one can finish
   last and become "Latest" — causing users to receive an old version.

   Always push the **specific tag only**: `git push origin v0.4.0`

   **Pushing `main`/`v*` triggers the `pre-push` gate** (`pnpm check:all`, ~3 min)
   while git holds the SSH connection open. The `prepare` script
   (`scripts/setup-local-git.mjs`) sets an SSH keepalive (`core.sshCommand`) so
   the idle connection survives the gate. If a push ever dies with **SIGPIPE
   (exit 141)** right after "quality gate green — push allowed", the keepalive is
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

## Verification

1. Check About VMark dialog shows single version number
2. Run `vmark-mcp-server --version` shows same version
3. MCP Status dialog in Settings shows same version
