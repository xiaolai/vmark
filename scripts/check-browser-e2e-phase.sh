#!/usr/bin/env bash
#
# DoD checker for the Browser Hardening + E2E Verification plan.
# Plan: dev-docs/plans/20260726-browser-hardening-and-e2e.md
#
# NOT to be confused with `scripts/check-browser-phase.sh`, which gates the
# earlier Embedded Browser / Site Plugins plan (20260712) and has its own,
# differently-numbered phases. Two plans touch the same subsystem; each keeps
# its own gate rather than overloading one script with colliding phase numbers.
#
# Usage: bash scripts/check-browser-e2e-phase.sh <0..6>
#
# Exit codes:
#   0  every assertion for the phase passed
#   1  one or more assertions failed
#   2  bad usage
#
# Governance: .claude/rules/60-ai-governance.md §3 — a phase gate must be
# machine-checkable. Two rules this script honours:
#
#   1. Phase 0 is BIDIRECTIONAL. A documentation fix is only done when the
#      stale claim is gone AND the corrected claim is stated. Asserting only
#      the absence would pass for a doc that says nothing at all — which is how
#      the drift being fixed here survived four releases.
#   2. A gate asserts BEHAVIOUR where it can. "A file exists" proves nothing
#      about whether it works, so test-bearing phases run the tests.

set -uo pipefail
cd "$(dirname "$0")/.."

PHASE="${1:-}"
FAILED=0

pass() { printf "  \033[32mPASS\033[0m  %s\n" "$1"; }
fail() { printf "  \033[31mFAIL\033[0m  %s\n" "$1"; FAILED=1; }

# Assert a regex is ABSENT from a file (stale claim removed).
absent() {
  local file="$1" pattern="$2" label="$3"
  if [ ! -f "$file" ]; then fail "$label — missing file: $file"; return; fi
  if grep -qiE "$pattern" "$file"; then
    fail "$label — stale text still present in $file"
  else
    pass "$label"
  fi
}

# Assert a regex is PRESENT in a file (corrected claim stated).
present() {
  local file="$1" pattern="$2" label="$3"
  if [ ! -f "$file" ]; then fail "$label — missing file: $file"; return; fi
  if grep -qiE "$pattern" "$file"; then
    pass "$label"
  else
    fail "$label — expected text not found in $file"
  fi
}

phase0() {
  echo "Phase 0 — documentation reconciled with shipped reality"
  # Stale claims gone (WI-0.1 / 0.2 / 0.3 / 0.4)...
  absent vmark-mcp-server/src/tools/browser.ts \
    "cookie capture is not yet implemented" "WI-0.1 MCP tool: false cookie claim removed"
  absent src-tauri/src/browser/session_commands.rs \
    "remaining NATIVE piece" "WI-0.3 Rust module doc: false cookie claim removed"
  absent website/guide/browser.md \
    "are the remaining pieces" "WI-0.2 guide: stale warning removed"
  absent dev-docs/grills/ai-browser/limitations.md \
    "all AI approvals are transient" "WI-0.4 limitations: blanket transience claim split"

  # ...and the corrected claims actually stated (the half that stops a doc
  # passing by saying nothing).
  present vmark-mcp-server/src/tools/browser.ts \
    "localStorage AND cookies" "WI-0.1 MCP tool: states real capture scope"
  present src-tauri/src/browser/session_commands.rs \
    "WKHTTPCookieStore" "WI-0.3 Rust module doc: states real capture scope"
  present website/guide/browser.md \
    "domain-scoped" "WI-0.2 guide: states real capture scope"
  present dev-docs/grills/ai-browser/limitations.md \
    "NAMED profile" "WI-0.4 limitations: names the persistent case"

  # WI-0.5: the AI's contract must disclose the platform limit.
  present vmark-mcp-server/src/tools/browser.ts \
    "PLATFORM: macOS only" "WI-0.5 MCP tool: declares macOS-only"

  # The sidecar description is a shipped string; it must still compile+typecheck.
  echo "  … typechecking the sidecar"
  if (cd vmark-mcp-server && pnpm exec tsc --noEmit >/dev/null 2>&1); then
    pass "sidecar typechecks"
  else
    fail "sidecar tsc FAILED"
  fi
}

