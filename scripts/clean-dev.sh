#!/usr/bin/env bash
#
# Reclaim dev-box disk. Local housekeeping only — never wire this into CI,
# whose runners are ephemeral and start with empty caches.
#
# Usage: scripts/clean-dev.sh [1|2|3] [--include-bundle]
#
#   1  (default)  src-tauri/target, Vite caches, generated schemas.
#                 Project-local; no network on the next build.
#   2             also ~/.cargo/registry/{cache,src} and ~/.cargo/git/{db,checkouts}.
#                 Machine-wide: the next build in ANY Rust project re-downloads
#                 its crate tarballs. The registry INDEX is kept deliberately,
#                 so the crates.io index is not re-fetched.
#   3             also `pnpm store prune` (safe: only blobs no node_modules references).
#
# Two behaviours are here because they were learned the hard way:
#
#   - `target/release/bundle/` is REFUSED unless --include-bundle. A signed and
#     notarized but not-yet-uploaded artifact is unrecoverable without
#     re-notarizing. `cargo clean` cannot spare a subdirectory, so the only
#     honest options are "stop and ask" or "delete it silently"; this stops.
#   - Exit codes are captured DIRECTLY, never after a pipe. A `cargo clean |
#     tail` reports tail's status, which is how a pinned-toolchain failure once
#     reported success while 16 GB sat untouched.
#
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$PWD"

TIER=1
INCLUDE_BUNDLE=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    1|2|3) TIER="$arg" ;;
    --include-bundle) INCLUDE_BUNDLE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "clean-dev: unknown argument '$arg'" >&2; exit 2 ;;
  esac
done

# `--dry-run` exists so the bundle guard below is testable without a path that
# deletes anything. A guard whose only proof is "we read the code" is the kind
# that quietly stops working.
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY-RUN: $*"
  else
    "$@"
  fi
}

sizes() {
  echo "=== $1 ==="
  du -sh src-tauri/target node_modules node_modules/.vite dist 2>/dev/null
  du -sh ~/.cargo/registry ~/.cargo/git 2>/dev/null
  df -h /System/Volumes/Data 2>/dev/null | tail -1 || df -h . | tail -1
  echo
}

BUNDLE="src-tauri/target/release/bundle"
if [ -d "$BUNDLE" ] && [ "$INCLUDE_BUNDLE" -eq 0 ]; then
  cat >&2 <<EOF
clean-dev: refusing — $BUNDLE exists.

  It holds locally built release artifacts. If any were code-signed and
  notarized but not yet uploaded, deleting them costs a re-sign and re-notarize.
  \`cargo clean\` removes the whole target tree, so this cannot be spared
  selectively.

  Confirm the artifacts are uploaded (\`gh release view v<version>\`), then:

    scripts/clean-dev.sh $TIER --include-bundle
EOF
  exit 2
fi

sizes BEFORE
START=$SECONDS

echo "--> cargo clean (src-tauri)"
run cargo clean --manifest-path src-tauri/Cargo.toml
RC=$?
if [ "$RC" -ne 0 ]; then
  echo "clean-dev: cargo clean failed (exit $RC) — target/ NOT removed." >&2
  echo "  A pinned toolchain in rust-toolchain.toml with no cargo component is" >&2
  echo "  the usual cause; retry with an installed toolchain, e.g. 'cargo +stable clean'." >&2
  exit "$RC"
fi

echo "--> vite caches and generated schemas"
run rm -rf node_modules/.vite dist src-tauri/gen/schemas

if [ "$TIER" -ge 2 ]; then
  echo "--> cargo global caches (keeping the registry index)"
  run rm -rf ~/.cargo/registry/cache ~/.cargo/registry/src
  run rm -rf ~/.cargo/git/db ~/.cargo/git/checkouts
fi

if [ "$TIER" -ge 3 ]; then
  echo "--> pnpm store prune"
  run pnpm store prune || echo "clean-dev: pnpm store prune failed (non-fatal)" >&2
fi

echo
[ "$DRY_RUN" -eq 0 ] && sizes AFTER

# A target/ still present means a step silently did nothing — green is not
# evidence that anything happened.
if [ "$DRY_RUN" -eq 0 ] && [ -d src-tauri/target ]; then
  echo "clean-dev: WARNING — src-tauri/target still exists after cargo clean." >&2
  exit 1
fi

echo "clean-dev: tier $TIER complete in $((SECONDS - START))s. Next build is a cold one."
