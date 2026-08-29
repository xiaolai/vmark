/**
 * shellChrome
 *
 * Purpose: The ONE definition of how much horizontal chrome sits between the
 * window's left edge and the editor — the workspace rail plus the sidebar.
 *
 * Why it exists: App.tsx and the terminal's layout maths both needed this
 * number and each derived it independently. The terminal's copy omitted the
 * 30 px workspace rail, so with the rail enabled every horizontal terminal
 * ratio (and the 50 % cap) was computed against a width 30 px larger than the
 * editor actually had. Two derivations of one quantity is the bug; this is the
 * fix.
 *
 * It also owns the VERTICAL number the same story applies to: the space a
 * full-height column must leave clear at the top of the window. The sidebar and
 * the workspace rail each hardcoded 28px, and off macOS — where there is
 * neither a chrome strip nor a traffic light — both were an unexplained gap
 * (#1296). The 28 was then wrong on macOS too: see `SHELL_TOP_INSET`.
 *
 * @coordinates-with App.tsx — lays the shell out with this width
 * @coordinates-with components/Terminal/useTerminalPosition.ts — sizes the panel against it
 * @coordinates-with shell/trafficLights.ts — the window controls' own geometry
 * @module shell/shellChrome
 */
import {
  TRAFFIC_LIGHTS_CENTRE,
  TRAFFIC_LIGHTS_CLEARANCE,
  TRAFFIC_LIGHTS_ZONE,
} from "./trafficLights";

/**
 * Width of the workspace rail column, in pixels. Defined HERE, with the layout
 * maths that consume it, rather than inside the rail component: importing the
 * component just to read a number dragged the whole rail (and its store
 * subscriptions) into the terminal's dependency graph. `WorkspaceRail`
 * re-exports this, and `:root`'s `--workspace-rail-width` mirrors it for
 * consumers that read the CSS var without a fallback.
 */
export const WORKSPACE_RAIL_WIDTH = 30;

/**
 * The window's own corner radius. NOT settable from here — there is no
 * corner-radius API in tauri or tao, the frame is drawn by the window server —
 * so it is a fact to design against. 21pt, measured by paper-one off the alpha
 * channel of a shadowless capture; every Tauri window on macOS 26 gets the same
 * one (Finder, a native AppKit window, gets 36).
 */
export const WINDOW_RADIUS = 21;

/**
 * How far the leading card sits inside the window on each side.
 *
 * 8, which is Finder's: its sidebar sits 8pt inside a 36pt window and carries a
 * 28pt radius — exactly 36 − 8. That is Apple's concentricity guidance, and
 * Finder follows it precisely.
 */
export const SHELL_CARD_INSET = 8;

/**
 * The leading card's radius — DERIVED by the concentric rule, not chosen.
 *
 * A nested radius must be the parent's minus the inset, or the child's corners
 * bulge past the container holding them. Borrowing Finder's absolute 28 would
 * reproduce native's number while inverting native's relationship: 28 inside
 * our 21 is rounder than the window it sits in.
 */
export const SHELL_CARD_RADIUS = WINDOW_RADIUS - SHELL_CARD_INSET;

export interface ShellChromeState {
  /** The workspace rail is showing (document windows with the mode on). */
  workspaceRailVisible: boolean;
  sidebarVisible: boolean;
  sidebarWidth: number;
}

/**
 * Width of the chrome to the left of the editor, in pixels.
 *
 * Includes the leading card's own gutters, because the card is what the editor
 * actually sits beside. Getting this wrong is not cosmetic: paper-one shipped a
 * card 2px narrower than the track reserved for it and the whole layout drifted
 * on two platforms. Zero when neither surface is showing — there is no card to
 * inset, since `App.tsx` renders no aside at all.
 */
export function shellSideWidth(state: ShellChromeState): number {
  const rail = state.workspaceRailVisible ? WORKSPACE_RAIL_WIDTH : 0;
  const sidebar = state.sidebarVisible ? state.sidebarWidth : 0;
  if (rail + sidebar === 0) return 0;
  return rail + sidebar + SHELL_CARD_INSET * 2;
}

