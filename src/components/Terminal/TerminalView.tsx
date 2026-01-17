import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useTerminalPty, useTerminalSessions } from "@/hooks/useTerminalPty";
import { useSettingsStore } from "@/stores/settingsStore";
import { createMarkdownAddon, type MarkdownAddon } from "@/plugins/terminalMarkdown";
import "@xterm/xterm/css/xterm.css";
import "./TerminalView.css";

export function TerminalView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const markdownAddonRef = useRef<MarkdownAddon | null>(null);

  // Read terminal settings
  const terminalSettings = useSettingsStore((state) => state.terminal);

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
    handleSessionEnded
  );

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      fontFamily: '"SF Mono", "Monaco", "Menlo", "Courier New", monospace',
      fontSize: terminalSettings.fontSize,
      lineHeight: 1.2,
      cursorBlink: terminalSettings.cursorBlink,
      cursorStyle: terminalSettings.cursorStyle,
      scrollback: terminalSettings.scrollback,
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
        cursorAccent: "#1e1e1e",
        selectionBackground: "#264f78",
        black: "#1e1e1e",
        red: "#f44747",
        green: "#6a9955",
        yellow: "#dcdcaa",
        blue: "#569cd6",
        magenta: "#c586c0",
        cyan: "#4ec9b0",
        white: "#d4d4d4",
        brightBlack: "#808080",
        brightRed: "#f44747",
        brightGreen: "#6a9955",
        brightYellow: "#dcdcaa",
        brightBlue: "#569cd6",
        brightMagenta: "#c586c0",
        brightCyan: "#4ec9b0",
        brightWhite: "#ffffff",
      },
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

    terminal.options.fontSize = terminalSettings.fontSize;
    terminal.options.cursorBlink = terminalSettings.cursorBlink;
    terminal.options.cursorStyle = terminalSettings.cursorStyle;
    terminal.options.scrollback = terminalSettings.scrollback;

    // Re-fit after font size change
    fitAddonRef.current?.fit();
  }, [
    terminalSettings.fontSize,
    terminalSettings.cursorBlink,
    terminalSettings.cursorStyle,
    terminalSettings.scrollback,
  ]);

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

  return <div ref={containerRef} className="terminal-view" />;
}
