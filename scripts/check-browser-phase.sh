#!/usr/bin/env bash
#
# DoD checker for the Embedded Browser / Site Plugins / Web Workflows plan.
# Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md
#
# Usage: bash scripts/check-browser-phase.sh <phase-number> [--full]
#
#   --full  also run the heavyweight gates the plan's DoD names but that the
#           pre-push hook normally owns (`pnpm check:all`, website build).
#           Without it those rows report SKIP, never PASS.
#
# Exit codes:
#   0  every assertion for the phase passed
#   1  one or more assertions failed
#   2  bad usage (no/unknown phase)
#   3  phase recognized but its assertions are not authored yet (fail closed)
#
# Governance: .claude/rules/60-ai-governance.md §3 — a phase gate must be
# machine-checkable. Two rules follow from that, and this script exists to
# honor them:
#
#   1. A spike "passes" on a STRUCTURED VERDICT plus EVIDENCE, never on prose
#      alone. Exactly one `Verdict:` line must exist (a second, contradicting
#      one is an error, not a tiebreak), its token must be in the spike's
#      declared accepted set, and SPIKE-1 additionally has to leave behind the
#      artifacts its probe produced.
#
#   2. A phase gate RUNS THE TESTS its DoD names. Asserting that a file exists
#      proves nothing about whether it works; the previous version of this
#      script reported Phase 1 green while `check-wi-linkage.sh --phase=1` was
#      red and the Rust browser suite did not compile.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

GRILLS="dev-docs/grills/embedded-browser"
PLAN="dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md"

PHASE=""
FULL=0
for arg in "$@"; do
  case "$arg" in
    --full) FULL=1 ;;
    # Reject unknown flags rather than silently ignoring them: `1 --ful` must
    # NOT quietly skip the heavyweight gates and still report green.
    -*)
      echo "Unknown flag: $arg" >&2
      echo "Usage: $0 <phase-number> [--full]" >&2
      exit 2
      ;;
    *)
      if [[ -n "$PHASE" ]]; then
        echo "Unexpected extra argument: '$arg' (phase already set to '$PHASE')" >&2
        echo "Usage: $0 <phase-number> [--full]" >&2
        exit 2
      fi
      PHASE="$arg"
      ;;
  esac
done

FAIL=0

# Colors only on a TTY, and never when NO_COLOR is set (no ANSI in CI logs).
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_OK=$'\033[32m'; C_BAD=$'\033[31m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_OK=""; C_BAD=""; C_DIM=""; C_OFF=""
fi

pass() { printf '  %sPASS%s %s\n' "$C_OK" "$C_OFF" "$1"; }
fail() { printf '  %sFAIL%s %s\n' "$C_BAD" "$C_OFF" "$1"; FAIL=1; }
skip() { printf '  %sSKIP%s %s\n' "$C_DIM" "$C_OFF" "$1"; }

# ── Spike verdicts ───────────────────────────────────────────────────────
#
# Accepted-outcome policy. Completion and outcome are tracked separately: a
# spike that ran honestly and returned a negative result can still satisfy the
# plan, but only where the plan says so. Each entry below cites its warrant.
#
#   SPIKE-1  PASS only          Phase-0 DoD: "no-bridge assertion PASSES
#                               (hard halt if not)" — the blocking spike.
#   SPIKE-2  PASS only
#   SPIKE-3  PASS or REFUTED    Phase-0 DoD asks that Q6 (trusted input) be
#                               *answered*. REFUTED is an answer, and ADR-B5
#                               adopts the synthetic tier on the strength of it.
#   SPIKE-4  PASS only
#   SPIKE-5  PASS only
#   SPIKE-6  PASS only          §1.4 explicitly refuses to defer Windows/Linux
#                               ("deferring them would let a macOS-shaped
#                               abstraction harden and then break").
#   SPIKE-7  PASS only          Acceptance: "a draft appears in the target".
#
# BLOCKED / PARTIAL / NOT RUN are therefore never silently accepted. If the
# team decides to accept one, widen the set HERE — in a reviewable diff — so
# the concession is visible, rather than editing prose in a write-up.
spike_accepts() {
  case "$1" in
    3) echo "PASS REFUTED" ;;
    *) echo "PASS" ;;
  esac
}