/**
 * Height of the app's own chrome strip — the title bar — in pixels.
 *
 * Defined HERE, and re-exported by `AppShell.tsx`, for the same reason
 * `WORKSPACE_RAIL_WIDTH` is: it is a layout number other layout maths must
 * agree with, and importing a React component to read one drags the component
 * and its dependencies along with it. `AppShell` publishes it as
 * `--chrome-height` and reserves it as the primary column's `padding-top`.
 */
/**
 * The ONE bar height (R11, WI-UI3.5): title bar, status bar, horizontal
 * terminal bar and the chrome strip are all this tall. `shellChromeVars`
 * publishes it as `--bar-height`; `index.css` carries the static default and
 * `barHeight.test.ts` pins the two together.
 */
export const BAR_HEIGHT = 40;

/* The chrome strip is one bar tall. Internal alias — the exported name lives
   on AppShell (its semantic home); exporting both from here was a duplicate
   export of one value (knip). */
const CHROME_HEIGHT = BAR_HEIGHT;

/**
 * Vertical space a column running to the window's top edge — the sidebar, the
 * workspace rail — must leave clear. Zero elsewhere; see `shellChromeVars`.
 *
 * DERIVED from the two things that occupy that space, both measurable:
 *
 *   - **the chrome strip**, which is `position: absolute; left: 0; right: 0`
 *     over the whole shell and carries `data-tauri-drag-region` on its own root
 *     — so it takes the pointer everywhere it paints, the sidebar included;
 *   - **the traffic lights**, which AppKit draws inside the webview here.
 *
 * It was a standalone `28`, and 28 is less than the 40px strip above it. The
 * sidebar's header buttons ran 36→64 px, so their top 4 px sat under the drag
 * region: not clickable, and a window-drag handle instead. Confirmed by
 * measurement, not inferred — the active button's fill measures y 36.0→63.5 pt
 * against a strip covering 0→40 pt. The same 12 px also stepped the sidebar's
 * first row above the editor's, since the primary column reserves the whole
 * `CHROME_HEIGHT`.
 *
 * `Math.max` because either input can bind, and it has already earned its keep:
 * moving the lights onto Finder's line took `TRAFFIC_LIGHTS_CLEARANCE` from 23
 * to 33 and this number did not move, because the strip still binds. Shrink
 * `CHROME_HEIGHT` past the lights' reach and the lights decide instead.
 */
export const SHELL_TOP_INSET = Math.max(CHROME_HEIGHT, TRAFFIC_LIGHTS_CLEARANCE);

/** CSS custom properties the shell root publishes to every descendant. */
export interface ShellChromeVars {
  "--bar-height": string;
  "--workspace-rail-width": string;
  "--shell-top-inset": string;
  "--traffic-lights-zone": string;
  "--traffic-lights-centre": string;
  "--shell-card-inset": string;
  "--shell-card-radius": string;
}

/**
 * The shell root's CSS variables, so descendants read ONE value defined here
 * rather than each restating a number. `index.css` declares both in `:root` as
 * static defaults, for consumers that resolve before the shell has mounted.
 *
 * @param overlayTitleBar `usesOverlayTitleBar()` — true where the app's own
 *   chrome covers the native title bar. That is the only place the strip is
 *   mounted AND the only place the traffic lights sit inside the webview, which
 *   is why one flag governs every light-derived value here.
 */
export function shellChromeVars(overlayTitleBar: boolean): ShellChromeVars {
  return {
    "--bar-height": `${BAR_HEIGHT}px`,
    "--workspace-rail-width": `${WORKSPACE_RAIL_WIDTH}px`,
    "--shell-top-inset": `${overlayTitleBar ? SHELL_TOP_INSET : 0}px`,
    // Both are the window controls' own geometry, so both collapse to zero
    // where the OS draws its own title bar and there are no controls inside the
    // webview to leave room for.
    "--traffic-lights-zone": `${overlayTitleBar ? TRAFFIC_LIGHTS_ZONE : 0}px`,
    "--traffic-lights-centre": `${overlayTitleBar ? TRAFFIC_LIGHTS_CENTRE : 0}px`,
    // The card is the app's own shape, not the OS's, so unlike the values above
    // it does not collapse off macOS — a window with a native title bar still
    // holds its leading surfaces in the same card.
    "--shell-card-inset": `${SHELL_CARD_INSET}px`,
    "--shell-card-radius": `${SHELL_CARD_RADIUS}px`,
  };
}
