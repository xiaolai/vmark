#!/usr/bin/env bash
#
# check-cross-target.sh — compile-check the Rust backend for Windows from
# macOS/Linux, so cross-platform breakage is caught before a push instead
# of 10 minutes into CI.
#
# Why: local `cargo clippy`/`cargo test` only compile the HOST target, so
# cfg(target_os)-gated imports/re-exports/dead-code that only break on
# other platforms sail through every local gate. The v0.8.26 release push
# hit exactly this four times in a row (see commits 08c81d1e, 13b7572a,
# d30d69f3 and the one after): a cfg(macos) `use tauri::Manager` needed
# cross-platform, an unused macOS-only re-export, and unix-only test
# fixtures/helpers — three of the four were plain compile/lint errors this
# check catches. Runtime assertion differences still need CI.
#
# Target choice: x86_64-pc-windows-gnu (not msvc) because mingw-w64 gives
# a working C cross-toolchain via `brew install mingw-w64`, which `ring`'s
# build script needs; msvc requires cl.exe. Linux-gnu is NOT checked:
# Tauri's Linux deps (webkit2gtk & co.) need system libs via pkg-config
# that don't exist on macOS. Windows covers the overwhelming share of the
# cfg-divergence bugs (all four above manifested there).
#
# Soft-skip: if the toolchain isn't installed the script warns loudly and
# exits 0 — macOS is the primary platform (AGENTS.md) and a fresh clone
# must not be hard-blocked from pushing; CI remains the authoritative
# cross-platform gate.
#
# Setup (one-time):
#   rustup target add x86_64-pc-windows-gnu
#   brew install mingw-w64
#
# Run manually: pnpm check:cross

set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="x86_64-pc-windows-gnu"

if ! rustup target list --installed 2>/dev/null | grep -qx "$TARGET"; then
  cat >&2 <<MSG
⚠ check-cross-target: rust target $TARGET not installed — SKIPPING.
  Cross-platform Rust breakage will only surface in CI. To enable:
    rustup target add $TARGET && brew install mingw-w64
MSG
  exit 0
fi
if ! command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1; then
  cat >&2 <<MSG
⚠ check-cross-target: mingw-w64 C toolchain not found — SKIPPING.
  Cross-platform Rust breakage will only surface in CI. To enable:
    brew install mingw-w64
MSG
  exit 0
fi

# tauri-build validates that per-triple sidecar binaries exist. The real
# Windows sidecars are only produced by the release workflow; a zero-byte
# stub satisfies the existence check for compile-only purposes. The
# binaries/ directory contents are gitignored.
for sidecar in vmark-mcp-server; do
  stub="src-tauri/binaries/${sidecar}-${TARGET}.exe"
  [ -f "$stub" ] || touch "$stub"
done

echo "check-cross-target: cargo check --target $TARGET (all targets, -D warnings)…"
RUSTFLAGS="-D warnings" cargo check \
  --manifest-path src-tauri/Cargo.toml \
  --target "$TARGET" \
  --all-targets

echo "✅ check-cross-target: $TARGET compiles clean."