# Extract the single structured verdict token from a spike write-up.
# Echoes the token, or an ERROR:<reason> sentinel.
spike_verdict() {
  local file="$1" lines count raw tok
  lines=$(grep -iE '^[[:space:]>*_]*\*{0,2}Verdict\*{0,2}[[:space:]]*:' "$file" 2>/dev/null)
  count=$(printf '%s' "$lines" | grep -c . )
  if [[ "$count" -eq 0 ]]; then echo "ERROR:no-verdict-line"; return; fi
  if [[ "$count" -gt 1 ]]; then echo "ERROR:$count-conflicting-verdict-lines"; return; fi

  # Strip everything through "Verdict", its emphasis markers and the colon.
  raw=$(printf '%s' "$lines" | sed -E 's/.*[Vv][Ee][Rr][Dd][Ii][Cc][Tt][*_[:space:]]*:[*_[:space:]]*//')
  tok=$(printf '%s' "$raw" | tr '[:lower:]' '[:upper:]')

  # Whole-token match: the char after the token must not be alphanumeric, so
  # "PASS_FAIL" or "PASSABLE" cannot masquerade as PASS.
  case "$tok" in
    "NOT RUN"|"NOT RUN"[!A-Z0-9_-]*) echo "NOT RUN" ;;
    PASS|PASS[!A-Z0-9_-]*)           echo "PASS" ;;
    FAIL|FAIL[!A-Z0-9_-]*)           echo "FAIL" ;;
    REFUTED|REFUTED[!A-Z0-9_-]*)     echo "REFUTED" ;;
    BLOCKED|BLOCKED[!A-Z0-9_-]*)     echo "BLOCKED" ;;
    PARTIAL|PARTIAL[!A-Z0-9_-]*)     echo "PARTIAL" ;;
    *)                               echo "ERROR:unrecognized-verdict" ;;
  esac
}

check_spike() {
  local n="$1" desc="$2"
  local file="$GRILLS/SPIKE-$n.md"
  local verdict accepted

  if [[ ! -f "$file" ]]; then
    fail "SPIKE-$n write-up missing ($file) — $desc"
    return
  fi

  verdict=$(spike_verdict "$file")
  if [[ "$verdict" == ERROR:* ]]; then
    fail "SPIKE-$n verdict unusable (${verdict#ERROR:}) — $desc"
    return
  fi

  accepted=$(spike_accepts "$n")
  if [[ " $accepted " == *" $verdict "* ]]; then
    pass "SPIKE-$n $verdict — $desc"
  else
    fail "SPIKE-$n verdict is $verdict; this gate accepts only [$accepted] — $desc"
  fi
}

# True if $1 begins with the 8-byte PNG magic signature. Uses od (present on
# macOS + Linux) so it works without `file`.
is_png() {
  local sig
  sig=$(head -c 8 "$1" 2>/dev/null | od -An -tx1 2>/dev/null | tr -d ' \n')
  [[ "$sig" == "89504e470d0a1a0a" ]]
}

