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
 *   - IME composition tracking via compositionstart/end on the hidden
 *     textarea — used to suppress copy-on-select and data forwarding
 *     during CJK input to avoid garbled text. Includes an 80ms grace
 *     period after compositionend to block xterm's space-injected ASCII
 *     onData while allowing non-ASCII (CJK punctuation) through (#454).
 *     Fires onCompositionCommit with clean committed text for direct
 *     PTY write (fixes macOS Chinese IME: "claude" → "cl au de").
 *     Rapid back-to-back compositions flush pending text immediately.
 *     Single non-ASCII chars (CJK brackets/punctuation) flush immediately
 *     without the grace period to fix WeChat IME bracket input (#525).
 *     Tracks lastCommittedText/lastCommitTime for dedup against late
 *     onData events from WeChat IME (#525).
 *   - WebGL renderer is optional (settings-driven); falls back silently
 *     to canvas on GPU-incompatible systems.
 *   - Web links only open safe URL schemes (http, https, mailto);
 *     opener import is cached across clicks.
 *   - File link provider detects file paths in output and opens them as
 *     new editor tabs on click, with a 10 MB size guard.
 *   - Copy-on-select is debounced (150ms), gated by a settings flag,
 *     and respects composition state.
 *   - Theme colors are resolved via buildXtermTheme() from terminalTheme.ts;
 *     runtime theme changes are handled by useTerminalSessions.
 *
 * @coordinates-with useTerminalSessions.ts — caller that manages instance lifecycle
 * @coordinates-with terminalTheme.ts — per-theme ANSI color palettes for xterm.js
 * @coordinates-with fileLinkProvider.ts — file path detection in terminal output
 * @coordinates-with terminalKeyHandler.ts — custom Cmd+C/V/K/F handling
 * @module components/Terminal/createTerminalInstance
 */
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";
import { createFileLinkProvider } from "./fileLinkProvider";
import { createTerminalKeyHandler } from "./terminalKeyHandler";
import { buildXtermTheme } from "./terminalTheme";
import { clipboardWarn, terminalLog } from "@/utils/debug";

import "@xterm/xterm/css/xterm.css";

/** Resolve --font-mono CSS variable to actual font family names. */
function resolveMonoFont(): string {
  const style = getComputedStyle(document.documentElement);
  const mono = style.getPropertyValue("--font-mono").trim();
  return mono || "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace";
}

// buildXtermTheme is imported from ./terminalTheme

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
  /** Text pending commit during grace period — used to block xterm re-emission (#608). */
  pendingCommitText: string | null;
  /** Last text committed via onCompositionCommit — used for dedup against late onData (#525). */
  lastCommittedText: string | null;
  /** Timestamp (Date.now()) of the last onCompositionCommit — dedup window check (#525). */
  lastCommitTime: number;
  dispose: () => void;
}

/** User-configurable settings for creating a terminal instance. */
export interface TerminalInstanceSettings {
  fontSize: number;
  lineHeight: number;
  cursorStyle: "block" | "underline" | "bar";
  cursorBlink: boolean;
  useWebGL: boolean;
}

interface CreateOptions {
  parentEl: HTMLElement;
  settings: TerminalInstanceSettings;
  ptyRef: React.RefObject<import("@/lib/pty").IPty | null>;
  onSearch: () => void;
}

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
    allowProposedApi: true,
    scrollback: 5000,
  });

  // Load addons
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  const searchAddon = new SearchAddon();
  term.loadAddon(searchAddon);

  const serializeAddon = new SerializeAddon();
  term.loadAddon(serializeAddon);

  // Open terminal
  term.open(container);

  // IME composition tracking with grace period.
  // macOS Chinese IME: xterm fires onData with spaces injected between syllable
  // segments (e.g., "claude" → "cl au de"). We capture the clean committed text
  // from compositionend.data and write it directly to PTY via onCompositionCommit,
  // keeping composing=true during a grace period to block xterm's garbled onData.
  let composing = false;
  let inGracePeriod = false;
  let compositionGraceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingCommitText: string | null = null;
  let onCompositionCommit: ((text: string) => void) | null = null;
  let lastCommittedText: string | null = null;
  let lastCommitTime = 0;
  const textarea = container.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
  const onCompositionStart = () => {
    // Flush any pending committed text from a previous compositionend before
    // starting a new composition — prevents input loss in rapid back-to-back
    // IME commits (e.g., typing fast in Chinese pinyin).
    if (compositionGraceTimer) {
      clearTimeout(compositionGraceTimer);
      compositionGraceTimer = null;
      if (pendingCommitText && onCompositionCommit) {
        lastCommittedText = pendingCommitText;
        lastCommitTime = Date.now();
        onCompositionCommit(pendingCommitText);
      }
      pendingCommitText = null;
    }
    composing = true;
    inGracePeriod = false;
    terminalLog("compositionstart");
  };
  const onCompositionEnd = (e: CompositionEvent) => {
    const committedText = e.data;
    terminalLog("compositionend", committedText);

    // Single non-ASCII character (CJK punctuation/bracket) — flush immediately.
    // These don't trigger xterm's garbled space injection, so no grace period needed.
    // Fixes CJK brackets not inputting with WeChat IME (#525).
    // eslint-disable-next-line no-control-regex
    if (committedText && committedText.length === 1 && !/^[\x00-\x7F]$/.test(committedText)) {
      composing = false;
      inGracePeriod = false;
      if (compositionGraceTimer) {
        clearTimeout(compositionGraceTimer);
        compositionGraceTimer = null;
      }
      pendingCommitText = null;
      lastCommittedText = committedText;
      lastCommitTime = Date.now();
      if (onCompositionCommit) {
        onCompositionCommit(committedText);
      }
      return;
    }

    // Multi-char (or ASCII): use grace period to block xterm's garbled ASCII onData.
    // Non-ASCII chars (CJK punctuation) are allowed through by the onData guard.
    pendingCommitText = committedText;
    inGracePeriod = true;
    compositionGraceTimer = setTimeout(() => {
      compositionGraceTimer = null;
      composing = false;
      inGracePeriod = false;
      // Send clean committed text directly to PTY
      if (pendingCommitText && onCompositionCommit) {
        lastCommittedText = pendingCommitText;
        lastCommitTime = Date.now();
        onCompositionCommit(pendingCommitText);
      }
      pendingCommitText = null;
    }, 80);
  };
  if (textarea) {
    textarea.addEventListener("compositionstart", onCompositionStart);
    textarea.addEventListener("compositionend", onCompositionEnd);
  } else {
    terminalLog("xterm-helper-textarea not found — IME composition tracking disabled");
  }

  // Unicode 11
  const unicode11 = new Unicode11Addon();
  term.loadAddon(unicode11);
  term.unicode.activeVersion = "11";

  // WebGL renderer (conditional — primarily for GPU compatibility; IME is usually unrelated)
  if (settings.useWebGL) {
    try {
      const webglAddon = new WebglAddon();
      /* v8 ignore next -- @preserve reason: onContextLoss callback only fires on GPU context loss; not reproducible in jsdom */
      webglAddon.onContextLoss(() => webglAddon.dispose());
      term.loadAddon(webglAddon);
    } catch {
      /* v8 ignore start -- @preserve reason: WebGL catch block only fires on GPU context loss; not reproducible in jsdom */
      // Fallback to canvas
      /* v8 ignore stop */
    }
  }

  // Web links — only open safe URL schemes; cache import to avoid repeated module resolution
  const SAFE_LINK_SCHEMES = ["http:", "https:", "mailto:"];
  let openerPromise: Promise<{ openUrl: (url: string) => Promise<void> }> | null = null;
  term.loadAddon(new WebLinksAddon((_event, uri) => {
    try {
      const parsed = new URL(uri);
      if (!SAFE_LINK_SCHEMES.includes(parsed.protocol)) {
        terminalLog("Blocked unsafe URL scheme:", parsed.protocol, uri);
        return;
      }
    } catch {
      // Not a valid absolute URL — skip
      return;
    }
    if (!openerPromise) {
      openerPromise = import("@tauri-apps/plugin-opener");
    }
    openerPromise.then(({ openUrl }) => {
      openUrl(uri).catch((error: unknown) => {
        terminalLog("Failed to open URL:", error instanceof Error ? error.message : String(error));
      });
    /* v8 ignore start -- @preserve reason: dynamic import of a vi.mock'd module always resolves in tests; the import-failure catch is only reachable in production when the plugin binary is missing */
    }).catch((error: unknown) => {
      openerPromise = null; // Reset on failure so next click retries
      terminalLog("Failed to load opener plugin:", error instanceof Error ? error.message : String(error));
    });
    /* v8 ignore stop */
  }));

  // File links — with size guard to prevent freezing on large files
  const MAX_FILE_LINK_SIZE = 10 * 1024 * 1024; // 10 MB
  term.registerLinkProvider(createFileLinkProvider(term, (filePath) => {
    import("@tauri-apps/plugin-fs").then(async ({ readTextFile, stat }) => {
      try {
        const info = await stat(filePath);
        if (info.size > MAX_FILE_LINK_SIZE) {
          terminalLog("File too large to open in editor:", filePath, `(${Math.round(info.size / 1024 / 1024)}MB)`);
          return;
        }
      } catch {
        // stat failed — proceed anyway, readTextFile will catch
      }
      readTextFile(filePath).then((content) => {
        const windowLabel = getCurrentWindowLabel();
        const tabId = useTabStore.getState().createTab(windowLabel, filePath);
        useDocumentStore.getState().initDocument(tabId, content, filePath);
      }).catch((error: unknown) => {
        terminalLog("File not readable:", error instanceof Error ? error.message : String(error));
      });
    /* v8 ignore start -- @preserve reason: dynamic import of a vi.mock'd module always resolves in tests; the import-failure catch is only reachable in production when the plugin binary is missing */
    }).catch((error: unknown) => {
      terminalLog("Failed to load fs plugin:", error instanceof Error ? error.message : String(error));
    });
    /* v8 ignore stop */
  }));

  // Custom key handler
  term.attachCustomKeyEventHandler(
    createTerminalKeyHandler(term, ptyRef, { onSearch }),
  );

  // Copy on select — debounced to avoid repeated clipboard writes during drag
  let copyOnSelectTimer: ReturnType<typeof setTimeout> | null = null;
  term.onSelectionChange(() => {
    if (copyOnSelectTimer) { clearTimeout(copyOnSelectTimer); copyOnSelectTimer = null; }
    if (!composing && term.hasSelection() && useSettingsStore.getState().terminal.copyOnSelect) {
      copyOnSelectTimer = setTimeout(() => {
        copyOnSelectTimer = null;
        if (!term.hasSelection()) return;
        const text = term.getSelection().trimEnd();
        if (text) writeText(text).catch((error: unknown) => {
          clipboardWarn("Clipboard write failed:", error instanceof Error ? error.message : String(error));
        });
      }, 150);
    }
  });

  const dispose = () => {
    if (compositionGraceTimer) {
      clearTimeout(compositionGraceTimer);
      compositionGraceTimer = null;
    }
    if (copyOnSelectTimer) {
      clearTimeout(copyOnSelectTimer);
      copyOnSelectTimer = null;
    }
    if (textarea) {
      textarea.removeEventListener("compositionstart", onCompositionStart);
      textarea.removeEventListener("compositionend", onCompositionEnd);
    }
    term.dispose();
    if (container.parentElement) {
      container.parentElement.removeChild(container);
    }
  };

  const instance: TerminalInstance = {
    term, fitAddon, searchAddon, serializeAddon, container, dispose,
    get composing() { return composing; },
    get inGracePeriod() { return inGracePeriod; },
    get onCompositionCommit() { return onCompositionCommit; },
    set onCompositionCommit(cb: ((text: string) => void) | null) { onCompositionCommit = cb; },
    get pendingCommitText() { return pendingCommitText; },
    get lastCommittedText() { return lastCommittedText; },
    get lastCommitTime() { return lastCommitTime; },
  };

  return instance;
}