phase1() {
  echo "Phase 1 — regression net for the command layer"
  # The command layer's decisions live in `mint.rs` (authorization INPUTS), extracted
  # from `commands_auth.rs` for the same reason `authorize.rs` was: a
  # `#[tauri::command]` takes `State<'_, _>` and cannot be unit-tested without a Tauri
  # harness, which is cfg-gated off Windows entirely. The DoD is "these decisions are
  # tested", not "a file with a particular name exists".
  if [ -f src-tauri/src/browser/mint.test.rs ]; then
    pass "WI-1.x mint.test.rs exists"
  else
    fail "WI-1.x mint.test.rs missing"
  fi
  present src-tauri/src/browser/mint.rs "mod tests" "WI-1.x mint.rs wires its test module"

  # ...and the commands must actually DELEGATE to it, or the tested logic is a
  # second copy that the shipping path never runs.
  for fn_pair in "browser_set_grants:set_standing_grants" \
                 "browser_add_one_shot:mint_one_shot" \
                 "browser_ai_attach:attach_ai_tab"; do
    cmd="${fn_pair%%:*}"; delegate="${fn_pair##*:}"
    if awk "/pub async fn $cmd/,/^}/" src-tauri/src/browser/commands_auth.rs \
        | grep -q "$delegate"; then
      pass "WI-1.x $cmd delegates to $delegate"
    else
      fail "WI-1.x $cmd does not delegate to $delegate — tested logic is not the shipping path"
    fi
  done

  # WI-1.6: standing grants validated the way one-shots already are.
  if awk '/pub\(crate\) fn set_standing_grants/,/^}/' src-tauri/src/browser/mint.rs \
      | grep -q "is_origin_pattern"; then
    pass "WI-1.6 standing grants validate origin patterns"
  else
    fail "WI-1.6 standing grants still stored unvalidated (inert)"
  fi

  # WI-1.7: LAN-facing suffixes blocked for AI navigation.
  for name in "internal" "local" "home.arpa"; do
    if grep -qF "$name" src-tauri/src/browser/ai_policy.rs; then
      pass "WI-1.7 blocked_hostname covers .$name"
    else
      fail "WI-1.7 blocked_hostname missing .$name"
    fi
  done

  echo "  … running browser unit tests (no root workspace — manifest path required)"
  if cargo test --manifest-path src-tauri/Cargo.toml browser:: --quiet >/dev/null 2>&1; then
    pass "cargo test browser:: green"
  else
    fail "cargo test browser:: RED"
  fi
}

phase2() {
  echo "Phase 2 — browser_eval residual race resolved"
  if grep -rqF "tracked as a follow-up" src-tauri/src/browser/; then
    fail "WI-2.3 'tracked as a follow-up' still present — race neither fixed nor accepted"
  else
    pass "WI-2.3 no orphaned follow-up claim in browser/"
  fi
  if grep -qE "expected_generation" src-tauri/src/browser/surface.rs; then
    pass "WI-2.1 surface::eval takes an expected generation"
  else
    fail "WI-2.1 surface::eval still has no generation parameter"
  fi
  present src-tauri/src/browser/surface_macos.rs \
    "no lock is held across|MUST NOT hold|lock .* across run-loop" \
    "WI-2.2 lock-ordering rule stated in the native module"
  echo "  … running browser unit tests"
  if cargo test --manifest-path src-tauri/Cargo.toml browser:: --quiet >/dev/null 2>&1; then
    pass "cargo test browser:: green"
  else
    fail "cargo test browser:: RED"
  fi
}

phase3() {
  echo "Phase 3 — E2E harness capability"
  for m in fixtureServer vmarkMcp browserApproval browser; do
    if [ -f "e2e/lib/$m.mjs" ]; then pass "WI-3.x e2e/lib/$m.mjs"; else fail "WI-3.x e2e/lib/$m.mjs missing"; fi
  done
  # WI-3.0: platform-aware skips, so a macOS-only journey is not read as lost coverage.
  if grep -q "platforms" e2e/run-journeys.mjs; then
    pass "WI-3.0 runner honours a journey 'platforms' field"
  else
    fail "WI-3.0 runner has no 'platforms' field — macOS-only journeys would fail the suite off-macOS"
  fi
  # ADR-BR1: rebuild, don't merely locate, the sidecar.
  if grep -qE "build:sidecar|buildSidecar|tsc" e2e/lib/vmarkMcp.mjs 2>/dev/null; then
    pass "ADR-BR1 harness rebuilds the sidecar from the working tree"
  else
    fail "ADR-BR1 harness does not rebuild the sidecar — would silently test a stale dist/"
  fi
  # The fixture server must ship oracles, not just pages.
  if grep -qE "count|hits" e2e/lib/fixtureServer.mjs 2>/dev/null; then
    pass "ADR-BR3 fixture server exposes request counters"
  else
    fail "ADR-BR3 fixture server has no request counters — SSRF/act oracles would be unfalsifiable"
  fi
}

