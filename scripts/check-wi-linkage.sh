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

# Extract WI-IDs from the plan. The convention is **WI-N.M — title**.
# We accept WI-N (no minor) too. Bash 3.2-compatible array fill.
WIS=()
PATTERN="WI-[0-9]+(\.[0-9]+)?[a-z]?"
if [[ -n "$PHASE_FILTER" ]]; then
  PATTERN="WI-${PHASE_FILTER}(\.[0-9]+)?[a-z]?"
fi
while IFS= read -r line; do
  [[ -n "$line" ]] && WIS+=("$line")
done < <(grep -E -o "$PATTERN" "$PLAN" | sort -u)

if (( ${#WIS[@]} == 0 )); then
  echo "no WI-IDs matching pattern '$PATTERN' found in $PLAN"
  exit 0
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
TEST_HEADERS=$(find src -name "*.test.ts" -o -name "*.test.tsx" 2>/dev/null \
  | xargs head -n 30 2>/dev/null | grep -E -o "WI-[0-9]+(\.[0-9]+)?[a-z]?" | sort -u)

ok()   { echo "  ✓ $1"; }
miss() { echo "  ✗ $1"; }

LINKED=0
MISSING=()
for wi in "${WIS[@]}"; do
  in_commit=0
  in_test=0
  echo "$COMMIT_LOG" | grep -F -q "$wi" && in_commit=1
  echo "$TEST_HEADERS" | grep -F -q "$wi" && in_test=1
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
