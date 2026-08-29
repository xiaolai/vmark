import type { ThemeTokens } from "../tokens";
import { sharedPrimitives, darkShadows, subtleDark, hoverDark } from "../tokens";

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
    // secondary lifted toward base1 to clear 4.5 on base02/tertiary — the
    // canonical grey ladder is too tight for AA and nearly collapses into
    // primary here; recorded as the Q6/AA trade (WI-UI1.2).
    text: { primary: "#93a1a1", secondary: "#91a0a2", tertiary: "#6a7e84" },
    // Q6 split: text-safe accent for TEXT roles (#268bd2 measured 4.08:1 on
    // base03); the canonical blue survives in the fill tint below and in the
    // terminal ANSI palette (D10).
    accent: { primary: "#53a4de", bg: "rgba(38, 139, 210, 0.14)" },
    // Deep base03-adjacent ink: 5.1:1 on the canonical blue fill. `white`
    // measured 3.68:1 and base03 itself 4.08:1 (WI-UI1.1 / Q6).
    contrastText: "#001519",
    border: "#0e4753",
    /** D8 — control boundary ≥ 3:1 on primary and secondary; `border` stays a divider. */
    controlBorder: "#628084",
    // alpha .22 → .16: text.primary over the composited selection measured
    // 4.17:1 (WI-UI1.2).
    selection: "rgba(38, 139, 210, 0.16)",
    subtle: subtleDark,
    hover: hoverDark,
    strong: "#72a2cb", // blue, lightened for bold on dark base (AA on base02, WI-UI1.2)
    emphasis: "#cb9b6e", // yellow/orange tint for italics
    semantic: {
      error: "#e97e7c", // red, lifted to AA on base02
      errorBg: "rgba(220, 50, 47, 0.15)",
      // WI-UI1.1: the value solarized actually renders (was a dead light field
      // shadowed by a legacy override).
      errorHover: "#e87f7c",
      warning: "#bf9821", // yellow, lifted
      warningBg: "rgba(181, 137, 0, 0.12)",
      warningBorder: "rgba(181, 137, 0, 0.3)",
      success: "#94a620", // green, lifted
      successHover: "#a0b200",
    },
    alert: {
      note: "#55a4dc", // blue, lifted
      tip: "#94a620", // green, lifted
      important: "#9599d5", // violet, lifted
      warning: "#bf9821", // yellow, lifted
      caution: "#e97e7c", // red, lifted
    },
    media: { video: "#2aa198", audio: "#6e73c5", youtube: "#de3f3c", vimeo: "#268bd2", bilibili: "#d53f87" },
    legacy: {
      codeText: "#93a1a1",
      mdChar: "#859900",
      blurText: "#586e75",
      sourceModeBg: "rgba(255, 255, 255, 0.02)",
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
    // Canonical Solarized maps bright 8-15 to base tones (brightCyan is
    // base1, the body-text grey) - repainting bold as "bright" turned bold
    // `ls` output into body grey. D10: fix at the renderer, keep the palette.
    boldTextInBrightColors: false,
  },
  // Solarized-ADJACENT code palette, lifted to 4.5:1 (WI-UI1.5): the canonical
  // syntax colours on base02 fail AA by design (red 2.81, magenta 2.86), so
  // each accent keeps its hue and takes the smallest lift that clears the
  // floor on both backgrounds.
  syntax: {
    keyword: "#8fa215", type: "#bc9316", function: "#4ca0da", property: "#4ca0da",
    variable: "#93a1a1", string: "#3ba9a0", number: "#e175a9", operator: "#8fa215",
    punctuation: "#93a1a1", comment: "#8c9ba0", escape: "#db815b", constant: "#9094d2",
    attribute: "#bc9316", tag: "#4ca0da", link: "#3ba9a0", invalid: "#e87775",
  },
  ...sharedPrimitives,
  shadow: darkShadows,
};
