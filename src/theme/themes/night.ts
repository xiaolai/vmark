import type { ThemeTokens } from "../tokens";
import { sharedPrimitives, darkShadows } from "../tokens";

/** Night theme — the dark theme. */
export const night: ThemeTokens = {
  isDark: true,
  color: {
    bg: { primary: "#23262b", secondary: "#2a2e34", tertiary: "#32363d" },
    text: { primary: "#d6d9de", secondary: "#9aa0a6", tertiary: "#6b7078" },
    accent: { primary: "#58a6ff", bg: "rgba(88, 166, 255, 0.12)" },
    border: "#3a3f46",
    selection: "rgba(90, 168, 255, 0.22)",
    strong: "#6cb6ff",
    emphasis: "#d19a66",
    semantic: { error: "#f85149", errorBg: "rgba(248, 81, 73, 0.15)", errorHover: "#b91c1c", warning: "#d29922", warningBg: "rgba(245, 158, 11, 0.1)", success: "#4ade80", successHover: "#15803d" },
    alert: { note: "#58a6ff", tip: "#3fb950", important: "#a371f7", warning: "#d29922", caution: "#f85149" },
    media: { video: "#2dd4bf", audio: "#818cf8", youtube: "#f87171", vimeo: "#4ac3f0", bilibili: "#fc9cb5" },
    // Legacy `--*` override values consumed by the app's CSS. Some
    // intentionally diverge from the structured fields above and so cannot
    // be derived (e.g. accentBg uses 90/168 vs accent.bg's 88/166; the
    // error/success hover tints differ from semantic.*Hover). Held here so
    // the typed catalog stays the single source of truth (ADR-014) and
    // `useTheme.ts` no longer carries a standalone `darkModeColors` const.
    legacy: {
      codeText: "#d1d5db",
      mdChar: "#7aa874",
      blurText: "#6b7078",
      accentBg: "rgba(90, 168, 255, 0.12)",
      sourceModeBg: "rgba(255, 255, 255, 0.02)",
      errorColorHover: "#fca5a5",
      successColorHover: "#86efac",
      highlightBg: "#5c5c00",
      highlightText: "#fff3a3",
      blockBgSubtle: "rgba(255, 255, 255, 0.03)",
      blockBgSubtleHover: "rgba(255, 255, 255, 0.05)",
    },
  },
  terminal: {
    ansi: {
      black: "#1a1d22", red: "#f85149", green: "#3fb950", yellow: "#d29922",
      blue: "#58a6ff", magenta: "#bc8cff", cyan: "#39c5cf", white: "#b1bac4",
      brightBlack: "#484f58", brightRed: "#ff7b72", brightGreen: "#56d364", brightYellow: "#e3b341",
      brightBlue: "#79c0ff", brightMagenta: "#d2a8ff", brightCyan: "#56d4dd", brightWhite: "#f0f6fc",
    },
    cursor: "#d6d9de",
    cursorAccent: "#23262b",
    selectionBackground: "rgba(90, 168, 255, 0.22)",
    scrollbar: { idle: "rgba(255, 255, 255, 0.12)", hover: "rgba(255, 255, 255, 0.20)", active: "rgba(255, 255, 255, 0.30)" },
  },
  ...sharedPrimitives,
  shadow: darkShadows,
};
