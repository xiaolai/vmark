import type { ThemeTokens } from "../tokens";
import { sharedPrimitives, lightShadows, subtleLight, hoverLight } from "../tokens";

/**
 * Sepia theme — warm beige background.
 *
 * WI-UI1.2: semantic/alert/media are AUTHORED per theme against sepia's own
 * three backgrounds and the check-theme-contrast floors (the shared light
 * fragments were tuned for #ffffff).
 */
export const sepia: ThemeTokens = {
  isDark: false,
  color: {
    // secondary dropped #f0e5cc → #ebdfc2 for the Q1 surface ramp (1.17:1).
    bg: { primary: "#F9F0DB", secondary: "#ebdfc2", tertiary: "#e0d5bc" },
    text: { primary: "#5c4b37", secondary: "#5c5c5c", tertiary: "#7f7f7f" },
    accent: { primary: "#8b4513", bg: "rgba(139, 69, 19, 0.1)" },
    contrastText: "white",
    border: "#e0d5bc",
    /** D8 — control boundary ≥ 3:1 on primary and secondary; `border` stays a divider. */
    controlBorder: "#8c7d67",
    selection: "rgba(139, 69, 19, 0.2)",
    subtle: subtleLight,
    hover: hoverLight,
    strong: "#4a3728",
    emphasis: "#8b3a2f",
    semantic: {
      error: "#b51e28",
      errorBg: "#ffebe9",
      errorHover: "#b61c1c",
      warning: "#7e5400",
      warningBg: "rgba(245, 158, 11, 0.1)",
      warningBorder: "rgba(245, 158, 11, 0.3)",
      success: "#0e6b30",
      successHover: "#126b33",
    },
    alert: {
      note: "#0859ba",
      tip: "#166b2e",
      important: "#6d43bc",
      warning: "#7e5400",
      caution: "#b51e28",
    },
    media: { video: "#0c8e82", audio: "#6366f1", youtube: "#dc2626", vimeo: "#0088bc", bilibili: "#c75b79" },
  },
  terminal: {
    ansi: {
      black: "#3e3328", red: "#b5421a", green: "#4a6818", yellow: "#7a5c00",
      blue: "#4a6a8a", magenta: "#8a5470", cyan: "#1e645e", white: "#5e5345",
      brightBlack: "#6b5d4f", brightRed: "#a53c18", brightGreen: "#577328", brightYellow: "#836712",
      brightBlue: "#415d79", brightMagenta: "#794a63", brightCyan: "#267a6e", brightWhite: "#6c6256",
    },
    cursor: "#5c4b37",
    cursorAccent: "#F9F0DB",
  },
  syntax: {
    keyword: "#b6313e", type: "#6f42c1", function: "#6f42c1", property: "#005cc5",
    variable: "#5c4b37", string: "#032f62", number: "#005cc5", operator: "#b6313e",
    punctuation: "#5c4b37", comment: "#5d646d", escape: "#005cc5", constant: "#005cc5",
    attribute: "#6f42c1", tag: "#1d7232", link: "#032f62", invalid: "#c0222e",
  },
  ...sharedPrimitives,
  shadow: lightShadows,
};
