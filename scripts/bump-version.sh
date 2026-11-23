#!/bin/bash
# Bump version across all 5 files that must stay in sync, plus the derived
# src-tauri/Cargo.lock and the bundled third-party notices, then check that
# CHANGELOG.md has the release notes for the new version. See
# .claude/rules/40-version-bump.md for details.
#
# This only edits files. Landing the bump is a separate step and now needs a
# PR — `main` rejects direct pushes (60-ai-governance.md §10).

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/bump-version.sh <version>"
  echo "Example: ./scripts/bump-version.sh 2026.11.126"
  exit 1
fi

# Validate version format (YYYY.M.count, a SemVer shape the updater accepts).
# The month carries no leading zero: `semver` rejects `2026.01.126`.
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: Version must look like YYYY.M.count (e.g., 2026.11.126)"
  exit 1
fi

echo "Bumping version to $VERSION..."

# Main app files
sed -i '' 's/"version": "[^"]*"/"version": "'$VERSION'"/' package.json
sed -i '' 's/"version": "[^"]*"/"version": "'$VERSION'"/' src-tauri/tauri.conf.json
sed -i '' 's/^version = "[^"]*"/version = "'$VERSION'"/' src-tauri/Cargo.toml

# MCP server files
sed -i '' 's/"version": "[^"]*"/"version": "'$VERSION'"/' server/mcp/package.json
sed -i '' "s/const VERSION = '[^']*'/const VERSION = '$VERSION'/" server/mcp/src/cli.ts

# Derived lockfile: Cargo.lock carries the `vmark` package's own version, so it
# must move with Cargo.toml. Leaving it behind makes origin/main dirty and
# breaks `cargo build --locked` / `--frozen` — what CI and the release run.
# The hint quotes the WHOLE command: the crate manifest lives in src-tauri/, so a
# bare `cargo update -p vmark` from the repo root dies with "could not find
# `Cargo.toml`" — a failure message handing the reader a command that also fails
# is worse than no message. Braces are load-bearing: with a bare `||` only the
# FIRST echo is conditional and the second prints on every successful run.
cargo update -p vmark --manifest-path src-tauri/Cargo.toml >/dev/null 2>&1 || {
  echo "WARNING: could not sync src-tauri/Cargo.lock — run it manually:"
  echo "         cargo update -p vmark --manifest-path src-tauri/Cargo.toml"
}

# The bundled third-party notices follow the lockfiles. The release regenerates
# them before building, so a failure here only leaves the tracked copy behind.
node scripts/gen-third-party-licenses.mjs || {
  echo "WARNING: could not refresh the third-party notices — run it manually:"
  echo "         node scripts/gen-third-party-licenses.mjs   (needs cargo-about 0.8.2)"
}

echo ""
echo "Updated:"
grep '"version"' package.json src-tauri/tauri.conf.json server/mcp/package.json
grep '^version' src-tauri/Cargo.toml
grep 'const VERSION' server/mcp/src/cli.ts
git diff --stat src-tauri/Cargo.lock

# The release notes are this version's CHANGELOG.md section, and release.yml
# refuses a tag without one. Checked last so the version edits above are
# already in place to review; the bump is not done until this passes.
if ! node scripts/extract-changelog-section.mjs "$VERSION" > /dev/null; then
  echo ""
  echo "NOT DONE: write the ## [$VERSION] - YYYY-MM-DD section in CHANGELOG.md"
  echo "          (see .claude/rules/40-version-bump.md), then re-run this script."
  exit 1
fi

echo ""
echo "Done. Land it with a PR — main rejects direct pushes:"
echo "  git checkout -b bump-v$VERSION"
echo "  git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml \\"
echo "          src-tauri/Cargo.lock server/mcp/package.json server/mcp/src/cli.ts \\"
echo "          CHANGELOG.md src-tauri/resources/generated/THIRD_PARTY_LICENSES.txt"
echo "  git commit -m 'chore: bump version to $VERSION'"
echo "  git push -u origin bump-v$VERSION && gh pr create --fill && gh pr checks --watch"
echo "  gh pr merge --merge --delete-branch && git checkout main && git pull"
echo "  git tag v$VERSION && git push origin v$VERSION   # never --tags"
