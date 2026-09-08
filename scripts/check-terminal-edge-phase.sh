#!/usr/bin/env bash
#
# DoD checker for the Terminal Edge-Hardening plan.
# Plan: dev-docs/plans/20260727-terminal-edge-hardening.md
#
# Usage: bash scripts/check-terminal-edge-phase.sh <phase-number> [--root=<dir>]
#
# Structural assertions only — file presence, grep, and (for anything whose
# subject is a TEST) the syntax-aware probes in scripts/dod-syntax.mjs.
# "Gates green" (pnpm check:all / cargo test) and live Tauri-MCP checks are
# verified separately by the runner. Exit 0 if all pass, 1 if any fail, 64 on
# usage.
#
# A test is named by its TITLE here, and grepping for a title is satisfied by
# `it.skip("…")`, by the title in a comment, and by a title with no handler —
# so a named SECURITY test ("read is denied") could be reported present with
# nothing running it (audit R2 #79). assert_test_title / assert_rust_test_fn
# read the parsed cases instead.
# `--root` points the assertions at a fixture tree (the self-test,
# scripts/check-terminal-edge-phase.test.mjs, proves the helpers both ways).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PHASE=""
for arg in "$@"; do
  case "$arg" in
    --root=*) ROOT="${arg#--root=}" ;;
    *)
      # Exactly one phase: a second positional used to silently replace the
      # first, so `2 3` checked phase 3 and reported it as what was asked.
      if [[ -n "$PHASE" ]]; then
        echo "Usage: $0 <phase-number> [--root=<dir>] (unexpected extra argument: $arg)"
        exit 64
      fi
      PHASE="$arg" ;;
  esac
done
cd "$ROOT" || exit 64

if [[ -z "$PHASE" ]]; then
  echo "Usage: $0 <phase-number> [--root=<dir>]"
  echo "  1  T1,T2,T3,T4,T6  correctness (EDITOR, panel size, font zoom, bell, root links)"
  echo "  2  T7,T8,T9,T10    truth (docs match code, terminal settings translated)"
  echo "  3  T11,T12,T13,T14 gaps (search, bash integration, OSC 52, serialize dep)"
  echo "  4  F1-F4,F6        features (rename, open-here, run-block, copy-output, maximize)"
  exit 64
fi

PASS=0; FAIL=0; FAIL_DETAIL=()
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
# A misspelled assertion used to be SILENT: bash printed "command not found"
# to stderr, the phase counted neither a pass nor a failure, and the check
# simply did not exist. Found live on 2026-09-08 — this script defines its own
# helpers and does not source scripts/lib/dod-assertions.sh, so a call to
# assert_grep_E (which exists only in that library) vanished. Fail loudly.
MISSING_HELPER_MARK="$(mktemp -t vmark-dod-missing)"
trap 'rm -f "$MISSING_HELPER_MARK"' EXIT
# bash runs this handler in a SUBSHELL, so incrementing FAIL here would not
# reach the summary — the cross would print and the script would still exit 0
# (measured 2026-09-08). Record it on disk instead and check at the end.
command_not_found_handle() { echo "  ✗ assertion helper '$1' is not defined in this script"; echo "$1" >> "$MISSING_HELPER_MARK"; return 1; }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); FAIL_DETAIL+=("$1"); }

