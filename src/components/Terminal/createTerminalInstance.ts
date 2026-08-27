/**
 * createTerminalInstance
 *
 * Purpose: Factory function that creates a fully-configured xterm.js instance
 * with all addons loaded (fit, search, unicode11, webgl, web-links, file-links)
 * plus OSC handlers (cwd) and custom key handling.
 *
 * Key decisions:
 *   - Construction is TRANSACTIONAL (see resourceStack): every acquisition
 *     registers its release, and a throw part-way unwinds them in reverse.
 *     `dispose()` is that same unwind, so normal teardown and failure
 *     rollback cannot drift apart.
 *   - Option normalization lives in terminalOptions.ts, so this file reads as
 *     a lifecycle (acquire → wire → release) rather than option tuning.
 *   - The mono font handed to xterm is MEASURED, never assumed. xterm sizes its
 *     character cell from the advance of a `W`, so a stack that resolves to a
 *     proportional font spaces the whole grid out — which is what WebKitGTK
 *     does under a CJK locale (#1334). See services/fonts/verifiedMonoStack.
 *   - Each instance gets its own child div inside the parent container,
 *     initially hidden; the caller (useTerminalSessions) toggles visibility
 *     when switching sessions.
 *   - macOptionIsMeta is enabled so macOS Option+Arrow keys generate
 *     proper Alt-modifier escape sequences for word movement (#660).
 *   - minimumContrastRatio (settings.minimumContrastRatio, default 4.5 = WCAG
 *     AA) makes xterm dynamically lift foreground per-cell when an app paints
 *     low-contrast bg+fg (e.g. Claude Code's chalk.bgCyan.black tag on a light
 *     theme). User-adjustable for accessibility; clamped to xterm's 1–21 range.
 *   - Theme colors are resolved via buildXtermTheme() from terminalTheme.ts;
 *     runtime theme changes are handled by useTerminalSessions.
 *   - Lifecycle concerns are split into focused helpers, each returning a
 *     cleanup hook the factory calls in dispose():
 *       * setupImeCompositionGate — Channel Ownership IME handling (one writer)
 *       * setupWebglRenderer   — WebGL addon, atlas bounding (#856),
 *         dual-layer context-loss recovery, MutationObserver, resetDisplay
 *       * setupWebLinks        — sandboxed web-link click handler
 *       * setupFileLinks       — file-link click handler with size guard
 *       * setupOsc7            — OSC 7 cwd tracking (exposes getCwd)
 *       * setupCopyOnSelect    — debounced clipboard write on selection
 *       * setupOsc52           — OSC 52 clipboard, WRITE-ONLY (reads denied)
 *
 * @coordinates-with useTerminalSessions.ts — caller that manages instance lifecycle
 * @coordinates-with terminalTheme.ts — per-theme ANSI color palettes for xterm.js
 * @coordinates-with terminalKeyHandler.ts — custom Cmd+C/V/K/F handling
 * @coordinates-with TerminalContextMenu.tsx — exposes resetDisplay() as a menu action
 * @module components/Terminal/createTerminalInstance
 */
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { SearchAddon } from "@xterm/addon-search";
import { createTerminalKeyHandler } from "./terminalKeyHandler";
import { setupWebglRenderer } from "./setupWebglRenderer";
import {
  setupImeCompositionGate,
  createNoopImeHandle,
} from "./setupImeCompositionGate";
import { setupWebLinks } from "./setupWebLinks";
import { setupFileLinks } from "./setupFileLinks";
import { setupCopyOnSelect } from "./setupCopyOnSelect";
import { setupOsc52 } from "./setupOsc52";
import {
  setupOsc7,
  setupOsc133,
  scrollToAdjacentCommand,
  type CommandMark,
} from "./setupOsc";
import { resolveHelperTextarea } from "./resolveHelperTextarea";
import { maybeInstallDevInputTrace } from "./terminalInputTrace";
import { createResourceStack } from "./resourceStack";
import {
  buildTerminalOptions,
  type TerminalInstanceSettings,
} from "./terminalOptions";

