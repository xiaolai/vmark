import type { ThemeTokens } from "../tokens";
import { sharedPrimitives, lightShadows, subtleLight, hoverLight } from "../tokens";

/**
 * White theme — pure-white background. Highest contrast.
 *
 * WI-UI1.2: semantic/alert/media are AUTHORED per theme (the shared light
 * fragments were tuned for #ffffff and failed on the tinted papers — and even
 * here `success` measured 3.30:1). Every colour below clears the
 * check-theme-contrast floors on this theme's own three backgrounds; the gate
 * is the arbiter, so retint against it, not by eye.
 */
export const white: ThemeTokens = {
  isDark: false,
  color: {
    // secondary dropped #f8f8f8 → #eeeeee for the Q1 surface ramp (1.16:1 —
    // code blocks and cards stopped reading as faint smudges); tertiary is a
    // real hover tier below it.
    bg: { primary: "#FFFFFF", secondary: "#eeeeee", tertiary: "#e7e7e7" },
    text: { primary: "#1a1a1a", secondary: "#666666", tertiary: "#888888" },
    accent: { primary: "#0065ca", bg: "rgba(0, 102, 204, 0.1)" },
    contrastText: "white",
    border: "#eeeeee",
    /** D8 — control boundary ≥ 3:1 on primary and secondary; `border` stays a divider. */
    controlBorder: "#888888",
    selection: "rgba(0, 102, 204, 0.2)",
    subtle: subtleLight,
    hover: hoverLight,
    strong: "#3f5663",
    emphasis: "#5b0411",
    semantic: {
      error: "#c9212d",
      errorBg: "#ffebe9",
      errorHover: "#b91c1c",
      warning: "#8d5e00",
      warningBg: "rgba(245, 158, 11, 0.1)",
      warningBorder: "rgba(245, 158, 11, 0.3)",
      success: "#107736",
      successHover: "#147739",
    },
    alert: {
      note: "#0964d0",
      tip: "#187734",
      important: "#7a4bd1",
      warning: "#8d5e00",
      caution: "#c9212d",
    },
    media: { video: "#0d9488", audio: "#6366f1", youtube: "#dc2626", vimeo: "#0092ca", bilibili: "#d76183" },
  },
  terminal: {
    ansi: {
      black: "#2e3436", red: "#cc0000", green: "#3d7a04", yellow: "#8a7000",
      blue: "#3465a4", magenta: "#75507b", cyan: "#047a7c", white: "#767676",
      brightBlack: "#555753", brightRed: "#d42020", brightGreen: "#4b8316", brightYellow: "#796300",
      brightBlue: "#4471ab", brightMagenta: "#885088", brightCyan: "#168385", brightWhite: "#656565",
    },
    cursor: "#1a1a1a",
    cursorAccent: "#FFFFFF",
  },
  syntax: {
    keyword: "#c63543", type: "#6f42c1", function: "#6f42c1", property: "#005cc5",
    variable: "#1a1a1a", string: "#032f62", number: "#005cc5", operator: "#c63543",
    punctuation: "#1a1a1a", comment: "#646d77", escape: "#005cc5", constant: "#005cc5",
    attribute: "#6f42c1", tag: "#207c36", link: "#032f62", invalid: "#cb2431",
  },
  ...sharedPrimitives,
  shadow: lightShadows,
};
