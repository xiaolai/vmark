#!/usr/bin/env bash
#
# DoD checker for the Terminal Edge-Hardening plan.
# Plan: dev-docs/plans/20260727-terminal-edge-hardening.md
#
# Usage: bash scripts/check-terminal-edge-phase.sh <phase-number>
#
# Structural (file-presence + grep) assertions only. "Gates green"
# (pnpm check:all / cargo test) and live Tauri-MCP checks are verified
# separately by the runner. Exit 0 if all pass, 1 if any fail, 64 on usage.

set -uo pipefail
cd "$(dirname "$0")/.."

PHASE="${1:-}"
if [[ -z "$PHASE" ]]; then
  echo "Usage: $0 <phase-number>"
  echo "  1  T1,T2,T3,T4,T6  correctness (EDITOR, panel size, font zoom, bell, root links)"
  echo "  2  T7,T8,T9,T10    truth (docs match code, terminal settings translated)"
  echo "  3  T11,T12,T13,T14 gaps (search, bash integration, OSC 52, serialize dep)"
  echo "  4  F1-F4,F6        features (rename, open-here, run-block, copy-output, maximize)"
  exit 64
fi

PASS=0; FAIL=0; FAIL_DETAIL=()
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); FAIL_DETAIL+=("$1"); }

# assert_grep <fixed-pattern> <file-or-dir> <label>
assert_grep() {
  if grep -rqF -- "$1" "$2" 2>/dev/null; then ok "$3"; else fail "$3 (pattern '$1' not in $2)"; fi
}

# assert_no_grep <fixed-pattern> <file-or-dir> <label> — the absence IS the contract.
assert_no_grep() {
  if grep -rqF -- "$1" "$2" 2>/dev/null; then fail "$3 (pattern '$1' still present in $2)"; else ok "$3"; fi
}

# assert_re <ERE> <file> <label>
assert_re() {
  if grep -rqE -- "$1" "$2" 2>/dev/null; then ok "$3"; else fail "$3 (regex '$1' not in $2)"; fi
}

# assert_no_re <ERE> <file> <label>
assert_no_re() {
  if grep -rqE -- "$1" "$2" 2>/dev/null; then fail "$3 (regex '$1' still matches in $2)"; else ok "$3"; fi
}

# assert_file <path> <label>
assert_file() {
  if [[ -f "$1" ]]; then ok "$2"; else fail "$2 ($1 missing)"; fi
}

SPAWN="src/components/Terminal/spawnPty.ts"
HELPERS="src/pages/settings/terminalSettingsHelpers.ts"
HELPERS_TEST="src/pages/settings/terminalSettingsHelpers.test.ts"
BELL="src/components/Terminal/terminalBell.ts"
LINKS="src/components/Terminal/fileLinkProvider.ts"
DOC="website/guide/terminal.md"
SHL="src-tauri/src/shell_integration.rs"
SHL_TEST="src-tauri/src/shell_integration.test.rs"
BASH_RC="src-tauri/resources/shell-integration/vmark.bash"
SEARCHBAR="src/components/Terminal/TerminalSearchBar.tsx"
SPAWNENV="src/components/Terminal/terminalSpawnEnv.ts"
TABBAR="src/components/Terminal/TerminalTabBar.tsx"
TABRENAME="src/components/Terminal/TerminalTabRename.tsx"

