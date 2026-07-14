#!/usr/bin/env bash
#
# WI-ID linkage check.
#
# Mechanism: a plan file at dev-docs/plans/*.md defines work items as headings
# of the form `**WI-N.M — title**`. Once a WI is implemented, the implementer
# must mention its ID at least once in:
#   (a) a commit message on the current branch, OR
#   (b) a top-of-file comment in the test file that covers it
#
# This script scans the plan, extracts every WI-ID, and verifies the linkage.
# Drift detection: if a WI-ID is missing both, you've shipped without trace.
#
# Usage:
#   bash scripts/check-wi-linkage.sh <plan-file> [--phase=N]
# Example:
#   bash scripts/check-wi-linkage.sh dev-docs/plans/20260504-github-actions-workflow-viewer.md --phase=1
#
# Without --phase, every WI in the plan is checked. With --phase=N, only WIs
# whose ID matches WI-N.* are checked — useful per-phase gates, since later
# phases will be unlinked until they start.
#
# Exit codes:
#   0  every checked WI-ID found in either commits or tests
#   1  one or more WI-IDs missing
#  64  bad invocation
#
# Notes:
# - Phase numbering: only checks WIs from phases reported as "complete" in the
#   plan's Status header. Skips phases not yet started.
# - "Current branch" means commits since the merge-base with `main` — keeps
#   feature branches honest without forcing every WI to land on main.
#
# AUTHORIZED CHANGE (2026-07-14) — .claude/rules/60-ai-governance.md §9 forbids
# changing this script's regex without explicit user authorization. Authorization
# was granted, and the reason is recorded here as §9 requires:
#
#   1. The WI-ID regex was numeric-only (`WI-N.M`). The browser-shell plan uses an
#      alphanumeric phase segment (`WI-S1.3`, `WI-SOC.2`) precisely so its work
#      items cannot collide with the embedded-browser plan's `WI-1.x`. The old
#      regex matched ZERO work items in that plan...
#   2. ...and the zero-match branch exited 0. Together those produced a FALSE
#      GREEN: a plan whose namespace this script cannot parse silently "passed".
#      (Found by the Codex cross-model review of the browser-shell plan, D5#4.)
#
# The fix widens the grammar and makes the zero-match case FAIL CLOSED. A gate
# that cannot see any work items must never report success.

set -uo pipefail

cd "$(dirname "$0")/.."

PLAN=""
PHASE_FILTER=""
for arg in "$@"; do
  case "$arg" in
    --phase=*) PHASE_FILTER="${arg#--phase=}" ;;
    -*) echo "unknown flag: $arg"; exit 64 ;;
    *) PLAN="$arg" ;;
  esac
done

if [[ -z "$PLAN" ]]; then
  echo "Usage: $0 <plan-file> [--phase=N]"
  exit 64
fi
if [[ ! -f "$PLAN" ]]; then
  echo "plan file not found: $PLAN"
  exit 64
fi

# Extract WI-IDs from the plan. The convention is **WI-<phase>.<n> — title**.
# The phase segment is alphanumeric so separate plans can namespace their work
# items apart (`WI-1.2` in one plan, `WI-S1.2` / `WI-SOC.2` in another) without
# colliding. A numeric-only grammar here would match zero WIs in such a plan.
WIS=()
WI_RE="WI-[A-Z0-9]+(\.[0-9]+)?[a-z]?"
PATTERN="$WI_RE"
if [[ -n "$PHASE_FILTER" ]]; then
  PATTERN="WI-${PHASE_FILTER}(\.[0-9]+)?[a-z]?"
fi
while IFS= read -r line; do
  [[ -n "$line" ]] && WIS+=("$line")
done < <(grep -E -o "$PATTERN" "$PLAN" | sort -u)

# FAIL CLOSED. A gate that can see no work items must not report success — that
# is exactly how an unparseable namespace turns into a silent pass.
if (( ${#WIS[@]} == 0 )); then
  echo "✗ no WI-IDs matching '$PATTERN' found in $PLAN"
  echo
  echo "  A plan with zero parseable work items cannot be verified, so this gate"
  echo "  fails rather than passing vacuously. Either the plan has no WIs, or it"
  echo "  uses a namespace this script's grammar (WI_RE) does not accept."
  exit 1
fi

# Determine merge-base. If we're on main, check against the previous tag.
BASE=""
if git rev-parse --abbrev-ref HEAD >/dev/null 2>&1; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  if [[ "$BRANCH" == "main" || "$BRANCH" == "master" ]]; then
    BASE=$(git describe --tags --abbrev=0 2>/dev/null || git rev-parse HEAD~50 2>/dev/null || echo "")
  else
    BASE=$(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null || echo "")
  fi
fi
RANGE="$BASE..HEAD"
[[ -z "$BASE" ]] && RANGE="HEAD"

# Build commit-message blob for the range.
COMMIT_LOG=$(git log --pretty=format:"%s%n%b" "$RANGE" 2>/dev/null || echo "")

# Search test files for WI references in the first 30 lines.
# Convention: a test file's top-of-file comment cites the WI it covers.
# Rust test modules (`*.test.rs`, included via #[path]) carry the same headers and
# are a legitimate linkage source — a Rust-only WI could otherwise never link.
TEST_HEADERS=$( { find src -name "*.test.ts" -o -name "*.test.tsx"; \
                  find src-tauri/src -name "*.test.rs"; } 2>/dev/null \
  | xargs head -n 30 2>/dev/null | grep -E -o "$WI_RE" | sort -u)

ok()   { echo "  ✓ $1"; }
miss() { echo "  ✗ $1"; }

LINKED=0
MISSING=()
for wi in "${WIS[@]}"; do
  in_commit=0
  in_test=0
  # Herestrings, NOT `echo ... | grep`. Under `set -o pipefail`, `grep -q` exits the
  # instant it matches, which closes the pipe and hands `echo` a SIGPIPE (141) — and
  # pipefail then reports the PIPELINE as failed even though grep found the match. It
  # only bites once the log is long enough that echo is still writing when grep bails,
  # so commit-based linkage worked until commit messages grew, then quietly stopped.
  # It failed closed (reporting a linked WI as unlinked), which is the safe direction,
  # but a gate that lies in either direction is a gate you stop trusting.
  grep -F -q -- "$wi" <<<"$COMMIT_LOG" && in_commit=1
  grep -F -q -- "$wi" <<<"$TEST_HEADERS" && in_test=1
  if (( in_commit + in_test > 0 )); then
    LINKED=$((LINKED+1))
    src="commit"
    (( in_test == 1 )) && (( in_commit == 0 )) && src="test"
    (( in_test == 1 )) && (( in_commit == 1 )) && src="commit+test"
    ok "$wi linked ($src)"
  else
    MISSING+=("$wi")
    miss "$wi NOT linked (no commit, no test header)"
  fi
done

echo
echo "─────────────────────────────────────────────"
echo "Plan: $PLAN"
echo "WIs found: ${#WIS[@]}    linked: $LINKED    unlinked: ${#MISSING[@]}"
echo "Commit range: $RANGE"

if (( ${#MISSING[@]} > 0 )); then
  echo
  echo "Unlinked WIs (each must appear in a commit message OR test-file header):"
  for w in "${MISSING[@]}"; do echo "  • $w"; done
  echo
  echo "Two ways to link a WI:"
  echo "  • Commit message:  feat(gha): wire parser orchestrator (WI-1.2)"
  echo "  • Test header:     // WI-1.2 — parser orchestrator dispatch tests"
  exit 1
fi
exit 0