# ONE matcher for the whole grep family — fixed or regex, present or absent.
#
# grep exits 0 for a match, 1 for none, and >1 when it could not LOOK: a
# missing target, an unreadable file, an invalid regex. Four wrappers branching
# on that status separately gave it two different answers — the negative pair
# checked existence and read status 2 as "grep failed", the positive pair
# checked neither and reported "pattern not in <file>" for a file that does not
# exist, which is a true verdict with a false reason. One matcher, one answer
# per status (audit R2 #80).
#
# _grep_match <present|absent> <grep flags> <noun> <pattern> <target> <label>
_grep_match() {
  local want="$1" flags="$2" noun="$3" pattern="$4" target="$5" label="$6" rc
  if [[ ! -e "$target" ]]; then fail "$label (target missing: $target)"; return; fi
  grep "$flags" -- "$pattern" "$target" 2>/dev/null; rc=$?
  if (( rc > 1 )); then fail "$label (grep failed with status $rc on $target)"
  elif [[ "$want" == present ]]; then
    if (( rc == 0 )); then ok "$label"; else fail "$label ($noun '$pattern' not in $target)"; fi
  elif (( rc == 1 )); then ok "$label"
  elif [[ "$noun" == pattern ]]; then fail "$label ($noun '$pattern' still present in $target)"
  else fail "$label ($noun '$pattern' still matches in $target)"; fi
}

# assert_grep <fixed-pattern> <file-or-dir> <label>
assert_grep() { _grep_match present -rqF pattern "$1" "$2" "$3"; }

# Syntax-aware probes for the assertions whose subject is a TEST. A grep for a
# test's TITLE is satisfied by `it.skip("…")`, by a title inside a comment, and
# by a title with no handler at all — so the phase could report a named
# behavioural or SECURITY test as present while nothing ran it (audit R2 #79).
# scripts/dod-syntax.mjs reads the parsed cases instead.
DOD_SYNTAX="$SCRIPT_DIR/dod-syntax.mjs"
# assert_test_title <title-substring> <file.test.ts(x)> <label>
assert_test_title() {
  if [[ ! -f "$2" ]]; then fail "$3 (test file missing: $2)"; return; fi
  if node "$DOD_SYNTAX" ts-has-test-case "$2" "$1" >/dev/null 2>&1; then ok "$3"
  else fail "$3 (no RUNNABLE it()/test() case titled '$1' in $2 — a skipped case, a title with no handler, a comment or a string does not count)"; fi
}
# assert_rust_test_fn <fn-name> <file.rs> <label> — the fn must be CODE, so a
# commented-out or string-quoted test function does not satisfy it.
assert_rust_test_fn() {
  if [[ ! -f "$2" ]]; then fail "$3 (test file missing: $2)"; return; fi
  if node "$DOD_SYNTAX" rust-code-grep "fn\\s+$1\\s*\\(" "$2" >/dev/null 2>&1; then ok "$3"
  else fail "$3 (no \`fn $1(\` in the CODE of $2 — a commented-out test does not count)"; fi
}

# assert_no_grep <fixed-pattern> <file-or-dir> <label> — the absence IS the
# contract, so the target must EXIST: grep on a missing file exits 2, which
# used to fall into the "absent" branch and pass the phase with the file gone.
# Status 1 is the only "not found"; anything else is grep failing to look.
assert_no_grep() { _grep_match absent -rqF pattern "$1" "$2" "$3"; }

# assert_re <ERE> <file> <label>
assert_re() { _grep_match present -rqE regex "$1" "$2" "$3"; }

# assert_no_re <ERE> <file> <label> — same existence and status contract as assert_no_grep.
assert_no_re() { _grep_match absent -rqE regex "$1" "$2" "$3"; }

# assert_file <path> <label>
assert_file() {
  if [[ -f "$1" ]]; then ok "$2"; else fail "$2 ($1 missing)"; fi
}

