import type { ThemeTokens } from "../tokens";
import { sharedPrimitives, lightShadows, subtleLight, hoverLight } from "../tokens";

/**
 * Mint theme — green-tinted background.
 *
 * WI-UI1.2: mint's page (#CCE6D0, L≈0.74) is the darkest light paper, so the
 * old shared grey ramp and GitHub-derived palette failed hardest here (51
 * baselined pairs). Everything below is authored against mint's own three
 * backgrounds and the check-theme-contrast floors.
 */
export const mint: ThemeTokens = {
  isDark: false,
  color: {
    bg: { primary: "#CCE6D0", secondary: "#b8d9bd", tertiary: "#a8c9ad" },
    text: { primary: "#2d3a35", secondary: "#4f4f4f", tertiary: "#747474" },
    accent: { primary: "#165a3e", bg: "rgba(26, 107, 74, 0.1)" },
    contrastText: "white",
    border: "#a8c9ad",
    /** D8 — control boundary ≥ 3:1 on primary and secondary; `border` stays a divider. */
    controlBorder: "#63796a",
    selection: "rgba(26, 107, 74, 0.2)",
    subtle: subtleLight,
    hover: hoverLight,
    strong: "#195948",
    emphasis: "#6b4423",
    semantic: {
      error: "#9a1922",
      errorBg: "#ffebe9",
      errorHover: "#9c1818",
      warning: "#6c4800",
      warningBg: "rgba(245, 158, 11, 0.1)",
      warningBorder: "rgba(245, 158, 11, 0.3)",
      success: "#0c5b29",
      successHover: "#0f5b2b",
    },
    alert: {
      note: "#074c9f",
      tip: "#135b27",
      important: "#5d39a0",
      warning: "#6c4800",
      caution: "#9a1922",
    },
    media: { video: "#0c8378", audio: "#6063eb", youtube: "#dc2626", vimeo: "#007cac", bilibili: "#b75370" },
    legacy: {
      /** #777777 (the shared light value) measures 2.9:1 on mint's secondary —
       *  the one light theme whose paper is dark enough to need its own. */
      mdChar: "#747474",
    },
  },
  terminal: {
    // Cyan H~187, between green (124) and blue (202). Pure teal reads as green vs mint (issue #773).
    ansi: {
      black: "#2a3832", red: "#9e3020", green: "#246428", yellow: "#7a5c00",
      blue: "#155878", magenta: "#7b4a8a", cyan: "#0a6571", white: "#3d5240",
      brightBlack: "#4d6054", brightRed: "#a53e30", brightGreen: "#1e5422", brightYellow: "#6a5000",
      brightBlue: "#1a6896", brightMagenta: "#6c4179", brightCyan: "#095761", brightWhite: "#4d604f",
    },
    cursor: "#2d3a35",
    cursorAccent: "#CCE6D0",
  },
  syntax: {
    keyword: "#a52c38", type: "#6a3fb9", function: "#6a3fb9", property: "#0056b8",
    variable: "#2d3a35", string: "#032f62", number: "#0056b8", operator: "#a52c38",
    punctuation: "#2d3a35", comment: "#535a62", escape: "#0056b8", constant: "#0056b8",
    attribute: "#6a3fb9", tag: "#1a672d", link: "#032f62", invalid: "#ae1f2a",
  },
  ...sharedPrimitives,
  shadow: lightShadows,
};
