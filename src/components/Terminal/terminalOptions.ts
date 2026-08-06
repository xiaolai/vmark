/**
 * terminalOptions
 *
 * Purpose: Normalize user settings into the xterm options literal. Split out of
 * createTerminalInstance so that factory reads as a lifecycle (acquire → wire →
 * release) instead of a wall of option tuning, and so the clamping rules are
 * testable without constructing a terminal.
 *
 * @coordinates-with createTerminalInstance.ts — sole consumer
 * @module components/Terminal/terminalOptions
 */
import { buildXtermThemeForId } from "@/theme";

/** User-configurable settings for creating a terminal instance. */
export interface TerminalInstanceSettings {
  fontSize: number;
  lineHeight: number;
  cursorStyle: "block" | "underline" | "bar";
  cursorBlink: boolean;
  useWebGL: boolean;
  macOptionIsMeta: boolean;
  /** Expose terminal output to assistive tech (VoiceOver). Off by default for
   *  performance; live-settable (G3/WI-3.1). */
  screenReaderMode: boolean;
  /** xterm foreground-lift floor (WCAG): 1 = off … 4.5 = AA … 21 = max.
   *  Live-settable. */
  minimumContrastRatio: number;
  /** Number of scrollback lines retained (G7/WI-4.2). */
  scrollback: number;
  /** Allow programs in the terminal (ssh/tmux) to WRITE the host clipboard via
   *  OSC 52 (WI-3.5). Reads are denied regardless of this flag. Read at
   *  creation, like the other addon toggles — a change applies to new sessions. */
  osc52Clipboard: boolean;
  /** Active app theme — used to compose the xterm ITheme. The factory
   *  no longer reads settingsStore directly to keep the @/theme module
   *  free of a back-edge into stores (avoids a dep-cruiser cycle). */
  themeId: import("@/theme").ThemeId;
}

/** Scrollback lines, coerced into a value xterm will accept. */
export function clampScrollback(value: number): number {
  if (!Number.isFinite(value)) return 5000; // matches settings' default
  return Math.min(Math.max(Math.trunc(value), 100), 200_000);
}

/** Build the xterm options for a set of user settings. */
export function buildTerminalOptions(
  settings: TerminalInstanceSettings,
  fontFamily: string,
) {
  return {
    theme: buildXtermThemeForId(settings.themeId),
    fontFamily,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    cursorStyle: settings.cursorStyle,
    cursorBlink: settings.cursorBlink,
    macOptionIsMeta: settings.macOptionIsMeta,
    screenReaderMode: settings.screenReaderMode,
    // Per-cell foreground lift when an app paints a filled tag
    // (e.g. Claude Code statusline: `chalk.bgCyan.black`). Light-theme ANSI
    // palettes are tuned for colors-as-foreground, so a dark cyan bg paired
    // with a dark-charcoal fg leaves text unreadable. xterm dynamically lifts
    // the foreground to meet the configured ratio against the actual
    // background color (default 4.5 = WCAG AA; user-adjustable for a11y).
    // Fall back to 4.5 when unset; clamp to xterm's valid 1–21 range.
    minimumContrastRatio: Math.min(
      Math.max(
        Number.isFinite(settings.minimumContrastRatio)
          ? settings.minimumContrastRatio
          : 4.5,
        1,
      ),
      21,
    ),
    allowProposedApi: true,
    // Clamp defensively: the settings UI offers bounded presets, but corrupt
    // persisted state could carry an extreme value that bloats memory (Codex
    // audit). NaN is checked FIRST — it passes straight through Math.min/max,
    // and xterm throws on a NaN scrollback, taking terminal creation with it.
    scrollback: clampScrollback(settings.scrollback),
  };
}
