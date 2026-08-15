/**
 * VMark Reader Assets
 *
 * Provides inline CSS and JS for the interactive reader in exported HTML.
 */

// Import raw CSS and JS as strings
import readerCSS from "./vmark-reader.css?raw";
import readerJS from "./vmark-reader.js?raw";
import { readerDarkPaletteCSS } from "./readerDarkPalette";

/**
 * Get the reader CSS for embedding in exported HTML.
 *
 * The dark PALETTE is prepended rather than living in the stylesheet: it is
 * derived from the app's night theme, because the hand-written copy drifted
 * eight tokens (see readerDarkPalette.ts). Prepending is safe — custom
 * properties resolve at use time, not by declaration order — and this is the
 * single entry point every export path goes through, so there is nowhere for an
 * un-generated copy to survive.
 */
export function getReaderCSS(): string {
  return `${readerDarkPaletteCSS()}\n${readerCSS}`;
}

/**
 * Get the reader JavaScript for embedding in exported HTML.
 */
export function getReaderJS(): string {
  return readerJS;
}