# SPIKE-1 is the load-bearing security probe. Its verdict must be backed by the
# artifacts the probe actually produced — otherwise "PASS" is just a sentence.
# An empty probe dir, or a zero-byte / non-PNG "capture", must NOT pass.
check_spike1_evidence() {
  local ok=1
  local probe="$GRILLS/spike1-probe"
  local png="$GRILLS/spike1-embedded-evidence.png"

  # The probe must carry its actual Rust sources, not just an empty directory.
  if [[ ! -f "$probe/Cargo.toml" ]] || ! ls "$probe"/src/*.rs >/dev/null 2>&1; then
    fail "SPIKE-1 probe sources incomplete ($probe — expected Cargo.toml + src/*.rs)"
    ok=0
  fi

  # The embedding capture must be a real, non-empty PNG.
  if [[ ! -s "$png" ]]; then
    fail "SPIKE-1 embedding evidence capture missing or empty ($png)"
    ok=0
  elif ! is_png "$png"; then
    fail "SPIKE-1 embedding evidence is not a valid PNG ($png)"
    ok=0
  fi

  [[ "$ok" -eq 1 ]] && pass "SPIKE-1 evidence artifacts valid (probe sources + non-empty PNG)"
}

# The no-bridge invariant (R3/I1) must be a live, shipped assertion — not just a
# claim in a spike doc. Assert the string and its command still exist in source.
check_no_bridge_invariant() {
  if grep -q 'NO_BRIDGE_ASSERTION' src-tauri/src/browser/surface.rs 2>/dev/null; then
    pass "no-bridge assertion (I1) defined in browser/surface.rs"
  else
    fail "no-bridge assertion (I1) missing from src-tauri/src/browser/surface.rs"
  fi
  if grep -q 'browser_assert_no_bridge' src-tauri/src/lib.rs 2>/dev/null; then
    pass "browser_assert_no_bridge command registered in lib.rs"
  else
    fail "browser_assert_no_bridge not registered in src-tauri/src/lib.rs"
  fi
}

# ── Phase prerequisites ──────────────────────────────────────────────────
#
# Which spikes a phase actually rests on. Enforced programmatically — the old
# script printed a NOTE saying "Phase 0 must PASS first" and then never checked,
# which is exactly the prose-instead-of-gate failure §3 forbids.
#
# Phase 1 is the macOS browser surface, so it depends on SPIKE-1 (embedding +
# no-bridge), 2 (eval), 4 (profile) and 5 (occlusion). It does NOT depend on
# SPIKE-3 (input → Phase 2), SPIKE-6 (Windows/Linux → Phase 5) or SPIKE-7
# (publishing → Phase 4); gating it on those would make the Phase-1 gate
# permanently red for reasons that have nothing to do with Phase 1.
require_spikes() {
  local phase="$1"; shift
  local n verdict bad=0
  echo "Phase $phase prerequisites — spikes this phase rests on:"
  for n in "$@"; do
    verdict=$(spike_verdict "$GRILLS/SPIKE-$n.md" 2>/dev/null)
    if [[ "$verdict" == "PASS" ]]; then
      pass "SPIKE-$n PASS (prerequisite)"
    else
      fail "SPIKE-$n is '${verdict}' — Phase $phase cannot be green until it PASSES"
      bad=1
    fi
  done
  return $bad
}

# ── Test runners ─────────────────────────────────────────────────────────
run_vitest() {
  local file="$1" label="$2"
  if [[ ! -f "$file" ]]; then fail "$label — test file missing ($file)"; return; fi
  if pnpm exec vitest run "$file" >/dev/null 2>&1; then
    pass "$label — $file green"
  else
    fail "$label — $file FAILING (rerun: pnpm exec vitest run $file)"
  fi
}

run_cargo() {
  local filter="$1" label="$2"
  if cargo test --manifest-path src-tauri/Cargo.toml --lib "$filter" >/dev/null 2>&1; then
    pass "$label — cargo --lib $filter green"
  else
    fail "$label — cargo --lib $filter FAILING (rerun: cargo test --manifest-path src-tauri/Cargo.toml --lib $filter)"
  fi
}

run_script() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then
    pass "$label"
  else
    fail "$label (rerun: $*)"
  fi
}

# ── Phases ───────────────────────────────────────────────────────────────
case "$PHASE" in
  0)
    echo "Phase 0 — feasibility spikes (structured verdict + evidence):"
    check_spike 1 "owned native webview + NO-BRIDGE security probe (BLOCKING)"
    check_spike 2 "sync + async eval, init scripts, dependency matrix"
    check_spike 3 "screenshot + trusted-input reality check"
    check_spike 4 "profile persistence + isolation floor"
    check_spike 5 "occlusion (freeze-to-snapshot) reality check"
    check_spike 6 "Windows + Linux embedding + Windows isolated world"
    check_spike 7 "publishing probe + CSRF/session reality"
    echo "Phase 0 — evidence + shipped invariants:"
    check_spike1_evidence
    check_no_bridge_invariant
    ;;

  1)
    require_spikes 1 1 2 4 5
    echo "Phase 1 — browser surface (foundation). Running the DoD suites:"

    # DoD: tab-union + lastOpenTabs migration green, pre-existing tabStore green.
    run_vitest src/stores/__tests__/tabStore.test.ts          "WI-1.1 pre-existing tabStore suite unregressed"
    run_vitest src/stores/__tests__/tabStore.browser.test.ts  "WI-1.1 tab discriminated union"
    run_vitest src/services/persistence/sessionTabs.test.ts   "WI-1.1 versioned lastOpenTabs migration"

    # DoD: the no-bridge regression test (I1) is in CI and passing.
    check_no_bridge_invariant
    run_cargo browser "I1 no-bridge + crash-recovery + registry (Rust browser suite)"

    # DoD: occlusion incl. IME round-trip; live-webview cap; R12 surfaces;
    #      eval watchdog + automation lease; feature flag default-off.
    run_vitest src/services/browser/occlusion.test.ts   "WI-1.4 occlusion / freeze-thaw incl. IME"
    run_vitest src/stores/__tests__/browserStore.test.ts "WI-1.6 live-webview cap enforced"
    run_vitest src/lib/browser/uxPolicy.test.ts          "WI-1.7 every R12 surface implemented or explicitly denied"
    run_vitest src/services/browser/lease.test.ts        "WI-1.9 automation lease + eval watchdog"
    run_vitest src/stores/settingsStore.browser.test.ts  "WI-1.10 feature flag defaults OFF"

    # DoD: WI-linkage 1.x passes (governance §2).
    run_script "WI-linkage for phase 1" bash scripts/check-wi-linkage.sh "$PLAN" --phase=1

    # DoD: pnpm check:all green; website build green. These are the pre-push
    # gate's job; run them here only under --full, and never report them as
    # PASS when they were not run.
    if [[ "$FULL" -eq 1 ]]; then
      run_script "pnpm check:all" pnpm check:all
      run_script "website build" pnpm --dir website build
    else
      skip "pnpm check:all — not run (pre-push gate owns it; re-run with --full)"
      skip "website build — not run (pre-push gate owns it; re-run with --full)"
    fi

    echo "  NOTE: live-session behavior (open/view/navigate, session restore across"
    echo "        restart) is verified manually in a Tauri session — no script can"
    echo "        assert it. Everything above is machine-checked."
    ;;

  2|3|4|5)
    # Fail closed: an un-authored phase must NOT report success.
    echo "Phase $PHASE — assertions not yet authored."
    echo "  (Template: copy the Phase-1 block — require_spikes + run_vitest/run_cargo"
    echo "   rows that mirror that phase's DoD line in $PLAN.)"
    echo "Phase $PHASE: NOT IMPLEMENTED — treated as not passing."
    exit 3
    ;;

  *)
    echo "Usage: $0 <phase-number> [--full]"
    echo "  0  Feasibility spikes (7)"
    echo "  1  Browser surface (foundation)"
    echo "  2  Driver + automation agent"
    echo "  3  Site plugin system"
    echo "  4  Web workflow engine"
    echo "  5  Polish / cross-platform / a11y"
    exit 2
    ;;
esac

echo
if [[ "$FAIL" -eq 0 ]]; then
  echo "Phase $PHASE: all assertions passed."
  exit 0
fi
echo "Phase $PHASE: one or more assertions FAILED."
exit 1
