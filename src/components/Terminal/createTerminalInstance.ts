/**
 * createTerminalInstance
 *
 * Purpose: Factory function that creates a fully-configured xterm.js instance
 * with all addons loaded (fit, search, serialize, unicode11, webgl, web-links,
 * file-links) and custom key handling.
 *
 * Key decisions:
 *   - Each instance gets its own child div inside the parent container,
 *     initially hidden; the caller (useTerminalSessions) toggles visibility
 *     when switching sessions.
 *   - macOptionIsMeta is enabled so macOS Option+Arrow keys generate
 *     proper Alt-modifier escape sequences for word movement (#660).
 *   - minimumContrastRatio is set to 4.5 (WCAG AA) so xterm dynamically
 *     lifts foreground per-cell when an app paints low-contrast bg+fg
 *     (e.g. Claude Code's chalk.bgCyan.black tag on a light theme).
 *   - Theme colors are resolved via buildXtermTheme() from terminalTheme.ts;
 *     runtime theme changes are handled by useTerminalSessions.
 *   - Lifecycle concerns are split into focused helpers, each returning a
 *     cleanup hook the factory calls in dispose():
 *       * setupImeComposition  — IME compositionstart/end handling (#59,
 *         #454, #525, #608, #619, #659)
 *       * setupWebglRenderer   — WebGL addon, atlas bounding (#856),
 *         dual-layer context-loss recovery, MutationObserver, resetDisplay
 *       * setupWebLinks        — sandboxed web-link click handler
 *       * setupFileLinks       — file-link click handler with size guard
 *       * setupCopyOnSelect    — debounced clipboard write on selection
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
import { SerializeAddon } from "@xterm/addon-serialize";
import { createTerminalKeyHandler } from "./terminalKeyHandler";
import { buildXtermTheme } from "./terminalTheme";
import { setupWebglRenderer } from "./setupWebglRenderer";
import { setupImeComposition, IME_COMPOSITION_GRACE_MS } from "./setupImeComposition";
import { setupWebLinks } from "./setupWebLinks";
import { setupFileLinks } from "./setupFileLinks";
import { setupCopyOnSelect } from "./setupCopyOnSelect";

import "@xterm/xterm/css/xterm.css";

// Re-exports kept for compatibility with existing imports/tests.
export { ATLAS_PAGE_LIMIT } from "./setupWebglRenderer";
export { IME_COMPOSITION_GRACE_MS } from "./setupImeComposition";
/** Milliseconds after onCompositionCommit during which duplicate onData is suppressed. */
export const IME_DEDUP_WINDOW_MS = 150;

/** Resolve --font-mono CSS variable to actual font family names. */
function resolveMonoFont(): string {
  const style = getComputedStyle(document.documentElement);
  const mono = style.getPropertyValue("--font-mono").trim();
  return mono || "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace";
}

/** A fully-configured xterm.js terminal with its addons and container element. */
export interface TerminalInstance {
  term: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  serializeAddon: SerializeAddon;
  container: HTMLDivElement;
  /** Whether an IME composition is active or in post-composition grace period. */
  composing: boolean;
  /** Whether we are specifically in the post-composition grace period (not actively composing). */
  inGracePeriod: boolean;
  /**
   * Callback invoked with the clean committed text after IME composition ends.
   * Set by useTerminalSessions to write directly to PTY, bypassing xterm's
   * onData which may inject spaces (macOS Chinese IME: "claude" → "cl au de").
   */
  onCompositionCommit: ((text: string) => void) | null;
  /** Last text committed via onCompositionCommit — used for dedup against late onData (#525). */
  lastCommittedText: string | null;
  /** Timestamp (Date.now()) of the last onCompositionCommit — dedup window check (#525). */
  lastCommitTime: number;
  /**
   * User-triggered "redraw the terminal" action (#856). Clears the WebGL
   * texture atlas (if WebGL is active) and re-paints the viewport. Safe to
   * call when the WebGL addon is absent or already disposed — it then
   * just refreshes the viewport via the DOM renderer.
   */
  resetDisplay: () => void;
  dispose: () => void;
}

