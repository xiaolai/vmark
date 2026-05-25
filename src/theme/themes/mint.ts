import type { ThemeTokens } from "../tokens";
import { sharedPrimitives, lightShadows, semanticLight, alertLight, mediaLight } from "../tokens";

/** Mint theme — green-tinted background. */
export const mint: ThemeTokens = {
  color: {
    bg: { primary: "#CCE6D0", secondary: "#b8d9bd", tertiary: "#a8c9ad" },
    text: { primary: "#2d3a35", secondary: "#666666", tertiary: "#999999" },
    accent: { primary: "#1a6b4a", bg: "rgba(26, 107, 74, 0.1)" },
    border: "#a8c9ad",
    selection: "rgba(26, 107, 74, 0.2)",
    strong: "#1a5c4a",
    emphasis: "#6b4423",
    semantic: semanticLight,
    alert: alertLight,
    media: mediaLight,
  },
  terminal: {
    // Cyan H~187, between green (124) and blue (202). Pure teal reads as green vs mint (issue #773).
    ansi: {
      black: "#2a3832", red: "#9e3020", green: "#246428", yellow: "#7a5c00",
      blue: "#155878", magenta: "#7b4a8a", cyan: "#0a6571", white: "#3d5240",
      brightBlack: "#4d6054", brightRed: "#a83828", brightGreen: "#2a6a2e", brightYellow: "#7a5c00",
      brightBlue: "#1a6896", brightMagenta: "#7a4490", brightCyan: "#0e6b7a", brightWhite: "#3d5240",
    },
    cursor: "#2d3a35",
    cursorAccent: "#CCE6D0",
    selectionBackground: "rgba(0,102,204,0.25)",
    scrollbar: { idle: "rgba(0,0,0,0.10)", hover: "rgba(0,0,0,0.18)", active: "rgba(0,0,0,0.25)" },
  },
  ...sharedPrimitives,
  shadow: lightShadows,
};
