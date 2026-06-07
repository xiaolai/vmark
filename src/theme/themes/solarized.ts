import type { ThemeTokens } from "../tokens";
import { sharedPrimitives, darkShadows } from "../tokens";

/**
 * Solarized theme — Ethan Schoonover's Solarized Dark palette.
 *
 * The second dark theme, proving the ADR-014 / theme-unification promise:
 * adding a theme is a single new file plus appending the ID to
 * `themes/index.ts` and the `ThemeId` union. Base tones (base03/base02 for
 * backgrounds, base0/base1 for text) and accent (blue #268bd2) follow the
 * canonical Solarized values; the editor-specific `legacy` overrides mirror
 * `night`'s structure so the runtime emits a full var set.
 */
export const solarized: ThemeTokens = {
  isDark: true,
  color: {
    // base03 #002b36, base02 #073642, base01 #586e75
    bg: { primary: "#002b36", secondary: "#073642", tertiary: "#0a3a47" },
    // base0 #839496, base1 #93a1a1, base01 #586e75
    text: { primary: "#93a1a1", secondary: "#839496", tertiary: "#586e75" },
    accent: { primary: "#268bd2", bg: "rgba(38, 139, 210, 0.14)" },
    border: "#0e4753",
    selection: "rgba(38, 139, 210, 0.22)",
    strong: "#6c9ec9", // blue, lightened for bold on dark base
    emphasis: "#cb9b6e", // yellow/orange tint for italics
    semantic: {
      error: "#dc322f", // red
      errorBg: "rgba(220, 50, 47, 0.15)",
      errorHover: "#b91c1c",
      warning: "#b58900", // yellow
      warningBg: "rgba(181, 137, 0, 0.12)",
      success: "#859900", // green
      successHover: "#6b7d00",
    },
    alert: {
      note: "#268bd2", // blue
      tip: "#859900", // green
      important: "#6c71c4", // violet
      warning: "#b58900", // yellow
      caution: "#dc322f", // red
    },
    media: { video: "#2aa198", audio: "#6c71c4", youtube: "#dc322f", vimeo: "#268bd2", bilibili: "#d33682" },
    legacy: {
      codeText: "#93a1a1",
      mdChar: "#859900",
      blurText: "#586e75",
      accentBg: "rgba(38, 139, 210, 0.14)",
      sourceModeBg: "rgba(255, 255, 255, 0.02)",
      errorColorHover: "#e15a57",
      successColorHover: "#a0b200",
      highlightBg: "#4a4a00",
      highlightText: "#fdf6e3",
      blockBgSubtle: "rgba(255, 255, 255, 0.03)",
      blockBgSubtleHover: "rgba(255, 255, 255, 0.05)",
    },
  },
  terminal: {
    // Canonical Solarized ANSI mapping (Schoonover): normal = the
    // accent/base tones, bright = base monotones + orange/violet.
    ansi: {
      black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900",
      blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
      brightBlack: "#586e75", brightRed: "#cb4b16", brightGreen: "#586e75", brightYellow: "#657b83",
      brightBlue: "#839496", brightMagenta: "#6c71c4", brightCyan: "#93a1a1", brightWhite: "#fdf6e3",
    },
    cursor: "#93a1a1",
    cursorAccent: "#002b36",
    selectionBackground: "rgba(38, 139, 210, 0.22)",
    scrollbar: { idle: "rgba(255, 255, 255, 0.12)", hover: "rgba(255, 255, 255, 0.20)", active: "rgba(255, 255, 255, 0.30)" },
  },
  ...sharedPrimitives,
  shadow: darkShadows,
};
