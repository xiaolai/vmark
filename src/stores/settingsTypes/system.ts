/**
 * System settings types — MCP server, terminal emulator, and advanced
 * (developer-facing) toggles.
 *
 * Extracted from settingsTypes.ts, which remains the stable entry point.
 *
 * @module stores/settingsTypes/system
 */

// ---------------------------------------------------------------------------
// MCP & Terminal
// ---------------------------------------------------------------------------

/** MCP server configuration — port, auto-start, and edit approval policy. */
interface McpServerSettings {
  port: number;        // Default: 9223 (VMark app MCP server; not Tauri automation)
  autoStart: boolean;  // Start on app launch
  autoApproveEdits: boolean; // Auto-approve AI document edits without preview
}

/** Terminal placement: auto (axis by aspect ratio), auto-flipped (auto, opposite end), or an explicit side. See useTerminalPosition. */
export type TerminalPosition = "auto" | "auto-flipped" | "top" | "bottom" | "left" | "right";
/** Terminal cursor shape. */
export type TerminalCursorStyle = "block" | "underline" | "bar";
/** How a terminal bell (BEL) is signalled: off, a visual background-activity
 *  indicator, or an audible beep. */
export type TerminalBellMode = "off" | "visual" | "audible";

/** Terminal emulator preferences — shell, font, cursor, renderer, and panel layout. */
export interface TerminalSettings {
  shell: string;       // Default: "" (empty = system default via getpwuid → $SHELL → /bin/sh)
  fontSize: number;    // Default: 13 (clamp range: 8–32, see CLAMP_RANGES.terminal)
  lineHeight: number;  // Default: 1.2 (clamp range: 1–2.5, see CLAMP_RANGES.terminal)
  cursorStyle: TerminalCursorStyle; // Default: "bar"
  cursorBlink: boolean; // Default: true
  copyOnSelect: boolean; // Default: false — auto-copy selected text to clipboard
  useWebGL: boolean;   // Default: true — use WebGL renderer (disable to troubleshoot IME issues)
  macOptionIsMeta: boolean; // Default: true — treat macOS Option as Meta for Alt+Arrow word navigation; disable for dead-key accent composition (Option+E/N/U)
  shellIntegration: boolean; // Default: true — inject OSC 133 command marks + OSC 7 cwd (zsh) for prompt nav, exit-status decorations, cwd tracking
  screenReaderMode: boolean; // Default: false — expose terminal output to assistive tech (VoiceOver); off by default for performance (G3/WI-3.1)
  bellMode: TerminalBellMode; // Default: "visual" — how the terminal bell is signalled (off/visual indicator/audible beep)
  notifyOnBell: boolean; // Default: true — OS notification when an unfocused window's terminal rings the bell
  minimumContrastRatio: number; // Default: 4.5 (WCAG AA) — xterm foreground-lift floor (1 = off … 21 = max)
  scrollback: number; // Default: 5000 — number of scrollback lines retained per session (G7/WI-4.2)
  position: TerminalPosition; // Default: "auto" — auto-reposition based on window aspect ratio
  panelRatio: number;  // Default: 0.4 — fraction of available space (0.1–0.8), persisted on drag end
}

// ---------------------------------------------------------------------------
// Advanced
// ---------------------------------------------------------------------------

/** Advanced settings — MCP server, custom protocols, and developer-facing toggles. */
export interface AdvancedSettingsState {
  mcpServer: McpServerSettings;
  customLinkProtocols: string[]; // Custom URL protocols to recognize (e.g., "obsidian", "vscode")
  keepBothEditorsAlive: boolean; // Keep both editors mounted for faster mode switching (default: false)
  workflowEngine: boolean; // Enable YAML workflow engine (developer feature, default: false)
  /**
   * When the structured workflow editor saves changes, preserve comments,
   * anchors, and existing formatting where possible (CST round-trip).
   * Disable to reformat through `yaml.stringify` on every save.
   * Default: true.
   */
  workflowEditorPreserveYamlFormatting: boolean;
  /**
   * Fetch `action.yml` from referenced GitHub Actions over the network to
   * populate the structured editor's `with:` form. Disable for a purely
   * offline workflow viewer (audit 20260612 H28 — the privacy off-switch
   * the website documents). Default: true.
   */
  workflowFetchActionMetadata: boolean;
  /** Run optional `actionlint` for richer workflow diagnostics. Default: true. */
  workflowActionlint: boolean;
  // macOS only: clear `com.apple.quarantine` on the workspace root and its
  // direct .md children when opening a workspace. Without this, files marked
  // by apps like Mixin Messenger fail to open in a running VMark via Finder
  // double-click (Launch Services routes them through CSUI which silently
  // drops the openURLs delivery). Default: true.
  clearMacQuarantineOnOpen: boolean;
}
