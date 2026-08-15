/**
 * resolveTerminalThemeId — pick the terminal's theme for the current context.
 *
 * A browser frame has to be a TRUE neutral. VMark's chrome already goes neutral
 * around a browser tab (`.browser-workspace-active` in shell/app-shell.css
 * rebinds the token family), and the reason is that a tinted frame around
 * arbitrary web content reads as wrong — `paper`'s warm grey `#eeeded`, `mint`,
 * `sepia` all do it. Every real browser uses a neutral chrome for the same
 * reason.
 *
 * The terminal was the one surface that rule could not reach. xterm.js renders
 * to a canvas from a JS `ITheme`, not from CSS custom properties, so the shell
 * around it turned neutral while the terminal stayed the tinted theme colour —
 * a visible seam down the whole height of the window.
 *
 * So the terminal collapses to one of the two NEUTRAL themes while a browser
 * tab is active: `white` for a light theme, `night` for a dark one. Choosing by
 * `isDark` rather than forcing white is what keeps this readable — each theme's
 * ANSI palette is tuned against its own background, and a dark theme's palette
 * on a white background is close to invisible.
 *
 * The two neutrals are chosen so the match is EXACT, not approximate:
 * `white.color.bg.primary` is `#FFFFFF` and `night.color.bg.primary` is
 * `#23262b`, which are the light and dark values of `--browser-bg-color`.
 * `terminalThemeForBrowser.test.ts` pins that equality — if either side drifts,
 * the seam returns.
 *
 * @coordinates-with styles/index.css — the `--browser-*` light and dark values
 * @coordinates-with shell/app-shell.css — applies the same neutral to CSS surfaces
 * @coordinates-with components/Terminal/terminalSessionStoreSync.ts — consumer
 * @module theme/terminalThemeForBrowser
 */

import type { ThemeId } from "./themes";
import { neutralThemeId } from "./themeAvailability";

/**
 * The theme id the terminal should render with.
 *
 * The white/night pair and the by-polarity mapping are NOT redeclared here —
 * `themeAvailability.ts` already owns them for platform coercion, and having two
 * authorities for the same fact is how they drift apart.
 *
 * @param themeId       the effective app theme
 * @param browserActive whether the focused tab is a browser tab
 */
export function resolveTerminalThemeId(themeId: ThemeId, browserActive: boolean): ThemeId {
  return browserActive ? neutralThemeId(themeId) : themeId;
}
