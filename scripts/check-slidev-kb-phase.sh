#!/usr/bin/env bash
#
# DoD checker for the Slidev + Knowledge-Base content-server plan.
# Plan: dev-docs/plans/20260624-1500-slidev-kb-content-server.md
#
# Usage: bash scripts/check-slidev-kb-phase.sh <phase-number>
#
# Each phase block runs machine-checkable assertions for that phase's
# Definition of Done (governance rule 3). Exit 0 if all pass, 1 if any fail.
# Run before ticking the plan's Status header to the next phase.
#
#   0    Feasibility spikes
#   1    Runtime slice (manager + spawn + supervisor + auth)
#   1.5  Slidev slice (detect → boot → teardown)
#   2    Index / graph (walker, resolution, graph, watch)
#   3    Headless render (remark→hast, KaTeX, sanitize)
#   4    KB site (routes, cookie auth, SSE, search)
#   5    In-app panel (reachable: command + menu + shortcut)
#   6    Slidev preview (in-app action)
#   7    Slidev export (arg-builder + cancellation + in-app action)
#   8    Polish (i18n, docs, gates)

set -uo pipefail
cd "$(dirname "$0")/.."

PHASE="${1:-}"
if [[ -z "$PHASE" ]]; then
  sed -n '/^#   0/,/^#   8/p' "$0" | sed 's/^# //'
  exit 64
fi

PASS=0; FAIL=0; FAIL_DETAIL=()
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); FAIL_DETAIL+=("$1"); }

assert_file() { [[ -f "$1" ]] && ok "${2:-$1} exists" || fail "${2:-$1} missing: $1"; }
assert_dir()  { [[ -d "$1" ]] && ok "${2:-$1} exists" || fail "${2:-$1} missing: $1"; }
assert_grep() {
  if grep -R -q -- "$1" "$2" 2>/dev/null; then ok "$3"; else fail "$3 (pattern '$1' not in $2)"; fi
}

CS=vmark-content-server/src
RS=src-tauri/src/content_server

phase_0() {
  echo "Phase 0 — Feasibility spikes"
  assert_dir "dev-docs/grills/slidev-kb" "grills directory"
  for s in S0.1 S0.4 S0.6; do
    if ls dev-docs/grills/slidev-kb/${s}* >/dev/null 2>&1; then ok "$s write-up present"; else fail "$s write-up missing"; fi
  done
}

phase_1() {
  echo "Phase 1 — Runtime slice"
  assert_file "$RS/mod.rs" "manager module"
  assert_file "$RS/spawn.rs" "spawn module"
  assert_file "$RS/commands.rs" "commands module"
  assert_grep "poll_current_child" "$RS/mod.rs" "crash-detection API present (WI-1.2)"
  assert_grep "monitor_child"      "$RS/spawn.rs" "supervisor monitor present (WI-1.2)"
  assert_grep "Stdio::piped"       "$RS/spawn.rs" "child stdio piped to log (WI-1.2)"
  assert_grep "content_server_start" "src-tauri/src/lib.rs" "commands registered in lib.rs"
}

phase_1_5() {
  echo "Phase 1.5 — Slidev slice"
  assert_file "$CS/slidev/detect.ts" "deck detection"
  assert_file "$CS/slidev/manager.ts" "Slidev manager"
  assert_file "$CS/slidev/server.ts" "programmatic boot"
}

phase_2() {
  echo "Phase 2 — Index / graph"
  assert_file "$CS/index/walk.ts" "walker"
  assert_file "$CS/index/buildIndex.ts" "index builder"
  assert_grep "respectGitignore" "$CS/index/walk.ts" ".gitignore honoring (WI-2.1)"
}

phase_3() {
  echo "Phase 3 — Headless render"
  assert_file "$CS/render/renderMarkdown.ts" "renderer"
  assert_grep "sanitize" "$CS/render/renderMarkdown.ts" "output sanitized"
  assert_grep "rehype-katex" "$CS/render/renderMarkdown.ts" "math rendered server-side"
}

phase_4() {
  echo "Phase 4 — KB site"
  assert_file "$CS/server/createServer.ts" "server"
  assert_file "$CS/server/auth.ts" "auth"
  assert_grep "__events" "$CS/server/assets.ts" "SSE live-reload client"
  assert_file "$CS/server/search.ts" "search"
}

phase_5() {
  echo "Phase 5 — In-app panel (reachable)"
  assert_grep "view.toggleKnowledgeBase" "src/services/commands/viewCommands.ts" "toggle command (WI-5.1)"
  assert_grep "menu:knowledge-base" "src/services/commands/useCommandBootstrap.ts" "menu binding (WI-5.1)"
  assert_grep "knowledge-base" "src-tauri/src/menu/localized.rs" "View-menu item (WI-5.1)"
  assert_grep "knowledgeBase" "src/stores/settingsStore/shortcuts.ts" "shortcut def (rule 41)"
  assert_file "src/components/KnowledgeBasePanel/KnowledgeBasePanel.tsx" "panel"
}

phase_6() {
  echo "Phase 6 — Slidev preview"
  assert_grep "previewSlides" "src/hooks/useContentServer.ts" "in-app preview action (WI-6.3)"
  assert_grep "content_server_slidev_preview" "$RS/slidev_commands.rs" "preview command"
}

phase_7() {
  echo "Phase 7 — Slidev export"
  assert_grep "buildExportArgs" "$CS/slidev/export.ts" "export arg-builder"
  assert_grep "AbortSignal" "$CS/slidev/export.ts" "export cancellation (WI-7.3)"
  assert_grep "exportSlides" "src/hooks/useContentServer.ts" "in-app export action (WI-7.2)"
}

phase_8() {
  echo "Phase 8 — Polish"
  assert_grep "view.knowledgeBase" "src-tauri/locales/en.yml" "Rust menu i18n key"
  assert_file "website/guide/knowledge-base.md" "website guide (WI-8.2)"
  assert_grep "knowledge-base" "website/.vitepress/config/en.ts" "sidebar entry (WI-8.2)"
}

case "$PHASE" in
  0) phase_0 ;;
  1) phase_1 ;;
  1.5) phase_1_5 ;;
  2) phase_2 ;;
  3) phase_3 ;;
  4) phase_4 ;;
  5) phase_5 ;;
  6) phase_6 ;;
  7) phase_7 ;;
  8) phase_8 ;;
  *) echo "Unknown phase: $PHASE"; exit 64 ;;
esac

echo ""
echo "  $PASS passed, $FAIL failed"
if (( FAIL > 0 )); then
  printf '  - %s\n' "${FAIL_DETAIL[@]}"
  exit 1
fi
exit 0
