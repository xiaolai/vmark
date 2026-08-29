import type { ThemeTokens } from "../tokens";
import { sharedPrimitives, lightShadows, subtleLight, hoverLight } from "../tokens";

/**
 * Paper theme — soft warm background, the default vmark theme.
 *
 * WI-UI1.2: semantic/alert/media are AUTHORED per theme (the shared light
 * fragments were tuned for #ffffff and lost 0.5–1.2 ratio points on this
 * warm paper). Every colour clears the check-theme-contrast floors on this
 * theme's own three backgrounds.
 */
export const paper: ThemeTokens = {
  isDark: false,
  color: {
    // secondary dropped #e5e4e4 → #dedddd for the Q1 surface ramp (1.16:1);
    // tertiary is the hover tier below it — the old #f0f0f0 was LIGHTER than
    // the page (an inverted scale).
    bg: { primary: "#EEEDED", secondary: "#dedddd", tertiary: "#d9d8d8" },
    text: { primary: "#1a1a1a", secondary: "#5e5e5e", tertiary: "#7d7d7d" },
    accent: { primary: "#005cb9", bg: "rgba(0, 102, 204, 0.1)" },
    contrastText: "white",
    border: "#d5d4d4",
    /** D8 — control boundary ≥ 3:1 on primary and secondary; `border` stays a divider. */
    controlBorder: "#7e7d7d",
    selection: "rgba(0, 102, 204, 0.2)",
    subtle: subtleLight,
    hover: hoverLight,
    strong: "#3f5663",
    emphasis: "#5b0411",
    semantic: {
      error: "#b81e29",
      errorBg: "#ffebe9",
      errorHover: "#b91c1c",
      warning: "#815600",
      warningBg: "rgba(245, 158, 11, 0.1)",
      warningBorder: "rgba(245, 158, 11, 0.3)",
      success: "#0f6d32",
      successHover: "#126d34",
    },
    alert: {
      note: "#085bbe",
      tip: "#166d2f",
      important: "#6f44bf",
      warning: "#815600",
      caution: "#b81e29",
    },
    media: { video: "#0c8c81", audio: "#6366f1", youtube: "#dc2626", vimeo: "#0086b9", bilibili: "#c55978" },
  },
  terminal: {
    ansi: {
      black: "#2e3436", red: "#c33820", green: "#387204", yellow: "#806800",
      blue: "#2f5a92", magenta: "#7b4d82", cyan: "#086e6e", white: "#595959",
      brightBlack: "#5c5c5a", brightRed: "#b3341d", brightGreen: "#306203", brightYellow: "#6f5a00",
      brightBlue: "#40679b", brightMagenta: "#6c4472", brightCyan: "#075e5e", brightWhite: "#6a6a6a",
    },
    cursor: "#1a1a1a",
    cursorAccent: "#EEEDED",
  },
  syntax: {
    keyword: "#b3303d", type: "#6f42c1", function: "#6f42c1", property: "#005cc5",
    variable: "#1a1a1a", string: "#032f62", number: "#005cc5", operator: "#b3303d",
    punctuation: "#1a1a1a", comment: "#5b626b", escape: "#005cc5", constant: "#005cc5",
    attribute: "#6f42c1", tag: "#1d7031", link: "#032f62", invalid: "#bd212e",
  },
  ...sharedPrimitives,
  shadow: lightShadows,
};