phase4() {
  echo "Phase 4 — browser UI E2E (Tauri bridge)"
  local n
  n=$(ls e2e/journeys/ 2>/dev/null \
      | grep -cE "browser-(tab-lifecycle|omnibox|chrome|occlusion|approval-dialog|no-bridge)")
  if [ "$n" -ge 6 ]; then
    pass "WI-4.x six UI journeys present ($n)"
  else
    fail "WI-4.x expected 6 UI journeys, found $n"
  fi
}

phase5() {
  echo "Phase 5 — browser automation E2E (sidecar)"
  local n
  n=$(ls e2e/journeys/ 2>/dev/null \
      | grep -cE "browser-(disabled|open-read-act|ssrf|session-roundtrip|approval-deny|approval-allow-once|one-shot-scoping|approval-invalidation)")
  if [ "$n" -ge 8 ]; then
    pass "WI-5.x eight automation journeys present ($n)"
  else
    fail "WI-5.x expected 8 automation journeys, found $n"
  fi
}

phase6() {
  echo "Phase 6 — gate wired"
  if [ -f dev-docs/e2e-browser-matrix.md ]; then
    pass "WI-6.1 e2e-browser-matrix.md exists"
  else
    fail "WI-6.1 e2e-browser-matrix.md missing"
  fi
  # The Tier-0 matrix's contract is document corruption only; browser rows must
  # NOT land there (it declares AI surfaces a separate lane).
  if grep -qiE "^\| I[0-9]+ \|.*browser" dev-docs/e2e-tier0-matrix.md; then
    fail "WI-6.1 browser rows added to the Tier-0 matrix — violates its stated scope"
  else
    pass "WI-6.1 Tier-0 matrix scope preserved"
  fi
  # WI-6.2 — automated rows marked in the manual checklist, so a reader can tell
  # which lines still need a human. This was MISSED on the first pass: the gate
  # asserted only WI-6.1 and WI-6.3 and therefore reported Phase 6 PASS while two
  # of its four work items were untouched. A phase gate that checks a subset of its
  # own phase is the exact failure rule 60 §10 describes — a green signal standing
  # in for work that never happened.
  present dev-docs/grills/ai-browser/e2e-checklist.md \
    "\[AUTOMATED" "WI-6.2 automated checklist rows marked"
  present dev-docs/grills/ai-browser/e2e-checklist.md \
    "still manual" "WI-6.2 unmarked rows stated to be still manual"

  # WI-6.3 must be a decision, not an open question.
  present dev-docs/e2e-browser-matrix.md \
    "local pre-release gate|not a CI gate" "WI-6.3 CI/local decision recorded"

  # Rule 20: one source of truth per topic, linked from the dev-docs index.
  present dev-docs/README.md \
    "e2e-browser-matrix" "matrix linked from dev-docs/README.md"

  # WI-6.4 is NOT done. It is asserted as explicitly deferred rather than silently
  # skipped, so the phase cannot read as complete while it is outstanding.
  present dev-docs/plans/20260726-browser-hardening-and-e2e.md \
    "WI-6.4 \| DEFERRED" "WI-6.4 status is explicit (deferred, not silently dropped)"
}

case "$PHASE" in
  0) phase0 ;;
  1) phase1 ;;
  2) phase2 ;;
  3) phase3 ;;
  4) phase4 ;;
  5) phase5 ;;
  6) phase6 ;;
  *) echo "usage: bash scripts/check-browser-e2e-phase.sh <0..6>"; exit 2 ;;
esac

echo
if [ "$FAILED" -eq 0 ]; then
  echo "Phase $PHASE: PASS"
else
  echo "Phase $PHASE: FAIL"
fi
exit "$FAILED"
