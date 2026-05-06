#!/usr/bin/env bash
# ADR-12 / WI-1B.4 — verify Rust SUPPORTED_EXTENSIONS matches the TS
# format-registry's getSupportedExtensions() output.
#
# Delegates to a vitest test (src/lib/formats/extSync.test.ts) which
# parses lib.rs, calls getSupportedExtensions() at runtime, and asserts
# equality. This runs in the same dev-tool environment as the rest of
# the test suite, so vite path aliases and TS resolution work.
#
# Exit 0: lists agree.
# Exit 1: drift detected; vitest output is printed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if pnpm exec vitest run src/lib/formats/extSync.test.ts; then
  echo "✓ Rust ↔ TS extension lists match"
  exit 0
fi

echo "" >&2
echo "✗ Rust ↔ TS extension drift detected — see vitest output above." >&2
echo "" >&2
echo "Rust source: src-tauri/src/lib.rs (SUPPORTED_EXTENSIONS const)" >&2
echo "TS source:   src/lib/formats/adapters/{markdown,txt,stubs}" >&2
echo "" >&2
echo "Per ADR-12, the two lists are manually mirrored; this script is the CI guard." >&2
exit 1
