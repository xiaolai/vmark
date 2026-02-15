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
 *     during CJK input to avoid garbled text.
 *   - WebGL renderer is optional (settings-driven); falls back silently
 *     to canvas on GPU-incompatible systems.
 *   - File link provider detects file paths in output and opens them as
 *     new editor tabs on click.
 *   - Copy-on-select is gated by a settings flag and respects composition.
 *   - Theme colors are resolved from settingsStore at creation time;
 *     runtime theme changes are handled by useTerminalSessions.
 *
 * @coordinates-with useTerminalSessions.ts — caller that manages instance lifecycle
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
import { useSettingsStore, themes } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";
import { createFileLinkProvider } from "./fileLinkProvider";
import { createTerminalKeyHandler } from "./terminalKeyHandler";
import { terminalLog } from "@/utils/debug";

import "@xterm/xterm/css/xterm.css";

/** Resolve --font-mono CSS variable to actual font family names. */
function resolveMonoFont(): string {
  const style = getComputedStyle(document.documentElement);
  const mono = style.getPropertyValue("--font-mono").trim();
  return mono || "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace";
}

/** Build xterm ITheme from the app's current theme. */
function buildXtermTheme() {
  const themeId = useSettingsStore.getState().appearance.theme;
  const colors = themes[themeId];
  return {
    background: colors.background,
    foreground: colors.foreground,
    cursor: colors.foreground,
    cursorAccent: colors.background,
    selectionBackground: colors.selection ?? "rgba(0,102,204,0.25)",
  };
}

export interface TerminalInstance {
  term: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  serializeAddon: SerializeAddon;
  container: HTMLDivElement;
  /** Whether an IME composition is active (guards onData in useTerminalSessions + copy-on-select here). */
  composing: boolean;
  dispose: () => void;
}

export interface TerminalInstanceSettings {
  fontSize: number;
  lineHeight: number;
  useWebGL: boolean;
}

interface CreateOptions {
  parentEl: HTMLElement;
  settings: TerminalInstanceSettings;
  ptyRef: React.RefObject<import("tauri-pty").IPty | null>;
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
    cursorStyle: "underline",
    cursorBlink: true,
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

  // IME composition tracking (diagnostic + safety net)
  let composing = false;
  const textarea = container.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
  const onCompositionStart = () => {
    composing = true;
    terminalLog("compositionstart");
  };
  const onCompositionEnd = () => {
    composing = false;
    terminalLog("compositionend");
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
      webglAddon.onContextLoss(() => webglAddon.dispose());
      term.loadAddon(webglAddon);
    } catch {
      // Fallback to canvas
    }
  }

  // Web links
  term.loadAddon(new WebLinksAddon((_event, uri) => {
    import("@tauri-apps/plugin-opener").then(({ openUrl }) => {
      openUrl(uri);
    });
  }));

  // File links
  term.registerLinkProvider(createFileLinkProvider(term, (filePath) => {
    import("@tauri-apps/plugin-fs").then(({ readTextFile }) => {
      readTextFile(filePath).then((content) => {
        const windowLabel = getCurrentWindowLabel();
        const tabId = useTabStore.getState().createTab(windowLabel, filePath);
        useDocumentStore.getState().initDocument(tabId, content, filePath);
      }).catch(() => {
        // File not readable
      });
    });
  }));

  // Custom key handler
  term.attachCustomKeyEventHandler(
    createTerminalKeyHandler(term, ptyRef, { onSearch }),
  );

  // Copy on select
  term.onSelectionChange(() => {
    if (!composing && term.hasSelection() && useSettingsStore.getState().terminal.copyOnSelect) {
      const text = term.getSelection().trimEnd();
      if (text) writeText(text).catch(() => {});
    }
  });

  const dispose = () => {
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
  };

  return instance;
}
