/**
 * terminalKeyHandler
 *
 * Purpose: Custom key event handler for the integrated terminal. Intercepts
 * Cmd/Ctrl shortcuts that should not pass through to the shell process.
 *
 * Key decisions:
 *   - Cmd+C with selection → copy to clipboard; without selection → pass through
 *     for SIGINT (Ctrl+C), maintaining standard terminal behavior.
 *   - Cmd+V → paste from clipboard directly into PTY (not xterm buffer).
 *   - Cmd+K → clear terminal scrollback and viewport.
 *   - The configured Toggle-Terminal binding (default Ctrl+`) → toggle and fully
 *     consume the event, so a CJK IME's remapped "·" never reaches the shell and
 *     the window handler doesn't double-toggle. Skipped during composition/grace.
 *   - Cmd+F → toggle search bar in the terminal panel (preventDefault so the
 *     native Find accelerator doesn't ALSO open the editor FindBar).
 *   - Cmd+1-5 → switch between terminal sessions (up to 5).
 *   - macOS cursor/line-editing chords (Cmd+Left/Right, Cmd+Backspace,
 *     Option+Left/Right) → readline control bytes. See terminalReadlineKeys.ts.
 *   - Cmd +/-/0 → zoom the terminal font (terminal.fontSize), preventDefault so
 *     the native zoom accelerator doesn't zoom the editor font instead.
 *   - Cmd/Ctrl+Up/Down → jump to previous/next command prompt (WI-3.3, requires
 *     shell integration; no-op when there are no command marks).
 *   - Shift+Enter → emits the CSI-u sequence "\x1b[13;2u" (codepoint 13 with
 *     modifier 2 = Shift) so CLI tools that key off TERM_PROGRAM=WezTerm
 *     (Claude Code, etc.) actually receive a distinguishable newline signal.
 *     Without this, xterm's default would send a plain "\r", indistinguishable
 *     from Enter — making the WezTerm impersonation in spawnPty.ts a lie and
 *     breaking the "newline in input" affordance these tools advertise as
 *     "natively supported in WezTerm."
 *   - Returns false to consume the event, true to let xterm handle it.
 *   - Never interferes during IME composition. Uses TWO checks:
 *       1) `isImeKeyEvent(event)` — covers active composition keystrokes
 *          (event.isComposing === true, or keyCode 229).
 *       2) `callbacks.isComposing()` — covers the post-`compositionend`
 *          grace window where browsers fire a follow-up keydown for the
 *          confirming key with `isComposing === false` but the IME is
 *          still settling. The terminal-wide handle in setupImeComposition
 *          keeps `composing=true` through that window (default 80 ms).
 *     Without (2), Shift+Enter / Cmd+C / Cmd+V immediately after a CJK
 *     commit would leak past the guard and write to the PTY.
 *
 * @coordinates-with createTerminalInstance.ts — attached via term.attachCustomKeyEventHandler
 * @coordinates-with setupImeComposition.ts — provides the `isComposing` callback (covers grace window)
 * @module components/Terminal/terminalKeyHandler
 */
import type { IPty } from "@/lib/pty";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Terminal } from "@xterm/xterm";
import { useUIStore } from "@/stores/uiStore";
import { useSettingsStore, useShortcutsStore } from "@/stores/settingsStore";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { isMacPlatform, matchesShortcutEvent } from "@/utils/shortcutMatch";
import { clipboardWarn } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";
import { requestToggleTerminal } from "./terminalGate";
import { handleReadlineNavKey } from "./terminalReadlineKeys";

/** Terminal font-zoom step and reset value. `terminal.fontSize` default is 13
 *  (settingsStore/defaults.ts); the store clamps to the terminal range [8,32]. */
const TERMINAL_FONT_SIZE_STEP = 2;
const DEFAULT_TERMINAL_FONT_SIZE = 13;

/** Nudge the terminal font size; the store clamps to the valid range. */
function adjustTerminalFontSize(delta: number): void {
  const current = useSettingsStore.getState().terminal.fontSize;
  useSettingsStore.getState().updateTerminalSetting("fontSize", current + delta);
}