import { getRuntimePlatform } from "@/utils/platform";
import { verifiedMonoStack } from "@/services/fonts/verifiedMonoStack";

import "@xterm/xterm/css/xterm.css";

// Re-exports kept for compatibility with existing imports/tests.
export { ATLAS_PAGE_LIMIT } from "./setupWebglRenderer";

/** Resolve the --font-mono CSS variable to actual font family names, used at
 *  terminal creation (the var is already applied by then). Live mono-font
 *  changes are handled by terminalSessionStoreSync, which resolves the stack
 *  straight from the monoFont setting via resolveMonoFontStack (the CSS var
 *  lags inside the store subscriber).
 *
 *  Both paths are MEASURED, not trusted. `--font-mono` is written by useTheme,
 *  which already verifies it; the fallback verifies its own stack rather than
 *  hardcoding a literal. A proportional font reaching xterm sizes every cell
 *  from the advance of a `W` and spaces the whole grid out (#1334). */
function resolveMonoFont(): string {
  const style = getComputedStyle(document.documentElement);
  const mono = style.getPropertyValue("--font-mono").trim();
  return mono || verifiedMonoStack("system", getRuntimePlatform());
}

/** A fully-configured xterm.js terminal with its addons and container element. */
export interface TerminalInstance {
  term: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  container: HTMLDivElement;
  /** True while an IME composition is active. */
  composing: boolean;
  /**
   * Callback invoked with the clean committed text after IME composition ends.
   * Set by useTerminalSessions to write directly to PTY (single writer).
   */
  onCompositionCommit: ((text: string) => void) | null;
  /** Report a byte-run the wiring actually forwarded from onData to the PTY
   *  — feeds the gate's write-derived insert ownership (WI-13). */
  noteExternalWrite: (data: string) => void;
  /**
   * User-triggered "redraw the terminal" action (#856). Clears the WebGL
   * texture atlas (if WebGL is active) and re-paints the viewport. Safe to
   * call when the WebGL addon is absent or already disposed — it then
   * just refreshes the viewport via the DOM renderer.
   */
  resetDisplay: () => void;
  /** The shell's last-reported cwd via OSC 7, or null if never reported (WI-2.1). */
  getCwd: () => string | null;
  /** Command marks from OSC 133 (prompt line + exit code) for prompt nav and
   *  exit-status decorations (WI-3.2). Empty without shell integration. */
  getCommands: () => CommandMark[];
  /** True while a foreground command is running (OSC 133 C→D). False without
   *  shell integration. Used to avoid injecting `cd` into a busy shell. */
  isShellBusy: () => boolean;
  /** Register a callback fired when the shell returns to idle (OSC 133 done /
   *  next prompt). Used to flush a deferred workspace `cd` that was skipped
   *  while a foreground command ran. Pass null to clear. No-op without shell
   *  integration. */
  setOnShellIdle: (cb: (() => void) | null) => void;
  dispose: () => void;
}

interface CreateOptions {
  parentEl: HTMLElement;
  settings: TerminalInstanceSettings;
  ptyRef: React.RefObject<import("@/lib/pty").IPty | null>;
  onSearch: () => void;
  /** Fired when the shell rings the bell (BEL / OSC) — drives the background
   *  activity indicator (WI-4.3). */
  onBell?: () => void;
}

/**
 * Create a terminal instance with all addons loaded.
 * Appends a child div to parentEl and opens xterm in it.
 */
