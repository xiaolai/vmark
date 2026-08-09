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
# - Scope: EVERY work item the plan declares is checked. Use `--phase=N` to
#   check one phase while later ones are still in flight.
#   (WI-AF1.4, 2026-08-09: this note used to claim the script "only checks WIs
#   from phases reported as 'complete' in the plan's Status header" and "skips
#   phases not yet started". No code ever parsed a Status header — the claim was
#   false in the file whose job is enforcing honesty about linkage. Deleted
#   rather than implemented: four plans in this repo write their status headers
#   four different ways, so parsing them would be a guess dressed as a gate,
#   and `--phase=N` already expresses the same intent explicitly.)
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
#
# AUTHORIZED CHANGE (2026-08-09) — §9 authorization granted by the maintainer.
# Plan: .claude/tdd-guardian/plan-20260809-followups.md, Phase 1. Reasons:
#
#   3. WI-AF1.2 — the test-header search saw only src/ and src-tauri/src/. This
#      repo has FOUR test roots: vitest.gates.config.ts owns scripts/ and
#      .claude/hooks/ (32 files). WI-16's only test lives in scripts/, so a
#      correctly linked work item reported NOT LINKED.
#   4. WI-AF1.3 — IDs were grepped from anywhere in the plan, so PROSE created
#      phantom work items: the 2026-08-03 plan quotes "WI-1.6 live-webview cap
#      enforced" inside WI-6's description, and the gate then demanded linkage
#      for an item that does not exist. IDs now come from DECLARATIONS only.
#      The ID grammar itself (WI_RE) is deliberately UNCHANGED — only the
#      context it is searched in narrows, which keeps this widening's blast
#      radius off the namespace the 2026-07-14 change fixed.
#   5. WI-AF1.5 — commit linkage accepted the ID anywhere in a message, so a
#      commit that merely DESCRIBED a work item vouched for it. Observed live:
#      this plan's own first commit explained the WI-16 defect, and the gate
#      immediately reported WI-16 linked. Linkage now requires the form §2
#      documents — the ID inside a parenthesised tag, `(WI-1.2)`.
#
# All three are pinned by scripts/check-wi-linkage.test.mjs, which landed first
# (WI-AF1.1) precisely so this widening could not repeat 2026-07-14's false green.

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

# Extract WI-IDs from the plan's DECLARATIONS (WI-AF1.3).
#
# The ID grammar is unchanged: the phase segment is alphanumeric so separate
# plans can namespace their work items apart (`WI-1.2` in one plan, `WI-S1.2` /
# `WI-SOC.2` / `WI-VC0.1` in another) without colliding. A numeric-only grammar
# would match zero WIs in such a plan.
#
# What changed is WHERE it is searched. Four declaration forms are in use across
# this repo's plans, and all four are accepted:
#
#   ## WI-1                        ATX heading, any level, optional bold
#   - **WI-0.1** title             bold list item, ID closed by **
#   **WI-1.2 — title**             bold standalone, ID followed by a dash
#   | WI-VC0.1 | title |           table row
#
# Everything else is prose. That distinction is the whole point: a plan's Risks
# section is full of lines like `- **WI-AF2.1 has unbounded cost.**`, which names
# a work item without declaring one, and the old any-match grep turned every
# such mention — including IDs belonging to OTHER plans — into a work item the
# gate then demanded linkage for.
#
# Fenced code blocks are skipped: a plan that shows an example declaration in a
# ``` block is documenting a form, not declaring an item.
WI_RE="WI-[A-Z0-9]+(\.[0-9]+)?[a-z]?"

extract_declared_ids() {
  awk -v wire="$WI_RE" '
    /^[ \t]*```/ { fence = !fence; next }
    fence { next }
    {
      decl = 0
      if ($0 ~ /^#+[ \t]+\*?\*?WI-/)      decl = 1   # ATX heading
      else if ($0 ~ /^\|[ \t]*WI-/)       decl = 1   # table row
      else if ($0 ~ /^([-*+][ \t]+)?\*\*WI-/) {      # bold list item / standalone
        rest = $0
        sub(/^([-*+][ \t]+)?\*\*/, "", rest)
        # A declaration closes the bold right after the ID, or separates the ID
        # from its title with a dash. `**WI-AF2.1 has unbounded cost.**` does
        # neither, and is prose.
        if (rest ~ "^" wire "\\*\\*") decl = 1
        else {
          tail = rest
          if (sub("^" wire "[ \t]+", "", tail) &&
              (index(tail, "—") == 1 || index(tail, "–") == 1 || index(tail, "- ") == 1))
            decl = 1
        }
      }
      if (!decl) next
      if (match($0, wire)) print substr($0, RSTART, RLENGTH)
    }
  ' "$1"
}

WIS=()
while IFS= read -r line; do
  [[ -n "$line" ]] || continue
  # --phase=N narrows to one phase; the ID must START with WI-<phase> followed
  # by a boundary, so --phase=1 selects WI-1 and WI-1.2 but never WI-12.
  if [[ -n "$PHASE_FILTER" ]]; then
    [[ "$line" =~ ^WI-${PHASE_FILTER}(\.[0-9]+)?[a-z]?$ ]] || continue
  fi
  WIS+=("$line")
done < <(extract_declared_ids "$PLAN" | sort -u)

PATTERN="$WI_RE"
[[ -n "$PHASE_FILTER" ]] && PATTERN="WI-${PHASE_FILTER}(\.[0-9]+)?[a-z]?"

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

# Commit linkage requires the TAG form §2 documents — the ID inside parentheses,
# `feat(scope): change (WI-AF1.2)` (WI-AF1.5). Collect the IDs from parenthesised
# groups only, so a message that merely mentions a work item in prose cannot
# vouch for it. Extracting groups first (rather than matching around each ID)
# handles every tag shape the history actually uses in one pass: `(WI-1)`,
# `(WI-1, WI-2, WI-3)`, and `(WI-AF3.3 … WI-3.7)`.
COMMIT_TAG_IDS=$(grep -o -E "\([^)]*WI-[^)]*\)" <<<"$COMMIT_LOG" \
  | grep -E -o "$WI_RE" | sort -u)

# Search test files for WI references in the first 30 lines.
# Convention: a test file's top-of-file comment cites the WI it covers.
#
# ALL FOUR test roots (WI-AF1.2). src/ and src-tauri/src/ are the app and Rust
# tiers; scripts/ and .claude/hooks/ are the GATES tier, owned by
# vitest.gates.config.ts and run by `pnpm test:gates` inside check:static. A
# gate script's only test lives there, so omitting it made every gate-only work
# item unlinkable — WI-16 was exactly that case.
#
# Extensions match vitest.shared.ts's TEST_EXTENSIONS; Rust test modules
# (`*.test.rs`, included via #[path]) carry the same headers and are a
# legitimate linkage source — a Rust-only WI could otherwise never link.
TEST_HEADERS=$( { find src -name "*.test.ts" -o -name "*.test.tsx"; \
                  find src-tauri/src -name "*.test.rs"; \
                  find scripts .claude/hooks \
                       \( -name "*.test.mjs" -o -name "*.test.js" \
                          -o -name "*.test.cjs" -o -name "*.test.ts" \) ; } 2>/dev/null \
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
  # -x (whole line): both blobs are one-ID-per-line sets, so an exact match is
  # what "this ID is present" means. Without it, WI-1 would match WI-AF1.2's line.
  grep -F -x -q -- "$wi" <<<"$COMMIT_TAG_IDS" && in_commit=1
  grep -F -x -q -- "$wi" <<<"$TEST_HEADERS" && in_test=1
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
