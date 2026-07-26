#!/usr/bin/env bash
#
# Self-test for `check-browser-e2e-phase.sh` — proves each gate assertion actually
# DETECTS the thing it claims to.
#
# Usage: bash scripts/check-browser-e2e-phase.selftest.sh
#
# WHY THIS EXISTS
#
# The project standard for an E2E journey is that it must be *seen to fail* before
# it counts as coverage. That standard was never applied to the gates themselves,
# and they are mostly shell greps — the weakest assertion in the codebase.
#
# The cost was not hypothetical. Two separate gate bugs shipped:
#
#   1. Phase 2 grepped `surface.rs` for the generation parameter, but that file
#      held only the non-macOS STUB. It would have passed on a stub-only signature
#      while the real macOS `eval` had none. Found by ACCIDENT, when an unrelated
#      file split moved the stub out and the grep broke.
#   2. Phase 1 grepped `ai_policy.rs` for "local" and "internal" to prove the
#      LAN-suffix block existed. `localhost` contains "local";
#      `metadata.google.internal` contains "internal". Deleting the entire
#      `lan_facing_suffix` function left two of three assertions GREEN.
#
# A gate that passes when the work is undone is worse than no gate: it converts an
# unknown into a confident, false "verified". So each mutation below deletes or
# breaks real production code and asserts the gate goes RED. An assertion that
# survives its own mutation is reported as UNPROVEN — not as a pass.
#
# Every mutation is applied to a backup-and-restore pair, including on failure.
#
# Governance: .claude/rules/60-ai-governance.md §3 (a phase gate must be
# machine-checkable) — and, by extension, checkable that it checks.

set -uo pipefail
cd "$(dirname "$0")/.."

GATE="scripts/check-browser-e2e-phase.sh"
FAILED=0
TMP="$(mktemp -d)"

# [Audit High] Restore MUST survive interruption. The trap used to remove $TMP
# only, and restoration happened inline afterwards — so a Ctrl-C while the gate was
# running (which takes minutes: it compiles and runs the Rust suite) deleted the
# backup and left PRODUCTION CODE MUTATED. That is not hypothetical: an auditor
# observed the workspace mutated by an interrupted run of this very script.
#
# The active target is tracked globally and restored FIRST, on EXIT/INT/TERM.
ACTIVE_FILE=""
restore_and_clean() {
  if [ -n "$ACTIVE_FILE" ] && [ -f "$TMP/backup" ]; then
    cp "$TMP/backup" "$ACTIVE_FILE"
    printf "\n  restored %s after interruption\n" "$ACTIVE_FILE" >&2
  fi
  rm -rf "$TMP"
}
trap restore_and_clean EXIT INT TERM

pass() { printf "  \033[32mDETECTS\033[0m  %s\n" "$1"; }
fail() { printf "  \033[31mBLIND  \033[0m  %s\n" "$1"; FAILED=1; }

# mutate <file> <python-expression-file> <phase> <label>
#
# Applies a mutation via a python snippet, runs the gate for <phase>, and requires
# a NON-ZERO exit. Restores the file unconditionally.
mutate() {
  local file="$1" snippet="$2" phase="$3" label="$4"
  cp "$file" "$TMP/backup"
  python3 - "$file" <<PY
import sys, re
p = sys.argv[1]
s = open(p).read()
$snippet
open(p, 'w').write(s)
PY
  if bash "$GATE" "$phase" >/dev/null 2>&1; then
    fail "$label"
  else
    pass "$label"
  fi
  cp "$TMP/backup" "$file"
}

echo "Self-testing the browser phase gate — each mutation MUST turn it red."
echo

# ---------------------------------------------------------------- phase 0
echo "Phase 0 — documentation reconciliation"
mutate vmark-mcp-server/src/tools/browser.ts \
  "s = s.replace('PLATFORM: macOS only', 'PLATFORM: everywhere')" \
  0 "WI-0.5 notices the macOS-only disclosure disappearing"
mutate vmark-mcp-server/src/tools/browser.ts \
  "s = s.replace('localStorage AND cookies', 'localStorage')" \
  0 "WI-0.1 notices the capture-scope claim being narrowed"
mutate dev-docs/grills/ai-browser/limitations.md \
  "s = s.replace('NAMED profile', 'some profile')" \
  0 "WI-0.4 notices the persistent-profile case being dropped"

# ---------------------------------------------------------------- phase 1
echo
echo "Phase 1 — authorization input layer"
mutate src-tauri/src/browser/ai_policy.rs \
  "s = re.sub(r'\n/// LAN-facing name suffixes \(WI-1\.7\)\..*?\n\}\n', '\n', s, flags=re.S); s = s.replace('        || lan_facing_suffix(host)', '')" \
  1 "WI-1.7 notices lan_facing_suffix being deleted outright"
mutate src-tauri/src/browser/mint.rs \
  "s = s.replace('if !origin_guard::is_origin_pattern(&g.origin_pattern) {', 'if false {')" \
  1 "WI-1.6 notices grant-pattern validation being disabled"
mutate src-tauri/src/browser/mint.rs \
  "s = s.replace('current.clear();', '/* no clear */')" \
  1 "WI-1.6 notices the fail-CLOSED direction being reversed"
mutate src-tauri/src/browser/mint.rs \
  "s = s.replace('(role, name) => Err(format!(', '(_role, _name) => Ok(None).map_err(|_: ()| format!(')" \
  1 "WI-1.1 notices a half-specified target being accepted"

# ---------------------------------------------------------------- phase 2
echo
echo "Phase 2 — the eval race"
mutate src-tauri/src/browser/authorize.rs \
  "s = s.replace('    if !command_still_fresh(state, tab_id, generation) {\n        return Err(format!(\n            \"stale command: tab \'{tab_id}\' navigated or closed before the script could run\"\n        ));\n    }', '')" \
  2 "WI-2.1 notices the in-dispatch freshness check being deleted"
mutate src-tauri/src/browser/surface_macos.rs \
  "s = s.replace('expected_generation', 'unused_generation')" \
  2 "WI-2.1 notices the macOS eval losing its generation parameter"

# ---------------------------------------------------------------- phase 3
echo
echo "Phase 3 — harness capability"
mutate e2e/run-journeys.mjs \
  "s = s.replace('const platforms = journey.platforms;', 'const platforms = undefined;').replace('platforms', 'PLATFORMS_REMOVED')" \
  3 "WI-3.0 notices the runner's platform handling being removed"

# ---------------------------------------------------------------- phase 6
echo
echo "Phase 6 — the coverage contract"
mutate dev-docs/grills/ai-browser/e2e-checklist.md \
  "s = s.replace('[AUTOMATED', '[was-automated')" \
  6 "WI-6.2 notices automated-row markers disappearing"
mutate dev-docs/e2e-browser-matrix.md \
  "s = s.replace('local pre-release gate', 'TBD')" \
  6 "WI-6.3 notices the CI decision being un-decided"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "Gate self-test: PASS — every assertion detected its mutation."
else
  echo "Gate self-test: FAIL — a BLIND assertion passes while the work it guards is undone."
  echo "Fix the assertion (prefer running a named test over grepping for text)."
fi
exit "$FAILED"
