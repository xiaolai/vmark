#!/usr/bin/env bash
#
# Browser ↔ shell integration: per-phase Definition of Done (WI-S0.6).
#
# Governance §3: a phase's DoD must be machine-checkable, not prose. Prose DoD is how a
# phase gets called "complete" because it feels complete.
#
# FAIL CLOSED, always. An unknown phase, a missing assertion, a check that cannot run —
# all of these exit non-zero. A gate that cannot see a thing must never report success
# about it; that is exactly the bug that let the WI-linkage checker return green on a
# plan whose work items it could not parse.
#
# Usage:
#   bash scripts/check-browser-shell-phase.sh <phase>     # 0 | OC | 1 | 2 | 3 | 4
#
# Exit codes:
#   0  every assertion for the phase holds
#   1  an assertion failed
#  64  bad invocation

set -uo pipefail
cd "$(dirname "$0")/.."

PLAN="dev-docs/plans/20260714-browser-shell-integration.md"
PHASE="${1:-}"
if [[ -z "$PHASE" ]]; then
  echo "Usage: $0 <phase>   (0 | OC | 1 | 2 | 3 | 4)"
  exit 64
fi

FAILED=0
pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; FAILED=1; }

# An assertion that a file exists AND contains a pattern. Both halves matter: a file that
# was deleted and a file that was gutted look the same to a grep alone.
has() {
  local file="$1" pattern="$2" what="$3"
  if [[ ! -f "$file" ]]; then fail "$what — $file does not exist"; return; fi
  # Case-insensitive: a gate that fails because a heading is capitalised is noise,
  # and noise is how a gate gets ignored.
  if grep -qiE "$pattern" "$file"; then pass "$what"; else fail "$what — not found in $file"; fi
}

# An assertion that a file exists AND does NOT contain a pattern — for the things that must
# stay gone. The file-exists half is not pedantry: a `grep -v` against a missing file
# succeeds, so without it a deleted file would satisfy every negative assertion about it.
hasnt() {
  local file="$1" pattern="$2" what="$3"
  if [[ ! -f "$file" ]]; then fail "$what — $file does not exist"; return; fi
  if grep -qiE "$pattern" "$file"; then fail "$what — still present in $file"; else pass "$what"; fi
}

# Every WI in the phase is traceable to a commit or a test header.
linkage() {
  local phase="$1"
  if bash scripts/check-wi-linkage.sh "$PLAN" "--phase=$phase" >/dev/null 2>&1; then
    pass "every WI-$phase.* is linked (commit or test header)"
  else
    fail "some WI-$phase.* are unlinked — run: bash scripts/check-wi-linkage.sh $PLAN --phase=$phase"
  fi
}

echo "Browser shell integration — Phase $PHASE"
echo "─────────────────────────────────────────────"