/** Callbacks provided to the terminal key handler for non-shell actions. */
export interface KeyHandlerCallbacks {
  onSearch: () => void;
  /**
   * Returns true while a composition is active OR within the post-end grace
   * period. Sourced from setupImeComposition's `ImeCompositionHandle.composing`
   * getter. Without this, the post-`compositionend` keystroke window would
   * leak past the IME guard and fire shortcuts during CJK commit.
   */
  isComposing: () => boolean;
  /** Jump to the previous/next command prompt (WI-3.3, shell integration). */
  onPromptNav?: (direction: "prev" | "next") => void;
  /**
   * Flush a pending post-`compositionend` IME commit NOW. Called when the toggle
   * chord fires during the grace window so committed text reaches the terminal
   * before the panel hides, instead of the grace timer writing it into a hidden
   * shell (WI-1.4). Optional so non-terminal callers/tests can omit it.
   */
  flushImeCommit?: () => void;
  /**
   * True when the terminal runs in Channel-Ownership (gate) mode. Turns on T2:
   * IME (keyCode-229) keydowns are CONSUMED so xterm's DEL hazard never fires;
   * the gate's container listener delivers the character. Undefined/false =
   * legacy behavior (xterm handles IME keys).
   */
  gateMode?: boolean;
}

/**
 * Create a custom key event handler for the terminal.
 * Handles Cmd+C (copy/SIGINT), Cmd+V (paste), Cmd+K (clear), Cmd+F (search),
 * Cmd+1-5 (switch tab).
 * Returns a handler for `term.attachCustomKeyEventHandler()`.
 */
