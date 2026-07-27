#!/bin/bash
# Bump version across all 5 files that must stay in sync, plus the derived
# src-tauri/Cargo.lock. See .claude/rules/40-version-bump.md for details.
#
# This only edits files. Landing the bump is a separate step and now needs a
# PR — `main` rejects direct pushes (60-ai-governance.md §10).

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/bump-version.sh <version>"
  echo "Example: ./scripts/bump-version.sh 0.3.20"
  exit 1
fi

# Validate version format (basic semver check)
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: Version must be in semver format (e.g., 0.3.20)"
  exit 1
fi

echo "Bumping version to $VERSION..."

# Main app files
sed -i '' 's/"version": "[^"]*"/"version": "'$VERSION'"/' package.json
sed -i '' 's/"version": "[^"]*"/"version": "'$VERSION'"/' src-tauri/tauri.conf.json
sed -i '' 's/^version = "[^"]*"/version = "'$VERSION'"/' src-tauri/Cargo.toml

# MCP server files
sed -i '' 's/"version": "[^"]*"/"version": "'$VERSION'"/' vmark-mcp-server/package.json
sed -i '' "s/const VERSION = '[^']*'/const VERSION = '$VERSION'/" vmark-mcp-server/src/cli.ts

# Derived lockfile: Cargo.lock carries the `vmark` package's own version, so it
# must move with Cargo.toml. Leaving it behind makes origin/main dirty and
# breaks `cargo build --locked` / `--frozen` — what CI and the release run.
cargo update -p vmark --manifest-path src-tauri/Cargo.toml >/dev/null 2>&1 ||
  echo "WARNING: could not sync src-tauri/Cargo.lock — run cargo update -p vmark manually"

echo ""
echo "Updated:"
grep '"version"' package.json src-tauri/tauri.conf.json vmark-mcp-server/package.json
grep '^version' src-tauri/Cargo.toml
grep 'const VERSION' vmark-mcp-server/src/cli.ts
git diff --stat src-tauri/Cargo.lock
echo ""
echo "Done. Land it with a PR — main rejects direct pushes:"
echo "  git checkout -b bump-v$VERSION"
echo "  git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml \\"
echo "          src-tauri/Cargo.lock vmark-mcp-server/package.json vmark-mcp-server/src/cli.ts"
echo "  git commit -m 'chore: bump version to $VERSION'"
echo "  git push -u origin bump-v$VERSION && gh pr create --fill && gh pr checks --watch"
echo "  gh pr merge --merge --delete-branch && git checkout main && git pull"
echo "  git tag v$VERSION && git push origin v$VERSION   # never --tags"