# assert_translated <en.json> <locale.json> <label> <key>... — every key must
# exist in BOTH bundles as a non-empty string, with a localized value that
# differs from the English one.
# The bundles are PARSED (node), not grepped: a grep for `": "English"` was
# only as good as the file's spacing, so a reformatted bundle could carry the
# English value and pass. Comparing BY KEY against en/ also keeps the check
# honest when an English value is reworded — a hardcoded English pattern would
# then match nothing and pass vacuously, which is how T10 survived so long. A
# missing or unparseable bundle is a failure, never a pass.
#
# Two ways it used to pass vacuously (audit R2 #81): an EMPTY localized string
# is a string and differs from the English one, and a key the ENGLISH bundle no
# longer has compared `"…" !== undefined` — so a renamed or deleted key read as
# translated in every locale. Values are compared TRIMMED, so whitespace alone
# is not a translation either.
assert_translated() {
  local en="$1" loc="$2" label="$3"; shift 3
  local out
  if out="$(node -e '
    const fs = require("node:fs");
    const [en, loc, ...keys] = process.argv.slice(1);
    try {
      const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
      const enBundle = read(en);
      const locBundle = read(loc);
      const text = (v) => (typeof v === "string" ? v.trim() : null);
      const missingEnglish = keys.filter((k) => text(enBundle[k]) === null || text(enBundle[k]) === "");
      if (missingEnglish.length) {
        console.log(`no English reference string: ${missingEnglish.join(", ")}`);
        process.exit(1);
      }
      const untranslated = keys.filter(
        (k) => text(locBundle[k]) === null || text(locBundle[k]) === "" || text(locBundle[k]) === text(enBundle[k]),
      );
      if (untranslated.length) {
        console.log(`still English, empty or missing: ${untranslated.join(", ")}`);
        process.exit(1);
      }
    } catch (e) {
      console.log(`could not compare: ${e.message}`);
      process.exit(2);
    }
  ' -- "$en" "$loc" "$@" 2>&1)"; then ok "$label"; else fail "$label ($out in $loc)"; fi
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
    # The env block moved from spawnPty.ts into terminalSpawnEnv.ts
    # (buildBaseTerminalEnv), and its test with it; spawnPty.ts must still
    # not grow an EDITOR of its own.
    assert_no_re '^[[:space:]]*EDITOR:' "$SPAWN" "WI-1.1 spawnPty no longer sets EDITOR"
    assert_no_re '^[[:space:]]*EDITOR:' "$SPAWNENV" "WI-1.1 terminalSpawnEnv does not set EDITOR either"
    assert_grep "TERM_PROGRAM: \"WezTerm\"" "$SPAWNENV" "WI-1.1 ADR-006 WezTerm impersonation preserved"
    assert_test_title "never sets EDITOR" "src/components/Terminal/terminalSpawnEnv.test.ts" "WI-1.1 RED test present"
    assert_no_grep "| \`EDITOR\` | \`vmark\` |" "$DOC" "WI-1.1 docs no longer advertise EDITOR=vmark"
    # WI-1.2 — panel size options stop at the enforced cap.
    assert_no_re '"0\.(6|7|8)"' "$HELPERS" "WI-1.2 panelSizeOptions stop at 50%"
    assert_grep "TERMINAL_MAX_RATIO" "$HELPERS" "WI-1.2 options derived from the enforced cap"
    assert_file "$HELPERS_TEST" "WI-1.2 terminalSettingsHelpers.test.ts present"
    assert_test_title "no option is silently clamped" "$HELPERS_TEST" "WI-1.2 no-silent-clamp test present"
    assert_test_title "snapToOption maps an over-cap ratio to the cap" "$HELPERS_TEST" "WI-1.2 legacy-ratio test present"
    # WI-1.3 — the font-size dropdown tolerates a zoomed value.
    assert_grep "fontSizeOptionsFor" "$HELPERS" "WI-1.3 fontSizeOptionsFor helper present"
    assert_grep "fontSizeOptionsFor" "src/pages/settings/TerminalSettings.tsx" "WI-1.3 settings UI uses it"
    assert_test_title "shows a zoomed font size not in the preset list" "src/pages/settings/TerminalSettings.test.tsx" "WI-1.3 zoomed-value test present"
    # WI-1.4 — one shared AudioContext.
    assert_grep "sharedAudioContext" "$BELL" "WI-1.4 module-scoped AudioContext"
    assert_no_grep "ctx.close()" "$BELL" "WI-1.4 context is never closed"
    assert_test_title "reuses a single AudioContext across bells" "src/components/Terminal/terminalBell.test.ts" "WI-1.4 reuse test present"
    # WI-1.5 — relative links resolve at the filesystem root.
    assert_grep "normalizeBase" "$LINKS" "WI-1.5 base normalization helper present"
    assert_test_title "resolves relative paths when the base is the filesystem root" "src/components/Terminal/fileLinkProvider.test.ts" "WI-1.5 root-base test present"
    ;;
  2)
    # WI-2.1 — the docs stop contradicting the code.
    assert_no_grep "| \`TERM_PROGRAM\` | \`vmark\` |" "$DOC" "WI-2.1 TERM_PROGRAM doc row corrected"
    assert_grep "WezTerm" "$DOC" "WI-2.1 docs name the real TERM_PROGRAM value"
    assert_grep "ADR-006" "$DOC" "WI-2.1 docs carry the ADR-006 reason"
    assert_no_grep "SIGSTOP" "$DOC" "WI-2.1 Pause/Resume vapor section removed"
    assert_grep "Not yet implemented" "$DOC" "WI-2.1 deferred capabilities noted honestly"
    assert_re '\| Mac Option as Meta \| On / Off \| On \|' "$DOC" "WI-2.1 Option-as-Meta default corrected to On"
    # WI-2.2 — the doc↔default drift guard. The Default half is the
    # settings-defaults doc join (WI-FL0.4: structural, both directions, both
    # settings pages); the Range half stayed in the app tier as
    # terminalDocRanges.test.ts. The transcription file it replaced is gone.
    assert_file "scripts/lib/docJoins/settingsDefaults.mjs" "WI-2.2 doc↔default drift guard present (settings-defaults doc join)"
    assert_grep "macOptionIsMeta" "scripts/lib/docJoins/settingsDefaultsRowMap.mjs" "WI-2.2 guard covers macOptionIsMeta"
    assert_grep "minimumContrastRatio" "scripts/lib/docJoins/settingsDefaultsRowMap.mjs" "WI-2.2 guard covers minimumContrastRatio"
    assert_file "src/pages/settings/__tests__/terminalDocRanges.test.ts" "WI-2.2 doc↔range guard present"
    # WI-2.3 — the stranded terminal strings are translated.
    assert_file "src/locales/__tests__/terminalI18nCoverage.test.ts" "WI-2.3 i18n coverage gate present"
    assert_test_title "has no terminal.* value left verbatim in English" "src/locales/__tests__/terminalI18nCoverage.test.ts" "WI-2.3 gate asserts value drift, not just key presence"
    assert_test_title "has no stale allow-list entry" "src/locales/__tests__/terminalI18nCoverage.test.ts" "WI-2.3 allow-list cannot rot"
    # The eight T10 strings — the keys terminalI18nCoverage.test.ts names — plus
    # the one statusbar string (fr), each compared BY KEY against en/ so the
    # check reads the real English value rather than a copy of it. Five values
    # used to be listed here as literal patterns: the three `.description`
    # strings were never checked, and the comment still said eight.
    T10_KEYS=(
      terminal.shellIntegration.label terminal.shellIntegration.description
      terminal.scrollback.label terminal.scrollback.description
      terminal.screenReaderMode.label terminal.screenReaderMode.description
      terminal.contrast.aa terminal.contrast.aaa
    )
    for loc in de es fr it ja ko pt-BR zh-CN zh-TW; do
      assert_translated "src/locales/en/settings.json" "src/locales/$loc/settings.json" "WI-2.3 $loc terminal settings strings translated" "${T10_KEYS[@]}"
    done
    assert_translated "src/locales/en/statusbar.json" "src/locales/fr/statusbar.json" "WI-2.3 fr maxSessions translated" terminal.maxSessions
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
    assert_test_title "forwards integration args" "src/components/Terminal/spawnPty.test.ts" "WI-3.3 spawn-args test present"
    # WI-3.4 — bash integration.
    assert_file "$BASH_RC" "WI-3.4 vmark.bash present"
    assert_grep "133;A" "$BASH_RC" "WI-3.4 bash rc emits OSC 133 A"
    assert_grep "133;C" "$BASH_RC" "WI-3.4 bash rc emits OSC 133 C"
    assert_grep "133;D" "$BASH_RC" "WI-3.4 bash rc emits OSC 133 D"
    assert_grep "7;file://" "$BASH_RC" "WI-3.4 bash rc emits OSC 7 cwd"
    assert_grep ".bashrc" "$BASH_RC" "WI-3.4 bash rc sources the user's rc"
    assert_grep "--rcfile" "$SHL" "WI-3.4 rcfile arg returned"
    assert_rust_test_fn "bash_script_preserves_existing_prompt_command" "$SHL_TEST" "WI-3.4 PROMPT_COMMAND composition test"
    assert_rust_test_fn "bash_script_sources_the_user_rc_and_composes_both_hooks" "$SHL_TEST" "WI-3.4 behavioral bash test (runs real bash)"
    assert_rust_test_fn "bash_script_reports_the_real_exit_code_and_cwd" "$SHL_TEST" "WI-3.4 exit-code behavioral test"
    assert_rust_test_fn "bash_env_returns_rcfile_arg" "$SHL_TEST" "WI-3.4 rcfile-arg test"
    assert_rust_test_fn "zsh_integration_returns_no_args" "$SHL_TEST" "WI-3.3 zsh byte-identical test"
    # WI-3.5 — OSC 52, write-only.
    assert_file "src/components/Terminal/setupOsc52.ts" "WI-3.5 setupOsc52 present"
    assert_file "src/components/Terminal/setupOsc52.test.ts" "WI-3.5 setupOsc52 tests present"
    assert_grep "@xterm/addon-clipboard" "package.json" "WI-3.5 clipboard addon dependency"
    assert_grep "osc52Clipboard" "src/stores/settingsStore/defaults.ts" "WI-3.5 setting default"
    assert_grep "osc52Clipboard" "src/stores/settingsTypes/system.ts" "WI-3.5 setting typed (persist guard derives from the default's type)"
    assert_test_title "drops a corrupt persisted osc52Clipboard" "src/pages/settings/__tests__/terminalDocRanges.test.ts" "WI-3.5 persist-boundary test"
    assert_grep "osc52Clipboard" "src/pages/settings/TerminalSettings.tsx" "WI-3.5 settings UI"
    assert_grep "terminal.osc52Clipboard.label" "src/locales/en/settings.json" "WI-3.5 i18n key"
    assert_test_title "read is denied" "src/components/Terminal/setupOsc52.test.ts" "WI-3.5 read-denial security test"
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
    assert_test_title "renames a session on Enter" "src/components/Terminal/TerminalTabBar.test.tsx" "WI-4.1 rename test present"
    # WI-4.2 — Open Terminal Here.
    assert_grep "openTerminalHere" "src/services/terminal/openTerminalHere.ts" "WI-4.2 service present"
    assert_grep "openTerminalHere" "src/components/Sidebar/FileExplorer/ContextMenu.tsx" "WI-4.2 context-menu entry"
    # The dispatch moved out of FileExplorer.tsx when its action wiring was
    # extracted (audit 20260907 #322); FileExplorer.tsx mounts the hook, and
    # the hook is where the context-menu action reaches the service. Match the
    # shorthand property, not the bare name: the name also appears on the
    # import line, so a bare-name grep stayed GREEN with the dispatch deleted
    # (mutation-verified 2026-09-08).
    assert_re "^[[:space:]]+openTerminalHere,[[:space:]]*$" "src/components/Sidebar/FileExplorer/useExplorerActionWiring.ts" "WI-4.2 action dispatched"
    assert_grep "useExplorerActionWiring" "src/components/Sidebar/FileExplorer/FileExplorer.tsx" "WI-4.2 wiring hook mounted"
    assert_test_title "does not appear for %s" "src/components/Sidebar/FileExplorer/ContextMenu.test.tsx" "WI-4.2 folders-only test"
    assert_grep "requestedCwd" "src/components/Terminal/useTerminalShellLifecycle.ts" "WI-4.2 explicit cwd beats sibling inheritance"
    # WI-4.3 — run a fenced shell block.
    assert_file "src/services/terminal/runInTerminal.ts" "WI-4.3 runInTerminal service present"
    # The action buttons moved out of nodeView.ts into nodeViewActions.ts; the
    # run button is the one labelled with the runInTerminal key.
    assert_grep "editor:plugin.runInTerminal" "src/plugins/codeBlockLineNumbers/nodeViewActions.ts" "WI-4.3 run button on the code block"
    assert_test_title "is NOT offered for a %j fence" "src/plugins/codeBlockLineNumbers/__tests__/codeBlockRunButton.test.ts" "WI-4.3 shell-only visibility test"
    assert_grep "isShellLanguage" "src/services/terminal/runInTerminal.ts" "WI-4.3 shell-language gate"
    assert_grep "extractTranscriptCommands" "src/services/terminal/runInTerminal.ts" "WI-4.3 transcript fences yield commands only, not output"
    assert_grep "isSafeToPaste" "src/services/terminal/runInTerminal.ts" "WI-4.3 bracketed-paste safety check"
    assert_test_title "REFUSES a multi-line payload when bracketed paste is OFF" "src/services/terminal/runInTerminal.test.ts" "WI-4.3 multi-line refusal test"
    assert_grep "never auto-execute" "src/services/terminal/runInTerminal.ts" "WI-4.3 no-newline security boundary documented"
    assert_test_title "does not append a newline" "src/services/terminal/runInTerminal.test.ts" "WI-4.3 no-auto-execute test"
    # WI-4.4 — Copy Command Output.
    assert_grep "commandOutputRange" "src/components/Terminal/setupOsc.ts" "WI-4.4 range helper present"
    assert_file "src/components/Terminal/commandOutputRange.test.ts" "WI-4.4 range tests present"
    assert_test_title "excludes the prompt line from the copied range" "src/components/Terminal/commandOutputRange.test.ts" "WI-4.4 prompt-exclusion test"
    assert_test_title "runs to the buffer end for the last (still open) command" "src/components/Terminal/commandOutputRange.test.ts" "WI-4.4 open-command test"
    assert_grep "copyCommandOutput" "src/components/Terminal/TerminalContextMenu.tsx" "WI-4.4 context-menu entry"
    # WI-4.5 — maximize toggle.
    assert_grep "toggleMaximize" "src/components/Terminal/useTerminalResize.ts" "WI-4.5 maximize toggle present"
    assert_test_title "restores the STORED ratio on a second toggle" "src/components/Terminal/useTerminalResize.test.ts" "WI-4.5 restore test present"
    assert_test_title "never rewrites the persisted panelRatio" "src/components/Terminal/useTerminalResize.test.ts" "WI-4.5 no-persist test present"
    assert_grep "onDoubleClick" "src/components/Terminal/TerminalPanel.tsx" "WI-4.5 resize handle double-click wired"
    ;;
  *)
    echo "Unknown phase: $PHASE"; exit 64 ;;
esac

echo ""
MISSING=$(wc -l < "$MISSING_HELPER_MARK" | tr -d " ")
echo "Phase $PHASE: $PASS passed, $FAIL failed."
if (( MISSING > 0 )); then
  echo "  $MISSING assertion(s) named a helper this script does not define — they checked NOTHING."
  sort -u "$MISSING_HELPER_MARK" | sed 's/^/    - /'
  exit 1
fi
if (( FAIL > 0 )); then
  printf '  - %s\n' "${FAIL_DETAIL[@]}"
  exit 1
fi
exit 0