export function createTerminalKeyHandler(
  term: Terminal,
  ptyRef: React.RefObject<IPty | null>,
  callbacks: KeyHandlerCallbacks,
): (event: KeyboardEvent) => boolean {
  return (event: KeyboardEvent): boolean => {
    if (event.type !== "keydown") return true;

    // Toggle-Terminal: own the CONFIGURED binding here and FULLY consume the
    // event — matchesShortcutEvent resolves the physical Backquote even when a
    // CJK IME remaps it to "·", and honours a custom binding.
    //
    // WI-1.4: ALWAYS stopPropagation on a match, even during composition/grace.
    // Previously this branch abstained during grace (returned true below), but
    // xterm's keyCode-229 keydown does not cancel the event, so it bubbled to
    // the WINDOW handler, which toggled the panel anyway — while a pending IME
    // commit was armed, stranding text in the now-hidden shell (audit: high).
    // Owning the event here makes the toggle fire exactly once. During the grace
    // window we flush the pending commit into the still-visible terminal first;
    // during a REAL active composition (event.isComposing) the Backquote is IME
    // input, so we swallow it without toggling.
    if (
      matchesShortcutEvent(event, useShortcutsStore.getState().getShortcut("toggleTerminal"))
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (event.isComposing) return false; // real composition — swallow, no toggle
      if (callbacks.isComposing()) callbacks.flushImeCommit?.();
      requestToggleTerminal();
      return false;
    }

    // Never interfere during IME composition (CJK input, etc.).
    // Two-layer guard — see module header for rationale.
    // T2 (gate mode): CONSUME keyCode-229 IME keydowns (return false) so xterm's
    // _keyDown never reaches _handleAnyTextareaChanges — that snapshot-and-DEL is
    // the gate design's one remaining hazard. The character still reaches the PTY
    // via the gate's container `input`/composition path (T1); returning false
    // does not preventDefault, so the DOM input event still fires. In LEGACY mode
    // we return true (let xterm handle) exactly as before.
    if (isImeKeyEvent(event)) return callbacks.gateMode ? false : true;
    if (callbacks.isComposing()) return true;

    // Shift+Enter — emit the CSI-u sequence so the WezTerm impersonation
    // (TERM_PROGRAM=WezTerm in spawnPty.ts) is honest. Scoped to plain
    // Shift+Enter only; Alt/Ctrl/Cmd combos with Enter fall through.
    if (
      event.key === "Enter"
      && event.shiftKey
      && !event.metaKey
      && !event.ctrlKey
      && !event.altKey
    ) {
      event.preventDefault();
      ptyRef.current?.write("\x1b[13;2u");
      return false;
    }

    // macOS cursor/line-editing chords → readline control bytes (Option+arrow,
    // Cmd+arrow, Cmd+Backspace). Conditions are mutually exclusive and each
    // requires a specific modifier, so this is safe before the generic gate
    // below. See terminalReadlineKeys.ts.
    if (handleReadlineNavKey(event, ptyRef)) return false;

    // On macOS, Ctrl is a shell/readline modifier (Ctrl+A line-start, Ctrl+K
    // kill-line, Ctrl+R, Ctrl+W, …) — only Cmd triggers VMark host shortcuts.
    // Let Ctrl-only combos pass straight through to the PTY so those keys keep
    // working; Cmd combos still match below. (Windows/Linux keep Ctrl as the
    // host modifier — pre-existing behavior.)
    if (isMacPlatform() && event.ctrlKey && !event.metaKey) return true;

    const isMod = event.metaKey || event.ctrlKey;
    if (!isMod) return true;

    // Prompt navigation (WI-3.3): Cmd/Ctrl + Up/Down jumps between command
    // prompts (requires shell integration; no-op otherwise). Plain arrows fall
    // through to the shell for history.
    if (
      callbacks.onPromptNav
      && !event.shiftKey
      && (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault();
      callbacks.onPromptNav(event.key === "ArrowUp" ? "prev" : "next");
      return false;
    }

    if (event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "c") {
      // macOS: Cmd+C handles copy, so Ctrl+C should always pass through for SIGINT.
      // Windows/Linux: Ctrl+C should copy if there is a selection, otherwise pass through for SIGINT.
      if (isMacPlatform()) return true;
      if (!term.hasSelection()) return true;
    }

    switch (event.key.toLowerCase()) {
      case "c": {
        if (term.hasSelection()) {
          writeText(term.getSelection().trimEnd()).catch((error: unknown) => {
            clipboardWarn("Clipboard write failed:", errorMessage(error));
          });
          term.clearSelection();
          return false;
        }
        // No selection — pass through for SIGINT
        return true;
      }
      case "v": {
        // Prevent the browser's native paste on xterm's hidden textarea,
        // which would cause a second write to PTY (double-paste bug).
        event.preventDefault();
        // Route through term.paste so xterm applies bracketed-paste wrapping
        // when the app enabled it — multiline paste won't auto-execute (G2).
        readText().then((text) => {
          if (text) {
            term.paste(text);
          }
        }).catch((error: unknown) => {
          clipboardWarn("Clipboard read failed:", errorMessage(error));
        });
        return false;
      }
      case "k": {
        term.clear();
        return false;
      }
      case "f": {
        // Terminal search is plain Cmd/Ctrl+F only. Cmd/Ctrl+Shift+F is the
        // "Format CJK Selection" accelerator and Alt variants belong to other
        // menu commands — let those fall through (return true, no preventDefault)
        // so their native accelerators fire instead of opening terminal search.
        if (event.shiftKey || event.altKey) return true;
        // preventDefault suppresses the native Edit-menu "Find" accelerator
        // (CmdOrCtrl+F). Without it, the accelerator ALSO fires and opens the
        // editor FindBar, so the terminal search appeared "not wired".
        event.preventDefault();
        callbacks.onSearch();
        return false;
      }
      // Cmd +/-/0 → zoom the TERMINAL font, not the editor. These are native
      // menu accelerators (view_menu.rs) that otherwise mutate the editor's
      // appearance.fontSize regardless of focus; preventDefault suppresses the
      // accelerator while the terminal owns focus and drives terminal.fontSize
      // instead (live-applied by terminalSessionStoreSync). Reject Alt: the
      // Alt+CmdOrCtrl+= (subscript) and Alt+CmdOrCtrl+- (horizontal-line)
      // accelerators must fall through, not be eaten as terminal zoom. Shift is
      // fine — Shift+= produces "+", a legitimate zoom-in chord.
      case "=":
      case "+": {
        if (event.altKey) return true;
        event.preventDefault();
        adjustTerminalFontSize(TERMINAL_FONT_SIZE_STEP);
        return false;
      }
      case "-": {
        if (event.altKey) return true;
        event.preventDefault();
        adjustTerminalFontSize(-TERMINAL_FONT_SIZE_STEP);
        return false;
      }
      case "0": {
        if (event.altKey) return true;
        event.preventDefault();
        useSettingsStore
          .getState()
          .updateTerminalSetting("fontSize", DEFAULT_TERMINAL_FONT_SIZE);
        return false;
      }
      case "a": {
        // Cmd+A inside the terminal — scope the select-all to the terminal
        // buffer. Without this, the event falls through to xterm's hidden
        // textarea and then to the browser's page-wide selectAll, which
        // highlights every visible element including the editor and
        // sidebar.
        event.preventDefault();
        term.selectAll();
        return false;
      }
      case "1": case "2": case "3": case "4": case "5": {
        event.preventDefault();
        const idx = parseInt(event.key, 10) - 1;
        const { sessions } = useUIStore.getState().terminal;
        const setActiveSession = useUIStore.getState().terminalSetActiveSession;
        if (idx < sessions.length) {
          setActiveSession(sessions[idx].id);
        }
        return false;
      }
      default:
        return true;
    }
  };
}