export function createTerminalInstance(
  options: CreateOptions,
): TerminalInstance {
  const { parentEl, settings, ptyRef, onSearch, onBell } = options;

  // Rollback stack (audit): several steps below can throw, and without
  // unwinding, the container stays in the DOM and the xterm instance stays
  // alive — a leak per failed session. Normal teardown uses the SAME stack, so
  // the success and failure paths cannot drift apart.
  const resources = createResourceStack("terminal setup");
  const release = resources.releaseAll;

  // Create child container
  const container = document.createElement("div");
  container.style.width = "100%";
  container.style.height = "100%";
  container.style.display = "none"; // Hidden initially; caller shows it
  parentEl.appendChild(container);
  resources.acquire(() => container.parentElement?.removeChild(container));

  try {
    // Create terminal
    const term = new Terminal(
      buildTerminalOptions(settings, resolveMonoFont()),
    );
    resources.acquire(() => term.dispose());

    // Built-in addons
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);

    // Open terminal — must come before the helpers that query DOM children
    // (IME textarea, WebGL canvases).
    term.open(container);

    // Resolve + validate the helper textarea via the public getter, failing loud
    // (WI-1.1/1.2). Dev throws on a missing/misplaced textarea; prod logs and
    // returns undefined, in which case we install a no-op IME handle so the
    // terminal still works (the old `textarea!` path crashed on addEventListener).
    const textarea = resolveHelperTextarea(term, container);
    // Channel Ownership is the only input path (WI-4b removed the legacy dual-writer
    // path). A missing textarea (prod fail-loud) → inert no-op handle.
    const ime = textarea
      ? setupImeCompositionGate({ container, textarea })
      : createNoopImeHandle();
    resources.acquire(() => ime.cleanup());

    // Dev-only input-trace recorder (no-op in prod / unless the localStorage flag
    // is set). Lets a human capture real IME traces by typing — plan WI-0.1.
    const detachInputTrace = textarea
      ? maybeInstallDevInputTrace(textarea)
      : () => {};
    resources.acquire(() => detachInputTrace());

    // Unicode 11 must be loaded before any heavy text rendering.
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";

    const webgl = setupWebglRenderer({
      term,
      container,
      enabled: !!settings.useWebGL,
    });
    resources.acquire(() => webgl.cleanup());

    // OSC 7 cwd tracking — feeds relative file-link resolution (WI-2.1/2.3).
    const osc = setupOsc7(term);
    // OSC 133 command boundaries — prompt nav + exit-status decorations (WI-3.2).
    const osc133 = setupOsc133(term);

    // Bell → background-activity indicator (WI-4.3).
    if (onBell) term.onBell(() => onBell());

    setupWebLinks(term);
    setupFileLinks(term, osc.getCwd);

    term.attachCustomKeyEventHandler(
      createTerminalKeyHandler(term, ptyRef, {
        onSearch,
        onPromptNav: (dir) =>
          scrollToAdjacentCommand(term, osc133.getCommands(), dir),
        // Live getter so the key handler sees the composition state; without it,
        // Shift+Enter / Cmd+C / etc. right after a CJK commit would leak past T2.
        isComposing: () => ime.composing,
      }),
    );

    const cleanupCopyOnSelect = setupCopyOnSelect({
      term,
      isComposing: () => ime.composing,
    });
    resources.acquire(() => cleanupCopyOnSelect());

    // OSC 52 clipboard (WI-3.5): write-only by design — see setupOsc52 for why
    // read is denied even when this setting is on.
    const cleanupOsc52 = setupOsc52(term, settings.osc52Clipboard);
    resources.acquire(() => cleanupOsc52());

    // Normal teardown IS the rollback stack, so the success and failure paths
    // can never drift apart (they used to be two hand-maintained lists).
    const dispose = release;

    return {
      term,
      fitAddon,
      searchAddon,
      container,
      dispose,
      resetDisplay: webgl.resetDisplay,
      getCwd: osc.getCwd,
      getCommands: osc133.getCommands,
      isShellBusy: osc133.isRunning,
      setOnShellIdle: osc133.setOnIdle,
      get composing() {
        return ime.composing;
      },
      get onCompositionCommit() {
        return ime.onCompositionCommit;
      },
      set onCompositionCommit(cb: ((text: string) => void) | null) {
        ime.onCompositionCommit = cb;
      },
      noteExternalWrite: (data: string) => ime.noteExternalWrite(data),
    };
  } catch (error) {
    // Partial construction must not leak: unwind what was acquired, then let
    // the caller see the real failure.
    release();
    throw error;
  }
}