/** User-configurable settings for creating a terminal instance. */
export interface TerminalInstanceSettings {
  fontSize: number;
  lineHeight: number;
  cursorStyle: "block" | "underline" | "bar";
  cursorBlink: boolean;
  useWebGL: boolean;
  macOptionIsMeta: boolean;
}

interface CreateOptions {
  parentEl: HTMLElement;
  settings: TerminalInstanceSettings;
  ptyRef: React.RefObject<import("@/lib/pty").IPty | null>;
  onSearch: () => void;
}

// Suppress the "unused" lint when nothing in this file references the
// re-exported constant directly — consumers import it from this module path.
void IME_COMPOSITION_GRACE_MS;

/**
 * Create a terminal instance with all addons loaded.
 * Appends a child div to parentEl and opens xterm in it.
 */
export function createTerminalInstance(options: CreateOptions): TerminalInstance {
  const { parentEl, settings, ptyRef, onSearch } = options;

  // Create child container
  const container = document.createElement("div");
  container.style.width = "100%";
  container.style.height = "100%";
  container.style.display = "none"; // Hidden initially; caller shows it
  parentEl.appendChild(container);

  // Create terminal
  const term = new Terminal({
    theme: buildXtermTheme(),
    fontFamily: resolveMonoFont(),
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    cursorStyle: settings.cursorStyle,
    cursorBlink: settings.cursorBlink,
    macOptionIsMeta: settings.macOptionIsMeta,
    // Per-cell foreground lift when an app paints a filled tag
    // (e.g. Claude Code statusline: `chalk.bgCyan.black`). Light-theme ANSI
    // palettes are tuned for colors-as-foreground, so a dark cyan bg paired
    // with a dark-charcoal fg leaves text unreadable. xterm dynamically lifts
    // the foreground to meet WCAG AA against the actual background color.
    minimumContrastRatio: 4.5,
    allowProposedApi: true,
    scrollback: 5000,
  });

  // Built-in addons
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  const searchAddon = new SearchAddon();
  term.loadAddon(searchAddon);
  const serializeAddon = new SerializeAddon();
  term.loadAddon(serializeAddon);

  // Open terminal — must come before the helpers that query DOM children
  // (IME textarea, WebGL canvases).
  term.open(container);

  // Lifecycle helpers (each returns its own cleanup or exposes a cleanup()).
  const ime = setupImeComposition({ container });

  // Unicode 11 must be loaded before any heavy text rendering.
  const unicode11 = new Unicode11Addon();
  term.loadAddon(unicode11);
  term.unicode.activeVersion = "11";

  const webgl = setupWebglRenderer({
    term,
    container,
    enabled: !!settings.useWebGL,
  });

  setupWebLinks(term);
  setupFileLinks(term);

  term.attachCustomKeyEventHandler(
    createTerminalKeyHandler(term, ptyRef, {
      onSearch,
      // Closes over `ime.composing` (live getter) so the key handler
      // sees the post-`compositionend` grace window, not just active
      // composition. Without this, Shift+Enter / Cmd+C / etc. fired
      // immediately after a CJK commit would leak past the IME guard.
      isComposing: () => ime.composing,
    }),
  );

  const cleanupCopyOnSelect = setupCopyOnSelect({
    term,
    isComposing: () => ime.composing,
  });

  const dispose = () => {
    cleanupCopyOnSelect();
    ime.cleanup();
    webgl.cleanup();
    term.dispose();
    if (container.parentElement) {
      container.parentElement.removeChild(container);
    }
  };

  return {
    term,
    fitAddon,
    searchAddon,
    serializeAddon,
    container,
    dispose,
    resetDisplay: webgl.resetDisplay,
    get composing() { return ime.composing; },
    get inGracePeriod() { return ime.inGracePeriod; },
    get onCompositionCommit() { return ime.onCompositionCommit; },
    set onCompositionCommit(cb: ((text: string) => void) | null) {
      ime.onCompositionCommit = cb;
    },
    get lastCommittedText() { return ime.lastCommittedText; },
    get lastCommitTime() { return ime.lastCommitTime; },
  };
}
