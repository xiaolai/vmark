import { useEffect, useRef, useCallback, useMemo } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useTerminalPty, useTerminalSessions } from "@/hooks/useTerminalPty";
import { useSettingsStore, type ThemeId } from "@/stores/settingsStore";
import { type TerminalSession } from "@/stores/terminalStore";
import { createMarkdownAddon, type MarkdownAddon } from "@/plugins/terminalMarkdown";
import "@xterm/xterm/css/xterm.css";
import "./TerminalView.css";

/**
 * Terminal themes matching each app theme.
 * Each theme has carefully selected ANSI colors that harmonize with the app's aesthetic.
 */
const terminalThemes: Record<ThemeId, ITheme> = {
  // White theme - clean, high contrast
  white: {
    background: "#ffffff",
    foreground: "#1a1a1a",
    cursor: "#1a1a1a",
    cursorAccent: "#ffffff",
    selectionBackground: "#add6ff",
    black: "#1a1a1a",
    red: "#c72e2e",
    green: "#22863a",
    yellow: "#b08800",
    blue: "#0366d6",
    magenta: "#6f42c1",
    cyan: "#1b7c83",
    white: "#f6f8fa",
    brightBlack: "#6a737d",
    brightRed: "#cb2431",
    brightGreen: "#28a745",
    brightYellow: "#dbab09",
    brightBlue: "#2188ff",
    brightMagenta: "#8a63d2",
    brightCyan: "#3192aa",
    brightWhite: "#ffffff",
  },

  // Paper theme - soft gray with muted colors
  paper: {
    background: "#EEEDED",
    foreground: "#1a1a1a",
    cursor: "#1a1a1a",
    cursorAccent: "#EEEDED",
    selectionBackground: "#c8d4e0",
    black: "#1a1a1a",
    red: "#b83030",
    green: "#2e7d32",
    yellow: "#a67c00",
    blue: "#1565c0",
    magenta: "#7b1fa2",
    cyan: "#00838f",
    white: "#e0e0e0",
    brightBlack: "#757575",
    brightRed: "#d32f2f",
    brightGreen: "#388e3c",
    brightYellow: "#f9a825",
    brightBlue: "#1976d2",
    brightMagenta: "#8e24aa",
    brightCyan: "#0097a7",
    brightWhite: "#fafafa",
  },

  // Mint theme - green-tinted with nature-inspired colors
  mint: {
    background: "#CCE6D0",
    foreground: "#2d3a35",
    cursor: "#2d3a35",
    cursorAccent: "#CCE6D0",
    selectionBackground: "#a3d4a8",
    black: "#2d3a35",
    red: "#9b2c2c",
    green: "#276749",
    yellow: "#975a16",
    blue: "#2b6cb0",
    magenta: "#6b46c1",
    cyan: "#0e7490",
    white: "#b8d9bd",
    brightBlack: "#5a6b63",
    brightRed: "#c53030",
    brightGreen: "#38a169",
    brightYellow: "#d69e2e",
    brightBlue: "#3182ce",
    brightMagenta: "#805ad5",
    brightCyan: "#0891b2",
    brightWhite: "#e8f5e9",
  },

  // Sepia theme - warm, book-like aesthetic
  sepia: {
    background: "#F9F0DB",
    foreground: "#5c4b37",
    cursor: "#5c4b37",
    cursorAccent: "#F9F0DB",
    selectionBackground: "#e6d5b8",
    black: "#5c4b37",
    red: "#9b4423",
    green: "#5d7a2e",
    yellow: "#a67c00",
    blue: "#5b6ea8",
    magenta: "#8b5a7c",
    cyan: "#4a8a8c",
    white: "#f0e5cc",
    brightBlack: "#8b7355",
    brightRed: "#c65d3d",
    brightGreen: "#7a9b4e",
    brightYellow: "#c9a227",
    brightBlue: "#7889c4",
    brightMagenta: "#a67394",
    brightCyan: "#5fa3a5",
    brightWhite: "#faf6eb",
  },

  // Night theme - dark with vibrant accents
  night: {
    background: "#23262b",
    foreground: "#d6d9de",
    cursor: "#d6d9de",
    cursorAccent: "#23262b",
    selectionBackground: "#3d4450",
    black: "#23262b",
    red: "#f44747",
    green: "#7aa874",
    yellow: "#dcdcaa",
    blue: "#5aa8ff",
    magenta: "#c586c0",
    cyan: "#4ec9b0",
    white: "#d6d9de",
    brightBlack: "#6a737d",
    brightRed: "#f77171",
    brightGreen: "#98c379",
    brightYellow: "#e5c07b",
    brightBlue: "#6cb6ff",
    brightMagenta: "#d19a66",
    brightCyan: "#56d4bc",
    brightWhite: "#ffffff",
  },
};

