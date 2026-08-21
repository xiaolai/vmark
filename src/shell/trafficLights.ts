/**
 * trafficLights
 *
 * Purpose: the ONE description of where macOS draws this app's window controls,
 * and of the space the app's own chrome must therefore leave them.
 *
 * Why it exists: the numbers are AppKit's, not VMark's, and they were guesses.
 * The title bar reserved 70px on one side and 72px on the other for a cluster
 * nobody had measured; the sidebar reserved 28px for a strip that is 40px tall.
 * Measured (screenshot at 2×, window frame located by walking in from the
 * backdrop), VMark's lights sat 10.00pt up and 10.00pt left of where every
 * native window puts them — Finder included, whose 25.75pt centre this file's
 * target reproduces.
 *
 * Everything below is DERIVED from `TRAFFIC_LIGHT_POSITION`, which is the value
 * `src-tauri/tauri.conf.json` asks AppKit for. Change that and the clearances
 * follow; change it in only one of the three places it is written and
 * `trafficLights.test.ts` fails.
 *
 * @coordinates-with src-tauri/tauri.conf.json — the main window's position
 * @coordinates-with src-tauri/src/window_manager/mod.rs — the same value for runtime-built windows
 * @coordinates-with shell/shellChrome.ts — publishes the derived clearances as CSS vars
 * @module shell/trafficLights
 */

/**
 * The standard titlebar inset AppKit applies BEFORE `trafficLightPosition.y`,
 * so the button's top edge lands at `y - 9`. `x` is one to one.
 *
 * **Two measurements, not one.** A single reading fits `top = y - 9` and
 * `top = 29 - y` equally well and the two disagree about which way the axis
 * runs; paper-one shipped the wrong sign off one point. The two here are its
 * measured pair (y 19 → top 10.0, y 9 → top 0.5) and VMark's own unset default
 * (top 9.0), which the mapping places at y ≈ 18.
 */
const APPKIT_TITLEBAR_Y_OFFSET = 9;

/**
 * What `tauri.conf.json` and the runtime window builders ask AppKit for.
 *
 * Chosen to land on Finder's own line: measured against a live Finder window
 * (frame origin from the accessibility API, lights located by hue), the cluster
 * insets 19.0pt from the window's left and top edges, centre 25.75pt down. So
 * `x` is 19 directly, and `y` is 19 + the offset above.
 *
 * **Requires `macOSPrivateApi: true` AND the `macos-private-api` cargo
 * feature.** Without the feature the position is ignored SILENTLY — the app
 * builds, the config parses, the lights stay where AppKit put them.
 */
export const TRAFFIC_LIGHT_POSITION = { x: 19, y: 28 } as const;

/** Apple's, not ours: the buttons are 14pt across. Measured on both apps. */
export const TRAFFIC_LIGHT_DIAMETER = 14;

/**
 * Close's left edge to zoom's right edge, at 23.0pt centre-to-centre.
 *
 * Measured at 59.5pt on VMark and on Finder, and paper-one measured the same
 * 59.5 independently on a third app — it is AppKit's, and does not move with
 * `trafficLightPosition`.
 */
export const TRAFFIC_LIGHTS_SPAN = 59.5;

/** Distance from the window's top edge to the top of the buttons. */
export const TRAFFIC_LIGHTS_TOP = TRAFFIC_LIGHT_POSITION.y - APPKIT_TITLEBAR_Y_OFFSET;

/**
 * How far the cluster reaches DOWN into the webview — the vertical space a
 * full-height column has to clear. Feeds `SHELL_TOP_INSET`.
 */
export const TRAFFIC_LIGHTS_CLEARANCE = TRAFFIC_LIGHTS_TOP + TRAFFIC_LIGHT_DIAMETER;

/**
 * The cluster's optical line. The title bar centres its content on THIS rather
 * than on its own middle, which is what makes a filename read as belonging
 * beside the buttons instead of floating above them.
 */
export const TRAFFIC_LIGHTS_CENTRE = TRAFFIC_LIGHTS_TOP + TRAFFIC_LIGHT_DIAMETER / 2;

/** How far the cluster reaches ACROSS from the window's left edge. */
export const TRAFFIC_LIGHTS_REACH = TRAFFIC_LIGHT_POSITION.x + TRAFFIC_LIGHTS_SPAN;

/**
 * Horizontal space the title bar keeps clear at the leading edge.
 *
 * `TRAFFIC_LIGHTS_REACH` (78.5) is the floor; this is that plus 3.5pt of air,
 * rounded to a whole pixel. A chosen number over a derived floor, and the test
 * pins the relationship rather than the value — so raising the inset without
 * raising this fails, which is the half-change paper-one warns about
 * ("changing `trafficLightPosition.x` without changing this is half a change").
 *
 * It replaces a 70 and a 72 that disagreed with each other and cleared the old,
 * tighter cluster by 1.5pt.
 */
export const TRAFFIC_LIGHTS_ZONE = 82;
