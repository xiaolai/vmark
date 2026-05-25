import type { ThemeTokens } from "../../tokens";
import { sharedPrimitives, lightShadows } from "../../tokens";

/**
 * High-contrast theme — Phase-5 acceptance spike.
 *
 * Proves the architecture promise: adding a 6th vmark theme requires
 * ONE new ThemeTokens file (this one) plus appending the ID to
 * src/theme/themes/index.ts and settingsTypes.ts. No other file needs
 * editing.
 *
 * Marked .spike to indicate this is a verification artifact, not a
 * shipping theme.
 */
export const highContrast: ThemeTokens = {
  color: {
    bg: { primary: "#FFFFFF", secondary: "#FFFFFF", tertiary: "#FFFFFF" },
    text: { primary: "#000000", secondary: "#000000", tertiary: "#333333" },
    accent: { primary: "#0000ff", bg: "rgba(0,0,255,0.1)" },
    border: "#000000",
    selection: "rgba(0,0,255,0.3)",
    strong: "#000000",
    emphasis: "#000000",
    semantic: { error: "#cc0000", errorBg: "#ffeeee", errorHover: "#990000", warning: "#cc6600", warningBg: "#fff5e6", success: "#006600", successHover: "#004400" },
    alert: { note: "#0000cc", tip: "#006600", important: "#660066", warning: "#cc6600", caution: "#cc0000" },
    media: { video: "#006666", audio: "#330099", youtube: "#cc0000", vimeo: "#0066cc", bilibili: "#cc0066" },
  },
  terminal: {
    ansi: {
      black: "#000000", red: "#cc0000", green: "#006600", yellow: "#996600",
      blue: "#0000cc", magenta: "#660066", cyan: "#006666", white: "#666666",
      brightBlack: "#333333", brightRed: "#ff0000", brightGreen: "#009900", brightYellow: "#cc9900",
      brightBlue: "#0000ff", brightMagenta: "#990099", brightCyan: "#009999", brightWhite: "#000000",
    },
    cursor: "#000000",
    cursorAccent: "#FFFFFF",
    selectionBackground: "rgba(0,0,255,0.3)",
    scrollbar: { idle: "rgba(0,0,0,0.30)", hover: "rgba(0,0,0,0.45)", active: "rgba(0,0,0,0.60)" },
  },
  ...sharedPrimitives,
  shadow: lightShadows,
};