/** Get terminal theme based on settings */
function useTerminalTheme(): ITheme {
  const terminalThemeSetting = useSettingsStore((state) => state.terminal.theme);
  const appTheme = useSettingsStore((state) => state.appearance.theme);

  return useMemo(() => {
    // "Dark" - always use Night terminal theme
    if (terminalThemeSetting === "dark") return terminalThemes.night;

    // "Light" - use current app theme, but if app is Night, use White instead
    if (terminalThemeSetting === "light") {
      return appTheme === "night" ? terminalThemes.white : terminalThemes[appTheme];
    }

    // "Follow App" (auto) - use the terminal theme that matches the app theme
    return terminalThemes[appTheme] ?? terminalThemes.paper;
  }, [terminalThemeSetting, appTheme]);
}

interface TerminalViewProps {
  /** Optional session to restore (from persistence) */
  sessionToRestore?: TerminalSession;
}

export function TerminalView({ sessionToRestore }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const markdownAddonRef = useRef<MarkdownAddon | null>(null);

  // Read terminal settings
  const terminalSettings = useSettingsStore((state) => state.terminal);
  const terminalTheme = useTerminalTheme();

  // Session management
  const { createSession, removeSession } = useTerminalSessions();

  // Data processor for markdown rendering
  const processData = useCallback((data: string): string => {
    if (!markdownAddonRef.current) return data;
    return markdownAddonRef.current.processData(data);
  }, []);

  // Session lifecycle callbacks
  const handleSessionCreated = useCallback(
    (sessionId: string) => {
      createSession(sessionId);
    },
    [createSession]
  );

  const handleSessionEnded = useCallback(
    (sessionId: string) => {
      removeSession(sessionId);
    },
    [removeSession]
  );

  const { sessionId, sendInput } = useTerminalPty(
    terminalRef,
    processData,
    handleSessionCreated,
    handleSessionEnded,
    sessionToRestore
  );

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return;

    // Build fontFamily string - System Default uses fallback chain, specific fonts use that font + monospace fallback
    const fontFamily =
      terminalSettings.fontFamily === "System Default"
        ? '"SF Mono", "Monaco", "Menlo", "Consolas", "Courier New", monospace'
        : `"${terminalSettings.fontFamily}", monospace`;

    const terminal = new Terminal({
      fontFamily,
      fontSize: terminalSettings.fontSize,
      lineHeight: 1.2,
      cursorBlink: terminalSettings.cursorBlink,
      cursorStyle: terminalSettings.cursorStyle,
      scrollback: terminalSettings.scrollback,
      theme: terminalTheme,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // Initialize markdown addon
    const markdownAddon = createMarkdownAddon();
    terminal.loadAddon(markdownAddon);
    markdownAddonRef.current = markdownAddon;

    terminal.open(containerRef.current);
    fitAddon.fit();

    // Handle user input
    terminal.onData((data) => {
      sendInput(data);
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Fit terminal on resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      markdownAddonRef.current = null;
    };
  }, [sendInput]);

  // Update markdown mode when it changes
  useEffect(() => {
    if (markdownAddonRef.current) {
      markdownAddonRef.current.setMode(terminalSettings.markdownMode);
    }
  }, [terminalSettings.markdownMode]);

  // Update terminal options when settings change
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    // Build fontFamily string
    const fontFamily =
      terminalSettings.fontFamily === "System Default"
        ? '"SF Mono", "Monaco", "Menlo", "Consolas", "Courier New", monospace'
        : `"${terminalSettings.fontFamily}", monospace`;

    terminal.options.fontFamily = fontFamily;
    terminal.options.fontSize = terminalSettings.fontSize;
    terminal.options.cursorBlink = terminalSettings.cursorBlink;
    terminal.options.cursorStyle = terminalSettings.cursorStyle;
    terminal.options.scrollback = terminalSettings.scrollback;

    // Re-fit after font change
    fitAddonRef.current?.fit();
  }, [
    terminalSettings.fontFamily,
    terminalSettings.fontSize,
    terminalSettings.cursorBlink,
    terminalSettings.cursorStyle,
    terminalSettings.scrollback,
  ]);

  // Update theme when it changes
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    terminal.options.theme = terminalTheme;
  }, [terminalTheme]);

  // Re-fit when session changes (terminal reconnects)
  useEffect(() => {
    if (sessionId && fitAddonRef.current) {
      // Small delay to let terminal settle
      setTimeout(() => {
        fitAddonRef.current?.fit();
        // Update addon width after fit
        if (markdownAddonRef.current && terminalRef.current) {
          markdownAddonRef.current.updateWidth(terminalRef.current.cols);
        }
      }, 50);
    }
  }, [sessionId]);

  // Copy on select
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !terminalSettings.copyOnSelect) return;

    const disposable = terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection).catch(() => {
          // Clipboard write may fail in some contexts, ignore
        });
      }
    });

    return () => disposable.dispose();
  }, [terminalSettings.copyOnSelect]);

  return <div ref={containerRef} className="terminal-view" />;
}
