import type { ThemeTokens } from "../tokens";
import { sharedPrimitives, lightShadows } from "../tokens";

/** White theme — pure-white background. Highest contrast. */
export const white: ThemeTokens = {
  color: {
    bg: { primary: "#FFFFFF", secondary: "#f8f8f8", tertiary: "#f0f0f0" },
    text: { primary: "#1a1a1a", secondary: "#666666", tertiary: "#999999" },
    accent: { primary: "#0066cc", bg: "rgba(0, 102, 204, 0.1)" },
    border: "#eeeeee",
    selection: "rgba(0, 102, 204, 0.2)",
    strong: "#3f5663",
    emphasis: "#5b0411",
    semantic: { error: "#cf222e", errorBg: "#ffebe9", errorHover: "#b91c1c", warning: "#9a6700", warningBg: "rgba(245, 158, 11, 0.1)", success: "#16a34a", successHover: "#15803d" },
    alert: { note: "#0969da", tip: "#1a7f37", important: "#8250df", warning: "#9a6700", caution: "#cf222e" },
    media: { video: "#0d9488", audio: "#6366f1", youtube: "#dc2626", vimeo: "#00adef", bilibili: "#fb7299" },
  },
  terminal: {
    ansi: {
      black: "#2e3436", red: "#cc0000", green: "#3d7a04", yellow: "#8a7000",
      blue: "#3465a4", magenta: "#75507b", cyan: "#047a7c", white: "#767676",
      brightBlack: "#555753", brightRed: "#d42020", brightGreen: "#3a8000", brightYellow: "#8a7000",
      brightBlue: "#3a6faa", brightMagenta: "#885088", brightCyan: "#047878", brightWhite: "#767676",
    },
    cursor: "#1a1a1a",
    cursorAccent: "#FFFFFF",
    selectionBackground: "rgba(0, 102, 204, 0.2)",
    scrollbar: { idle: "rgba(0, 0, 0, 0.10)", hover: "rgba(0, 0, 0, 0.18)", active: "rgba(0, 0, 0, 0.25)" },
  },
  ...sharedPrimitives,
  shadow: lightShadows,
};
