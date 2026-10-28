#!/usr/bin/env bash
# shellcheck disable=SC2329  # usage and the phase/slice functions are called by name, indirectly
#
# Slice gate for the agent-edit-ledger journal (phase 1 ships as seven
# vertical slices, one PR each).
#
# Usage: bash scripts/check-al-slice.sh <1.1-1.7> [--root=<dir>] [--no-exec]
#
# Exit 0 when every assertion passes, 1 when any fails or is unverified,
# 64 on bad invocation. `--root` points the gate at another tree (the
# self-test, scripts/check-al-phase.test.mjs, uses fixture trees);
# `--no-exec` skips the assertions that RUN something and reports them
# UNVERIFIED, so a fast read is never mistaken for a pass.
#
# The assertions live in scripts/lib/al-slices.sh; the mechanics (tests found
# by header, then run) in scripts/lib/al-gate.sh. Self-contained: the plan is
# maintainer-local and never read. Run this plus the AGENTS.md gate row for
# whatever the slice touches.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  echo "Usage: $0 <slice> [--root=<dir>] [--no-exec]"
  echo "  1.1  Identity: connection UUID, principal, session label, McpWriteContext"
  echo "  1.2  Rust journal store: framing, hydration, reservations, pins, migration"
  echo "  1.3  document.write on the controlled-mutation protocol"
  echo "  1.4  transform / selection.set / apply_patch; observational save capture; editor collectors, certificates, budgets, deadline, IME"
  echo "  1.5  Read tracking per connection; real actor in coherence capture"
  echo "  1.6  Restore, uncommitted restore/discard, identity, GC collector"
  echo "  1.7  History UI, i18n, mcp-setup docs"
}

source "$SCRIPT_DIR/lib/al-gate.sh"
al_parse_args '^1\.[1-7]$' usage "$@"
cd "$ROOT" || exit 64
source "$SCRIPT_DIR/lib/dod-assertions.sh"
source "$SCRIPT_DIR/lib/al-slices.sh"

"al_slice_${AL_TARGET//./_}"
al_summary "Slice $AL_TARGET"
