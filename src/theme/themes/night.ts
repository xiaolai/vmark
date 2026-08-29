import type { ThemeTokens } from "../tokens";
import { sharedPrimitives, darkShadows, subtleDark, hoverDark } from "../tokens";

/** Night theme — the dark theme. */
export const night: ThemeTokens = {
  isDark: true,
  color: {
    // secondary lifted #2a2e34 → #2e323a for the Q1 surface ramp (1.18:1);
    // tertiary follows above it (WI-UI1.2).
    bg: { primary: "#23262b", secondary: "#2e323a", tertiary: "#383d46" },
    text: { primary: "#d6d9de", secondary: "#a2a8ad", tertiary: "#777c83" },
    // accent.bg was rgba(88,166,255,…) while the emitted --accent-bg carried a
    // legacy rgba(90,168,255,…) twin (ΔE 0.2, sub-JND). WI-UI1.1 collapsed the
    // divergence into this one field.
    accent: { primary: "#61abff", bg: "rgba(90, 168, 255, 0.12)" },
    // bg.primary on the accent: 7.0:1 on #58a6ff — `white` measured 2.53:1.
    contrastText: "#23262b",
    border: "#3a3f46",
    /** D8 — control boundary ≥ 3:1 on primary and secondary; `border` stays a divider. */
    controlBorder: "#777b81",
    selection: "rgba(90, 168, 255, 0.22)",
    subtle: subtleDark,
    hover: hoverDark,
    strong: "#6cb6ff",
    emphasis: "#d29c69",
    semantic: {
      error: "#fa8580",
      errorBg: "rgba(248, 81, 73, 0.15)",
      // WI-UI1.1: the hovers are the values night actually renders — the old
      // #b91c1c/#15803d light values were dead fields shadowed by legacy
      // overrides (and would measure 2.35:1 here).
      errorHover: "#fca5a5",
      warning: "#d49e2c",
      warningBg: "rgba(245, 158, 11, 0.1)",
      warningBorder: "rgba(210, 153, 34, 0.3)",
      success: "#4ade80",
      successHover: "#86efac",
    },
    alert: { note: "#61abff", tip: "#49bd5a", important: "#ba95f9", warning: "#d49e2c", caution: "#fa8580" },
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
      sourceModeBg: "rgba(255, 255, 255, 0.02)",
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
  },
  syntax: {
    keyword: "#ff7b72", type: "#d2a8ff", function: "#d2a8ff", property: "#79c0ff",
    variable: "#d6d9de", string: "#a5d6ff", number: "#79c0ff", operator: "#ff7b72",
    punctuation: "#d6d9de", comment: "#929ba4", escape: "#79c0ff", constant: "#79c0ff",
    attribute: "#d2a8ff", tag: "#7ee787", link: "#a5d6ff", invalid: "#f96d66",
  },
  ...sharedPrimitives,
  shadow: darkShadows,
};