case "$PHASE" in
  1)
    # WI-1.1 — EDITOR is no longer set (T1/D1).
    assert_no_re '^\s*EDITOR:' "$SPAWN" "WI-1.1 spawnPty no longer sets EDITOR"
    assert_grep "TERM_PROGRAM: \"WezTerm\"" "$SPAWN" "WI-1.1 ADR-006 WezTerm impersonation preserved"
    assert_grep "does not set EDITOR" "src/components/Terminal/spawnPty.test.ts" "WI-1.1 RED test present"
    assert_no_grep "| \`EDITOR\` | \`vmark\` |" "$DOC" "WI-1.1 docs no longer advertise EDITOR=vmark"
    # WI-1.2 — panel size options stop at the enforced cap.
    assert_no_re '"0\.(6|7|8)"' "$HELPERS" "WI-1.2 panelSizeOptions stop at 50%"
    assert_grep "TERMINAL_MAX_RATIO" "$HELPERS" "WI-1.2 options derived from the enforced cap"
    assert_file "$HELPERS_TEST" "WI-1.2 terminalSettingsHelpers.test.ts present"
    assert_grep "no option is silently clamped" "$HELPERS_TEST" "WI-1.2 no-silent-clamp test present"
    assert_grep "snapToOption maps a legacy over-cap ratio to the cap" "$HELPERS_TEST" "WI-1.2 legacy-ratio test present"
    # WI-1.3 — the font-size dropdown tolerates a zoomed value.
    assert_grep "fontSizeOptionsFor" "$HELPERS" "WI-1.3 fontSizeOptionsFor helper present"
    assert_grep "fontSizeOptionsFor" "src/pages/settings/TerminalSettings.tsx" "WI-1.3 settings UI uses it"
    assert_grep "shows a zoomed font size not in the preset list" "src/pages/settings/TerminalSettings.test.tsx" "WI-1.3 zoomed-value test present"
    # WI-1.4 — one shared AudioContext.
    assert_grep "sharedAudioContext" "$BELL" "WI-1.4 module-scoped AudioContext"
    assert_no_grep "ctx.close()" "$BELL" "WI-1.4 context is never closed"
    assert_grep "reuses a single AudioContext across bells" "src/components/Terminal/terminalBell.test.ts" "WI-1.4 reuse test present"
    # WI-1.5 — relative links resolve at the filesystem root.
    assert_grep "normalizeBase" "$LINKS" "WI-1.5 base normalization helper present"
    assert_grep "resolves relative paths when the base is the filesystem root" "src/components/Terminal/fileLinkProvider.test.ts" "WI-1.5 root-base test present"
    ;;
  2)
    # WI-2.1 — the docs stop contradicting the code.
    assert_no_grep "| \`TERM_PROGRAM\` | \`vmark\` |" "$DOC" "WI-2.1 TERM_PROGRAM doc row corrected"
    assert_grep "WezTerm" "$DOC" "WI-2.1 docs name the real TERM_PROGRAM value"
    assert_grep "ADR-006" "$DOC" "WI-2.1 docs carry the ADR-006 reason"
    assert_no_grep "SIGSTOP" "$DOC" "WI-2.1 Pause/Resume vapor section removed"
    assert_grep "Not yet implemented" "$DOC" "WI-2.1 deferred capabilities noted honestly"
    assert_re '\| Mac Option as Meta \| On / Off \| On \|' "$DOC" "WI-2.1 Option-as-Meta default corrected to On"
    # WI-2.2 — the doc↔default drift guard.
    assert_file "src/pages/settings/__tests__/terminalDocDefaults.test.ts" "WI-2.2 drift-guard test present"
    assert_grep "macOptionIsMeta" "src/pages/settings/__tests__/terminalDocDefaults.test.ts" "WI-2.2 guard covers macOptionIsMeta"
    assert_grep "minimumContrastRatio" "src/pages/settings/__tests__/terminalDocDefaults.test.ts" "WI-2.2 guard covers minimumContrastRatio"
    # WI-2.3 — the stranded terminal strings are translated.
    assert_file "src/locales/__tests__/terminalI18nCoverage.test.ts" "WI-2.3 i18n coverage gate present"
    assert_grep "has no terminal.* value left verbatim in English" "src/locales/__tests__/terminalI18nCoverage.test.ts" "WI-2.3 gate asserts value drift, not just key presence"
    assert_grep "has no stale allow-list entry" "src/locales/__tests__/terminalI18nCoverage.test.ts" "WI-2.3 allow-list cannot rot"
    # The eight T10 strings, checked against the REAL English values (a wrong
    # pattern here would pass vacuously — that is how T10 survived this long).
    for loc in de es fr it ja ko pt-BR zh-CN zh-TW; do
      loc_fail=0
      for en in "Shell Integration" "Scrollback" "Screen Reader Mode" "WCAG AA (4.5:1)" "WCAG AAA (7:1)"; do
        grep -qF -- "\": \"$en\"" "src/locales/$loc/settings.json" 2>/dev/null && loc_fail=1
      done
      if (( loc_fail )); then fail "WI-2.3 $loc still has verbatim-English terminal strings"
      else ok "WI-2.3 $loc terminal settings strings translated"; fi
    done
    assert_no_grep '"terminal.maxSessions": "Maximum 5 sessions"' "src/locales/fr/statusbar.json" "WI-2.3 fr maxSessions translated"
    ;;
  3)
    # WI-3.1/3.2 — search result count, no-match feedback, option toggles.
    assert_grep "onDidChangeResults" "$SEARCHBAR" "WI-3.1 result listener wired"
    assert_grep "resultIndex" "$SEARCHBAR" "WI-3.1 result index consumed"
    assert_grep "terminal-search-input--no-match" "$SEARCHBAR" "WI-3.1 no-match state rendered"
    assert_grep "--error-color" "src/components/Terminal/TerminalSearchBar.css" "WI-3.1 no-match uses the error token"
    assert_file "src/components/Terminal/terminalSearchOptions.ts" "WI-3.2 search-options module present"
    assert_grep "aria-pressed" "$SEARCHBAR" "WI-3.2 toggles expose aria-pressed"
    assert_grep "caseSensitive" "src/components/Terminal/terminalSearchOptions.ts" "WI-3.2 caseSensitive option"
    assert_grep "wholeWord" "src/components/Terminal/terminalSearchOptions.ts" "WI-3.2 wholeWord option"
    assert_grep "regex" "src/components/Terminal/terminalSearchOptions.ts" "WI-3.2 regex option"
    # WI-3.3 — prepare_shell_integration returns env AND args.
    assert_grep "struct ShellIntegration" "$SHL" "WI-3.3 ShellIntegration return type"
    assert_grep "pub args: Vec<String>" "$SHL" "WI-3.3 args carried in the contract"
    assert_grep "buildShellSpawnConfig" "$SPAWNENV" "WI-3.3 frontend spawn-config builder"
    assert_grep "spawn(shell, spawnConfig.args" "$SPAWN" "WI-3.3 args forwarded to spawn"
    assert_grep "forwards integration args" "src/components/Terminal/spawnPty.test.ts" "WI-3.3 spawn-args test present"
    # WI-3.4 — bash integration.
    assert_file "$BASH_RC" "WI-3.4 vmark.bash present"
    assert_grep "133;A" "$BASH_RC" "WI-3.4 bash rc emits OSC 133 A"
    assert_grep "133;C" "$BASH_RC" "WI-3.4 bash rc emits OSC 133 C"
    assert_grep "133;D" "$BASH_RC" "WI-3.4 bash rc emits OSC 133 D"
    assert_grep "7;file://" "$BASH_RC" "WI-3.4 bash rc emits OSC 7 cwd"
    assert_grep ".bashrc" "$BASH_RC" "WI-3.4 bash rc sources the user's rc"
    assert_grep "--rcfile" "$SHL" "WI-3.4 rcfile arg returned"
    assert_grep "bash_script_preserves_existing_prompt_command" "$SHL_TEST" "WI-3.4 PROMPT_COMMAND composition test"
    assert_grep "bash_script_sources_the_user_rc_and_composes_both_hooks" "$SHL_TEST" "WI-3.4 behavioral bash test (runs real bash)"
    assert_grep "bash_script_reports_the_real_exit_code_and_cwd" "$SHL_TEST" "WI-3.4 exit-code behavioral test"
    assert_grep "bash_env_returns_rcfile_arg" "$SHL_TEST" "WI-3.4 rcfile-arg test"
    assert_grep "zsh_integration_returns_no_args" "$SHL_TEST" "WI-3.3 zsh byte-identical test"
    # WI-3.5 — OSC 52, write-only.
    assert_file "src/components/Terminal/setupOsc52.ts" "WI-3.5 setupOsc52 present"
    assert_file "src/components/Terminal/setupOsc52.test.ts" "WI-3.5 setupOsc52 tests present"
    assert_grep "@xterm/addon-clipboard" "package.json" "WI-3.5 clipboard addon dependency"
    assert_grep "osc52Clipboard" "src/stores/settingsStore/defaults.ts" "WI-3.5 setting default"
    assert_grep "osc52Clipboard" "src/stores/settingsTypes/system.ts" "WI-3.5 setting typed (persist guard derives from the default's type)"
    assert_grep "drops a corrupt persisted osc52Clipboard" "src/pages/settings/__tests__/terminalDocDefaults.test.ts" "WI-3.5 persist-boundary test"
    assert_grep "osc52Clipboard" "src/pages/settings/TerminalSettings.tsx" "WI-3.5 settings UI"
    assert_grep "terminal.osc52Clipboard.label" "src/locales/en/settings.json" "WI-3.5 i18n key"
    assert_grep "read is denied" "src/components/Terminal/setupOsc52.test.ts" "WI-3.5 read-denial security test"
    # WI-3.6 — serialize dependency added, unwired.
    assert_grep "@xterm/addon-serialize" "package.json" "WI-3.6 serialize addon dependency"
    assert_grep "@xterm/addon-serialize" "knip.json" "WI-3.6 serialize addon declared unused-on-purpose"
    ;;
  4)
    # WI-4.1 — tab rename UI (closes T5).
    assert_grep "terminalRenameSession" "$TABBAR" "WI-4.1 rename action reachable from the tab bar"
    assert_grep "onDoubleClick" "$TABBAR" "WI-4.1 double-click enters rename"
    assert_file "$TABRENAME" "WI-4.1 rename input extracted"
    assert_grep "isImeKeyEvent" "$TABRENAME" "WI-4.1 rename input is IME-safe"
    assert_grep "cancelledRef" "$TABRENAME" "WI-4.1 Escape cannot be undone by the blur commit"
    assert_grep "renames a session on Enter" "src/components/Terminal/TerminalTabBar.test.tsx" "WI-4.1 rename test present"
    # WI-4.2 — Open Terminal Here.
    assert_grep "openTerminalHere" "src/services/terminal/openTerminalHere.ts" "WI-4.2 service present"
    assert_grep "openTerminalHere" "src/components/Sidebar/FileExplorer/ContextMenu.tsx" "WI-4.2 context-menu entry"
    assert_grep "openTerminalHere" "src/components/Sidebar/FileExplorer/FileExplorer.tsx" "WI-4.2 action dispatched"
    assert_grep "does not appear for %s" "src/components/Sidebar/FileExplorer/ContextMenu.test.tsx" "WI-4.2 folders-only test"
    assert_grep "requestedCwd" "src/components/Terminal/useTerminalShellLifecycle.ts" "WI-4.2 explicit cwd beats sibling inheritance"
    # WI-4.3 — run a fenced shell block.
    assert_file "src/services/terminal/runInTerminal.ts" "WI-4.3 runInTerminal service present"
    assert_grep "codeAction = \"run\"" "src/plugins/codeBlockLineNumbers/nodeView.ts" "WI-4.3 run button on the code block"
    assert_grep "is NOT offered for a %j fence" "src/plugins/codeBlockLineNumbers/__tests__/codeBlockRunButton.test.ts" "WI-4.3 shell-only visibility test"
    assert_grep "isShellLanguage" "src/services/terminal/runInTerminal.ts" "WI-4.3 shell-language gate"
    assert_grep "extractTranscriptCommands" "src/services/terminal/runInTerminal.ts" "WI-4.3 transcript fences yield commands only, not output"
    assert_grep "isSafeToPaste" "src/services/terminal/runInTerminal.ts" "WI-4.3 bracketed-paste safety check"
    assert_grep "REFUSES a multi-line payload when bracketed paste is OFF" "src/services/terminal/runInTerminal.test.ts" "WI-4.3 multi-line refusal test"
    assert_grep "never auto-execute" "src/services/terminal/runInTerminal.ts" "WI-4.3 no-newline security boundary documented"
    assert_grep "does not append a newline" "src/services/terminal/runInTerminal.test.ts" "WI-4.3 no-auto-execute test"
    # WI-4.4 — Copy Command Output.
    assert_grep "commandOutputRange" "src/components/Terminal/setupOsc.ts" "WI-4.4 range helper present"
    assert_file "src/components/Terminal/commandOutputRange.test.ts" "WI-4.4 range tests present"
    assert_grep "excludes the prompt line from the copied range" "src/components/Terminal/commandOutputRange.test.ts" "WI-4.4 prompt-exclusion test"
    assert_grep "runs to the buffer end for the last (still open) command" "src/components/Terminal/commandOutputRange.test.ts" "WI-4.4 open-command test"
    assert_grep "copyCommandOutput" "src/components/Terminal/TerminalContextMenu.tsx" "WI-4.4 context-menu entry"
    # WI-4.5 — maximize toggle.
    assert_grep "toggleMaximize" "src/components/Terminal/useTerminalResize.ts" "WI-4.5 maximize toggle present"
    assert_grep "restores the STORED ratio on a second toggle" "src/components/Terminal/useTerminalResize.test.ts" "WI-4.5 restore test present"
    assert_grep "never rewrites the persisted panelRatio" "src/components/Terminal/useTerminalResize.test.ts" "WI-4.5 no-persist test present"
    assert_grep "onDoubleClick" "src/components/Terminal/TerminalPanel.tsx" "WI-4.5 resize handle double-click wired"
    ;;
  *)
    echo "Unknown phase: $PHASE"; exit 64 ;;
esac

echo ""
echo "Phase $PHASE: $PASS passed, $FAIL failed."
if (( FAIL > 0 )); then
  printf '  - %s\n' "${FAIL_DETAIL[@]}"
  exit 1
fi
exit 0