case "$PHASE" in
  0)
    linkage S0
    has src/hooks/useTabShortcuts.ts 'browser\.newTab' "S0.1 the browser has a user-facing trigger"
    has src-tauri/src/menu/localized/file_menu.rs 'new-browser-tab' \
        "S0.5 the trigger is NATIVE (survives the page taking keyboard focus)"
    has src-tauri/src/browser/nav_emit_macos.rs 'emit_to' "S0.2 browser events are window-routed"
    # ...and no event is broadcast any more. This is the assertion that would catch a
    # regression, not the one that confirms the fix.
    if grep -qE 'ivars\.app\.emit\(' src-tauri/src/browser/nav_delegate_macos.rs 2>/dev/null; then
      fail "S0.2 a browser event is still BROADCAST (ivars.app.emit) — route it to the owner"
    else
      pass "S0.2 no browser event is broadcast to every window"
    fi
    has src-tauri/src/browser/geometry.rs 'appkit_origin_y' "S0.3a DOM→AppKit coordinates are converted"
    has src/components/Browser/BrowserSurface.tsx 'layoutVersion' \
        "S0.3b bounds re-report when the layout MOVES the rect, not only on resize"
    has src-tauri/src/browser/teardown.rs 'destroy_window' "S0.4 a closed window tears down its browsers"
    has src/components/Browser/BrowserApprovalDialog.tsx 'resolveApproval' \
        "S0.8 the AI-action consent prompt exists (the security model has a human in it)"
    has src/components/Browser/BrowserGrantsList.tsx 'revoke' "S0.8 standing grants can be revoked"
    # Swallowed failures are the defect; assert they are gone rather than that a handler exists.
    if grep -qE 'catch\(\(\) => \{\}\)' src/services/browser/browserNavigation.ts 2>/dev/null; then
      fail "S0.9 browserNavigation still swallows a rejection"
    else
      pass "S0.9 browser command failures are surfaced, not swallowed"
    fi
    has src/components/Browser/useBrowserNativeView.ts 'mountTokens' "S0.10 a stale destroy cannot kill a newer mount"
    # S0.11: the R7a same-document expiry must be attached to a callback that REALLY FIRES.
    # The first attempt used `webView:didSameDocumentNavigation:`, which is not a selector
    # WebKit has — define_class! registered it and the runtime never called it, so the
    # control was decoration. KVO on `URL` is the public mechanism that works.
    has src-tauri/src/browser/nav_kvo_macos.rs 'addObserver_forKeyPath_options_context' "S0.11 same-document navigation is observed via KVO on URL"
    hasnt src-tauri/src/browser/nav_delegate_macos.rs 'didSameDocumentNavigation' "S0.11 the invented selector is not reintroduced"
    ;;

  OC)
    linkage SOC
    has src/services/browser/overlayPolicies.ts 'OVERLAY_POLICIES' "SOC.1 every overlay declares an occlusion policy"
    has src/services/browser/overlayPolicies.test.ts 'App\.tsx' \
        "SOC.1 the policy list is checked against App.tsx (a hand-written list is not a gate)"
    has src/services/browser/overlayPolicies.test.ts 'useBrowserOccluder' \
        "SOC.1 declaring 'freeze' without wiring it fails the build"
    has src/components/Browser/BrowserOverlays.tsx 'browser-frozen' \
        "SOC.1b an opaque placeholder stands in for the hidden native view"
    has src/hooks/useBrowserOccluder.ts 'entries' \
        "SOC.1c occlusion freezes every MOUNTED browser, not just the focused tab"
    ;;

  1)
    linkage S1
    has src/components/Browser/BrowserOmnibox.tsx 'browser-omnibox' "S1.3 the omnibox renders in the bottom bar"
    has src/components/StatusBar/StatusBar.tsx 'activeBrowserTabId' "S1.3 the StatusBar hosts it for a browser tab"
    has src/components/BottomBar/BottomBar.tsx 'activeIsBrowser' \
        "S1.3 a browser tab owns the bottom lane (find/toolbar cannot cover its only chrome)"
    if grep -qE 'browser-chrome' src/components/Browser/BrowserSurface.tsx 2>/dev/null; then
      fail "S1.4 the old top chrome strip is still in BrowserSurface"
    else
      pass "S1.4 the top chrome strip is gone"
    fi
    has src/lib/browser/omnibox.ts 'resolveOmnibox' "S1.5 the omnibox classifies URL-or-search"
    has src/components/Browser/BrowserOmnibox.tsx 'canGoBack' "S1.6 back/forward are disabled without history"
    ;;

  2)
    linkage S2
    has src/components/Browser/BrowserHistoryView.tsx 'history' "S2 the browser history sidebar view exists"
    has src/stores/browserHistoryStore.ts 'transitionKind' "S2 history has a real record schema, not a url list"
    ;;

  3)
    linkage S3
    has src/stores/bookmarkStore.ts 'bookmarks' "S3 the bookmark store exists"
    has src/lib/browser/bookmarkUrl.ts 'canonicalizeBookmarkUrl' \
        "S3 bookmark identity is path-preserving (origin-only dedup collapses a whole site)"
    ;;

  4)
    linkage S4
    has website/guide/browser.md 'co-driv' "S4 the co-driving flow is documented"
    ;;

  *)
    echo "unknown phase: $PHASE (expected 0, OC, 1, 2, 3, or 4)"
    exit 64
    ;;
esac

echo "─────────────────────────────────────────────"
if (( FAILED )); then
  echo "Phase $PHASE: NOT done"
  exit 1
fi
echo "Phase $PHASE: DoD holds"
exit 0
