import type { ThemeTokens } from "../tokens";
import { sharedPrimitives, lightShadows } from "../tokens";

/** Sepia theme — warm beige background. */
export const sepia: ThemeTokens = {
  color: {
    bg: { primary: "#F9F0DB", secondary: "#f0e5cc", tertiary: "#e0d5bc" },
    text: { primary: "#5c4b37", secondary: "#666666", tertiary: "#999999" },
    accent: { primary: "#8b4513", bg: "rgba(139, 69, 19, 0.1)" },
    border: "#e0d5bc",
    selection: "rgba(139, 69, 19, 0.2)",
    strong: "#4a3728",
    emphasis: "#8b3a2f",
    semantic: { error: "#cf222e", errorBg: "#ffebe9", errorHover: "#b91c1c", warning: "#9a6700", warningBg: "rgba(245, 158, 11, 0.1)", success: "#16a34a", successHover: "#15803d" },
    alert: { note: "#0969da", tip: "#1a7f37", important: "#8250df", warning: "#9a6700", caution: "#cf222e" },
    media: { video: "#0d9488", audio: "#6366f1", youtube: "#dc2626", vimeo: "#00adef", bilibili: "#fb7299" },
  },
  terminal: {
    ansi: {
      black: "#3e3328", red: "#b5421a", green: "#4a6818", yellow: "#7a5c00",
      blue: "#4a6a8a", magenta: "#8a5470", cyan: "#1e645e", white: "#5e5345",
      brightBlack: "#6b5d4f", brightRed: "#b04828", brightGreen: "#4e7018", brightYellow: "#886200",
      brightBlue: "#3e6490", brightMagenta: "#8a5470", brightCyan: "#267a6e", brightWhite: "#5e5345",
    },
    cursor: "#5c4b37",
    cursorAccent: "#F9F0DB",
    selectionBackground: "rgba(139, 69, 19, 0.2)",
    scrollbar: { idle: "rgba(0, 0, 0, 0.10)", hover: "rgba(0, 0, 0, 0.18)", active: "rgba(0, 0, 0, 0.25)" },
  },
  ...sharedPrimitives,
  shadow: lightShadows,
};
