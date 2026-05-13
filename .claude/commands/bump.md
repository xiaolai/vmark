---
description: Bump version across all 5 files, commit, tag, and push
argument-hint: "[version | patch | minor | major]"
---

# Version Bump

Bump the version number across all 5 required files, commit, tag, and push.

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

## Phase 4: Verify

Read back all 5 files and confirm the version matches:

```bash
grep '"version"' package.json src-tauri/tauri.conf.json vmark-mcp-server/package.json
grep '^version' src-tauri/Cargo.toml
grep 'const VERSION' vmark-mcp-server/src/cli.ts
```

If any mismatch: fix before proceeding.

## Phase 5: Commit, Tag, Push

```bash
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml \
        vmark-mcp-server/package.json vmark-mcp-server/src/cli.ts
git commit -m "chore: bump version to {version}"
git tag v{version}
git push origin main
git push origin v{version}
```

**Never use `git push --tags`** — it re-pushes stale local tags that the
release workflow's `cleanup-old-releases` step has already deleted from
origin, each one re-triggering a release run. Push the single new tag
only. See `.claude/rules/40-version-bump.md` for the full incident
context.

Report done: `Bumped to {version}, tagged v{version}, pushed.`
