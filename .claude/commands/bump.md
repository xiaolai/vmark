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

Display: `Current: {old} → New: {new}` and ask user to confirm.

## Phase 2: Update All 5 Files

All five files must be updated — see `.claude/rules/40-version-bump.md`.

| File | Field |
|------|-------|
| `package.json` | `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version` |
| `vmark-mcp-server/package.json` | `"version"` |
| `vmark-mcp-server/src/cli.ts` | `const VERSION` |

Use the Edit tool for each file — not sed.

## Phase 3: Verify

Read back all 5 files and confirm the version matches:

```bash
grep '"version"' package.json src-tauri/tauri.conf.json vmark-mcp-server/package.json
grep '^version' src-tauri/Cargo.toml
grep 'const VERSION' vmark-mcp-server/src/cli.ts
```

If any mismatch: fix before proceeding.

## Phase 4: Commit, Tag, Push

```bash
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml \
        vmark-mcp-server/package.json vmark-mcp-server/src/cli.ts
git commit -m "chore: bump version to {version}"
git tag v{version}
git push origin main --tags
```

Report done: `Bumped to {version}, tagged v{version}, pushed.`
