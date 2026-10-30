/**
 * Product name
 *
 * Purpose: one spelling of the app's own name, for the surfaces that identify
 * the WINDOW rather than a document — the native window title and the title-bar
 * strip when nothing is open (#1331).
 *
 * Not translated: it is the brand. `src-tauri/tauri.conf.json` spells it the
 * same way as the bundle's `productName` and the main window's initial title
 * (`appName.test.ts` holds the three together).
 *
 * @module utils/appName
 */

/** The app's display name. */
export const APP_NAME = "VMark";
